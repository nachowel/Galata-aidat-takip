////////////////////////////////////////////////////////////
// FORCE EMULATOR ENV
////////////////////////////////////////////////////////////

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "galata-apartman-yonetim";

////////////////////////////////////////////////////////////
// IMPORTS
////////////////////////////////////////////////////////////

import admin from "firebase-admin";

////////////////////////////////////////////////////////////
// ADMIN INIT
////////////////////////////////////////////////////////////

admin.initializeApp({
    projectId: "galata-apartman-yonetim",
});

const adminDb = admin.firestore();
const adminAuth = admin.auth();

////////////////////////////////////////////////////////////
// CONFIG
////////////////////////////////////////////////////////////

const PROJECT_ID = "galata-apartman-yonetim";
const MGMT_ID = "test-dues-mgmt";
const YEAR_MONTH = "2026-03";
const ADMIN_UID = "test-admin-uid";

const FUNCTIONS_URL =
    `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/runMonthlyDues`;

////////////////////////////////////////////////////////////
// HELPER: CALL FUNCTION WITH AUTH HEADER
////////////////////////////////////////////////////////////

async function callRunMonthlyDues(idToken, payload) {
    const res = await fetch(FUNCTIONS_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ data: payload }),
    });

    const json = await res.json();

    if (!res.ok) {
        throw new Error(JSON.stringify(json));
    }

    return json.result;
}

////////////////////////////////////////////////////////////
// MAIN TEST
////////////////////////////////////////////////////////////

async function main() {
    console.log("🚀 Starting Dues Engine Test...");

    ////////////////////////////////////////////////////////////
    // CREATE ADMIN CUSTOM TOKEN (IMPORTANT: admin: true)
    ////////////////////////////////////////////////////////////

    const customToken = await adminAuth.createCustomToken(ADMIN_UID, {
        admin: true,   // ⚠️ CRITICAL FIX
    });

    ////////////////////////////////////////////////////////////
    // EXCHANGE FOR ID TOKEN (AUTH EMULATOR)
    ////////////////////////////////////////////////////////////

    const signInRes = await fetch(
        `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: customToken,
                returnSecureToken: true,
            }),
        }
    );

    const signInJson = await signInRes.json();

    if (!signInJson.idToken) {
        throw new Error("Failed to obtain ID token");
    }

    const idToken = signInJson.idToken;

    // Sanity check
    const decoded = await adminAuth.verifyIdToken(idToken);
    console.log("🔑 Authenticated as Admin");
    console.log("Decoded token claims:", decoded);

    ////////////////////////////////////////////////////////////
    // CLEANUP: RESET EMULATOR FIRESTORE
    ////////////////////////////////////////////////////////////

    console.log("🧹 Clearing Firestore emulator data...");
    const clearRes = await fetch(
        `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
        { method: "DELETE" }
    );
    if (!clearRes.ok) {
        throw new Error(`Failed to clear Firestore emulator: ${clearRes.status}`);
    }
    console.log("✅ Firestore cleared");

    ////////////////////////////////////////////////////////////
    // SEED MANAGEMENT
    ////////////////////////////////////////////////////////////

    await adminDb.doc(`managements/${MGMT_ID}`).set({
        name: "Test Dues Mgmt",
        ownerUid: ADMIN_UID,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await adminDb.doc(`users/${ADMIN_UID}`).set({
        email: "admin@test.com",
        role: "admin",
        managementId: MGMT_ID,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    ////////////////////////////////////////////////////////////
    // SEED SETTINGS
    ////////////////////////////////////////////////////////////

    await adminDb.doc(`managements/${MGMT_ID}/settings/dues`).set({
        enabled: true,
        monthlyFeeMinor: 50000,
        currency: "TRY",
        dueDay: 1,
        exemptUnitIds: ["unit-exempt"],
    });

    ////////////////////////////////////////////////////////////
    // SEED UNITS + BALANCES
    ////////////////////////////////////////////////////////////

    const units = ["unit-1", "unit-2", "unit-exempt"];

    for (const unitId of units) {
        await adminDb.doc(`managements/${MGMT_ID}/units/${unitId}`).set({
            no: unitId,
            status: "active",
        });

        await adminDb.doc(`managements/${MGMT_ID}/unitBalances/${unitId}`).set({
            balanceMinor: 0,
            postedDebitMinor: 0,
            postedCreditMinor: 0,
            unitId,
            version: 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastLedgerEventAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    ////////////////////////////////////////////////////////////
    // DRY RUN
    ////////////////////////////////////////////////////////////

    console.log("🧪 Testing Dry Run...");

    const dryRes = await callRunMonthlyDues(idToken, {
        mgmtId: MGMT_ID,
        yearMonth: YEAR_MONTH,
        dryRun: true,
    });

    if (dryRes.processed !== 2 || dryRes.exempted !== 1) {
        throw new Error("Dry run failed");
    }

    console.log("✅ Dry Run OK");

    ////////////////////////////////////////////////////////////
    // REAL RUN
    ////////////////////////////////////////////////////////////

    console.log("🧪 Testing Real Run...");

    const realRes = await callRunMonthlyDues(idToken, {
        mgmtId: MGMT_ID,
        yearMonth: YEAR_MONTH,
        dryRun: false,
    });

    if (realRes.processed !== 2) {
        throw new Error("Real run failed");
    }

    console.log("✅ Real Run OK");

    ////////////////////////////////////////////////////////////
    // VERIFY LEDGER
    ////////////////////////////////////////////////////////////

    const ledgerSnap = await adminDb
        .collection(`managements/${MGMT_ID}/ledger`)
        .where("metadata.yearMonth", "==", YEAR_MONTH)
        .where("metadata.kind", "==", "DUES")
        .get();

    if (ledgerSnap.size !== 2) {
        throw new Error("Ledger entries mismatch");
    }

    console.log("✅ Ledger Verification OK");

    ////////////////////////////////////////////////////////////
    // IDEMPOTENCY
    ////////////////////////////////////////////////////////////

    console.log("🧪 Testing Idempotency...");

    const repeatRes = await callRunMonthlyDues(idToken, {
        mgmtId: MGMT_ID,
        yearMonth: YEAR_MONTH,
        dryRun: false,
    });

    if (repeatRes.alreadyDone !== 2) {
        throw new Error("Idempotency failed");
    }

    console.log("✅ Idempotency OK");

    ////////////////////////////////////////////////////////////
    // WAIT FOR BALANCE TRIGGER
    ////////////////////////////////////////////////////////////

    console.log("⏳ Waiting for balance trigger...");
    await new Promise((r) => setTimeout(r, 4000));

    const balSnap = await adminDb
        .doc(`managements/${MGMT_ID}/unitBalances/unit-1`)
        .get();

    const bal = balSnap.data();

    if (bal.balanceMinor !== -50000) {
        throw new Error(
            `Balance mismatch: expected -50000 got ${bal.balanceMinor}`
        );
    }

    console.log("✅ Balance Trigger OK");

    ////////////////////////////////////////////////////////////
    // CONCURRENCY: PARALLEL DOUBLE-FIRE
    ////////////////////////////////////////////////////////////

    console.log("🧪 Testing Concurrency (parallel double-fire)...");

    // Use a fresh yearMonth so registry is clean
    const CONC_YEAR_MONTH = "2026-04";

    const [concA, concB] = await Promise.all([
        callRunMonthlyDues(idToken, {
            mgmtId: MGMT_ID,
            yearMonth: CONC_YEAR_MONTH,
            dryRun: false,
        }),
        callRunMonthlyDues(idToken, {
            mgmtId: MGMT_ID,
            yearMonth: CONC_YEAR_MONTH,
            dryRun: false,
        }),
    ]);

    console.log("  Caller A:", JSON.stringify(concA));
    console.log("  Caller B:", JSON.stringify(concB));

    // Between the two callers, exactly 2 units should be "processed"
    // and 2 should be "alreadyDone". No unit should be processed twice.
    const totalProcessed = concA.processed + concB.processed;
    const totalAlready = concA.alreadyDone + concB.alreadyDone;
    const totalFailed = concA.failed + concB.failed;

    console.log(`  Total: processed=${totalProcessed} alreadyDone=${totalAlready} failed=${totalFailed}`);

    if (totalProcessed !== 2) {
        throw new Error(
            `Concurrency bug: expected exactly 2 processed, got ${totalProcessed} (double ledger write!)`
        );
    }
    if (totalAlready !== 2) {
        throw new Error(
            `Concurrency bug: expected exactly 2 alreadyDone, got ${totalAlready}`
        );
    }
    if (totalFailed !== 0) {
        throw new Error(
            `Concurrency bug: unexpected failures: ${totalFailed}`
        );
    }

    // Final proof: ledger must have exactly 2 DUES entries for CONC_YEAR_MONTH
    const concLedgerSnap = await adminDb
        .collection(`managements/${MGMT_ID}/ledger`)
        .where("metadata.yearMonth", "==", CONC_YEAR_MONTH)
        .where("metadata.kind", "==", "DUES")
        .get();

    if (concLedgerSnap.size !== 2) {
        throw new Error(
            `Concurrency bug: expected 2 ledger entries, got ${concLedgerSnap.size}`
        );
    }

    console.log("✅ Concurrency OK — no double writes");

    console.log("🎉 ALL TESTS PASSED");
    process.exit(0);
}

main().catch((err) => {
    console.error("💥 TEST FAILED:", err);
    process.exit(1);
});
