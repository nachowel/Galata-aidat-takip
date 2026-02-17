/**
 * Audit Replay — Gerçek Güvenlik Seviyesi
 *
 * Bu test aggregate convenience alanlarının (dueAllocatedMinor, unappliedMinor,
 * dueStatus, allocationStatus, dueOutstandingMinor, appliedMinor) immutable
 * kaynaklardan (ledger entries + dueAllocations) replay ile birebir
 * yeniden hesaplanabileceğini kanıtlar.
 *
 * Yaklaşım:
 *   1. Karmaşık senaryo kur: multiple dues, multiple payments, autoSettle,
 *      partial allocations, overpayments
 *   2. Tüm dueAllocations'ı oku
 *   3. Ledger entry'lerdeki aggregate alanları oku
 *   4. Allocations'tan canonical aggregates hesapla
 *   5. Canonical ile stored aggregates birebir karşılaştır
 *   6. Balance cache'i ledger'dan yeniden hesapla, cached ile karşılaştır
 *
 * Eğer bu test yeşil kalıyorsa, motor gerçekten güvenilir.
 *
 * Kullanım:
 *   1. firebase emulators:start
 *   2. node functions/scripts/test-audit-replay.mjs
 */

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

const PROJECT_ID = "galata-apartman-yonetim";

if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const authAdmin = admin.auth();

////////////////////////////////////////////////////////////
// CONFIG
////////////////////////////////////////////////////////////

const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const RUN_ID = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

let passCount = 0;
let failCount = 0;

////////////////////////////////////////////////////////////
// HELPERS
////////////////////////////////////////////////////////////

function assert(condition, message) {
    if (!condition) {
        failCount++;
        console.error(`  ❌ FAIL: ${message}`);
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
    passCount++;
    console.log(`  ✅ ${message}`);
}

async function getIdToken(uid) {
    const customToken = await authAdmin.createCustomToken(uid, { admin: true });
    const signInRes = await fetch(
        `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        }
    );
    const json = await signInRes.json();
    if (!json.idToken) throw new Error("Failed to get idToken");
    return json.idToken;
}

async function callFunction(name, idToken, data) {
    const url = `${FUNCTIONS_BASE}/${name}`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ data }),
    });
    const json = await res.json();
    if (!res.ok) {
        const err = new Error(`${name} failed: ${JSON.stringify(json)}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json.result;
}

async function seedManagement(mgmtId, adminUid) {
    await db.doc(`managements/${mgmtId}`).set({
        name: `Audit Replay Mgmt`,
        ownerUid: adminUid,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`users/${adminUid}`).set({
        email: `${adminUid}@test.com`,
        role: "admin",
        managementId: mgmtId,
        managementIds: [mgmtId],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`managementMemberships/${mgmtId}/users/${adminUid}`).set({
        role: "owner",
        status: "active",
        createdAt: Date.now(),
    });
}

async function seedUnit(mgmtId, unitId) {
    await db.doc(`managements/${mgmtId}/units/${unitId}`).set({
        no: unitId,
        status: "active",
    });
}

function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

////////////////////////////////////////////////////////////
// REPLAY FUNCTIONS — Canonical state from immutable sources
////////////////////////////////////////////////////////////

/**
 * Computes canonical due aggregates purely from dueAllocations docs.
 * No reliance on stored convenience fields.
 */
async function replayDueAggregates(mgmtId, dueId, dueTotalMinor) {
    const allocSnap = await db
        .collection(`managements/${mgmtId}/dueAllocations`)
        .where("dueId", "==", dueId)
        .get();

    let canonicalAllocated = 0;
    for (const doc of allocSnap.docs) {
        const data = doc.data();
        canonicalAllocated += Number(data.amountMinor ?? 0);
    }

    const canonicalOutstanding = Math.max(dueTotalMinor - canonicalAllocated, 0);
    const canonicalStatus = canonicalOutstanding > 0 ? "open" : "paid";

    return {
        allocatedMinor: canonicalAllocated,
        outstandingMinor: canonicalOutstanding,
        status: canonicalStatus,
        allocationCount: allocSnap.size,
    };
}

/**
 * Computes canonical payment progress purely from dueAllocations docs.
 * Looks for allocations where this payment is the source.
 */
async function replayPaymentAggregates(mgmtId, paymentEntryId, paymentTotalMinor) {
    // Allocation by paymentEntryId
    const allocSnap = await db
        .collection(`managements/${mgmtId}/dueAllocations`)
        .where("paymentEntryId", "==", paymentEntryId)
        .get();

    // Also check by paymentId (legacy field)
    const allocByIdSnap = await db
        .collection(`managements/${mgmtId}/dueAllocations`)
        .where("paymentId", "==", paymentEntryId)
        .get();

    // Merge (dedup by doc id)
    const seen = new Set();
    let canonicalApplied = 0;
    for (const doc of allocSnap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        canonicalApplied += Number(doc.data().amountMinor ?? 0);
    }
    for (const doc of allocByIdSnap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        canonicalApplied += Number(doc.data().amountMinor ?? 0);
    }

    const canonicalUnapplied = Math.max(paymentTotalMinor - canonicalApplied, 0);
    const canonicalStatus =
        canonicalUnapplied === 0 ? "applied" : canonicalApplied > 0 ? "partial" : "unapplied";

    return {
        appliedMinor: canonicalApplied,
        unappliedMinor: canonicalUnapplied,
        status: canonicalStatus,
        allocationCount: seen.size,
    };
}

/**
 * Computes canonical unit balance from ALL posted ledger entries.
 */
async function replayCanonicalBalance(mgmtId, unitId) {
    const ledgerSnap = await db
        .collection(`managements/${mgmtId}/ledger`)
        .where("unitId", "==", unitId)
        .get();

    let postedDebitMinor = 0;
    let postedCreditMinor = 0;
    let entryCount = 0;

    for (const doc of ledgerSnap.docs) {
        const entry = doc.data();
        if (entry.status !== "posted") continue;
        if (entry.type === "DEBIT") postedDebitMinor += entry.amountMinor;
        else if (entry.type === "CREDIT") postedCreditMinor += entry.amountMinor;
        entryCount++;
    }

    return {
        balanceMinor: postedCreditMinor - postedDebitMinor,
        postedDebitMinor,
        postedCreditMinor,
        entryCount,
    };
}

////////////////////////////////////////////////////////////
// AUDIT REPLAY VERIFIER
////////////////////////////////////////////////////////////

async function runAuditReplay(mgmtId, unitId, label) {
    console.log(`\n  📋 AUDIT REPLAY: ${label}`);

    const ledgerSnap = await db
        .collection(`managements/${mgmtId}/ledger`)
        .where("unitId", "==", unitId)
        .get();

    const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // ── 1. Replay due aggregates ──────────────────────────────────
    const dues = entries.filter(
        (e) => e.type === "DEBIT" && e.status === "posted" && (e.source === "dues" || e.id.startsWith("expense_"))
    );

    for (const due of dues) {
        const storedTotal = due.dueTotalMinor ?? due.amountMinor;
        const storedAllocated = due.dueAllocatedMinor ?? 0;
        const storedOutstanding = due.dueOutstandingMinor ?? storedTotal;
        const storedStatus = due.dueStatus ?? "open";

        const canonical = await replayDueAggregates(mgmtId, due.id, storedTotal);

        assert(
            canonical.allocatedMinor === storedAllocated,
            `[DUE ${due.id}] replay allocatedMinor(${canonical.allocatedMinor}) === stored(${storedAllocated})`
        );
        assert(
            canonical.outstandingMinor === storedOutstanding,
            `[DUE ${due.id}] replay outstandingMinor(${canonical.outstandingMinor}) === stored(${storedOutstanding})`
        );
        assert(
            canonical.status === storedStatus,
            `[DUE ${due.id}] replay status(${canonical.status}) === stored(${storedStatus})`
        );
    }

    // ── 2. Replay payment aggregates ──────────────────────────────
    const payments = entries.filter(
        (e) => e.type === "CREDIT" && e.status === "posted" && e.id.startsWith("payment_")
    );

    for (const payment of payments) {
        const paymentTotal = payment.amountMinor;
        const storedApplied = payment.appliedMinor ?? 0;
        const storedUnapplied = payment.unappliedMinor ?? paymentTotal;
        const storedStatus = payment.allocationStatus ?? "unapplied";

        const canonical = await replayPaymentAggregates(mgmtId, payment.id, paymentTotal);

        assert(
            canonical.appliedMinor === storedApplied,
            `[PAY ${payment.id}] replay appliedMinor(${canonical.appliedMinor}) === stored(${storedApplied})`
        );
        assert(
            canonical.unappliedMinor === storedUnapplied,
            `[PAY ${payment.id}] replay unappliedMinor(${canonical.unappliedMinor}) === stored(${storedUnapplied})`
        );
        assert(
            canonical.status === storedStatus,
            `[PAY ${payment.id}] replay status(${canonical.status}) === stored(${storedStatus})`
        );
    }

    // ── 3. Replay settlement entry allocations ────────────────────
    const settlements = entries.filter(
        (e) => e.type === "CREDIT" && e.source === "auto_settlement" && e.status === "posted"
    );

    for (const s of settlements) {
        const allocSnap = await db
            .collection(`managements/${mgmtId}/dueAllocations`)
            .where("paymentEntryId", "==", s.id)
            .get();

        const allocSum = allocSnap.docs.reduce((sum, d) => sum + (d.data().amountMinor ?? 0), 0);
        assert(
            allocSum === s.amountMinor,
            `[SETTLE ${s.id}] sum(allocations)=${allocSum} === entry.amountMinor=${s.amountMinor}`
        );
    }

    // ── 4. Replay balance cache vs canonical ──────────────────────
    const canonical = await replayCanonicalBalance(mgmtId, unitId);

    // Wait for balance triggers
    await delay(3000);

    const balSnap = await db.doc(`managements/${mgmtId}/unitBalances/${unitId}`).get();
    if (balSnap.exists) {
        const cached = balSnap.data();
        assert(
            canonical.balanceMinor === cached.balanceMinor,
            `[BALANCE] canonical(${canonical.balanceMinor}) === cached(${cached.balanceMinor})`
        );
        assert(
            canonical.postedDebitMinor === cached.postedDebitMinor,
            `[BALANCE] canonical debit(${canonical.postedDebitMinor}) === cached(${cached.postedDebitMinor})`
        );
        assert(
            canonical.postedCreditMinor === cached.postedCreditMinor,
            `[BALANCE] canonical credit(${canonical.postedCreditMinor}) === cached(${cached.postedCreditMinor})`
        );
    }

    console.log(`  ✅ Audit Replay "${label}" — ALL AGGREGATES MATCH CANONICAL\n`);
}

////////////////////////////////////////////////////////////
// MAIN TEST
////////////////////////////////////////////////////////////

async function main() {
    console.log(`\n🔍 AUDIT REPLAY TEST (runId=${RUN_ID})\n`);
    console.log("=".repeat(60));

    const adminUid = `${RUN_ID}_admin`;
    const idToken = await getIdToken(adminUid);
    const mgmtId = `mgmt_${RUN_ID}`;
    const unitId = `unit_${RUN_ID}`;

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);
    console.log("✅ Seeded management + unit\n");

    // ================================================================
    // SCENARIO 1: Simple due + direct payment allocation
    // ================================================================
    console.log("━━━ Scenario 1: Due + Direct Payment Allocation ━━━");

    const due1 = (
        await callFunction("createExpense", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 50000,
            source: "dues",
            reference: "2026-01 Aidat",
            idempotencyKey: `${RUN_ID}_due1`,
            periodMonth: 0,
            periodYear: 2026,
        })
    ).entryId;

    const pay1 = (
        await callFunction("createPayment", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 50000,
            method: "cash",
            reference: "Payment 1",
            idempotencyKey: `${RUN_ID}_pay1`,
            relatedDueId: due1,
        })
    ).entryId;

    console.log(`  Created due1=${due1}, pay1=${pay1}`);
    await runAuditReplay(mgmtId, unitId, "Scenario 1: Simple allocation");

    // ================================================================
    // SCENARIO 2: Multiple dues + overpayment + autoSettle
    // ================================================================
    console.log("━━━ Scenario 2: Multiple Dues + Overpayment + AutoSettle ━━━");

    // Payment first (no new open dues → unapplied credit)
    const pay2 = (
        await callFunction("createPayment", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 120000,
            method: "bank",
            reference: "Payment 2 large",
            idempotencyKey: `${RUN_ID}_pay2`,
        })
    ).entryId;

    // 3 new dues
    const due2 = (
        await callFunction("createExpense", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 30000,
            source: "dues",
            reference: "2026-02 Aidat",
            idempotencyKey: `${RUN_ID}_due2`,
            periodMonth: 1,
            periodYear: 2026,
        })
    ).entryId;

    const due3 = (
        await callFunction("createExpense", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 40000,
            source: "dues",
            reference: "2026-03 Aidat",
            idempotencyKey: `${RUN_ID}_due3`,
            periodMonth: 2,
            periodYear: 2026,
        })
    ).entryId;

    const due4 = (
        await callFunction("createExpense", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 60000,
            source: "dues",
            reference: "2026-04 Aidat",
            idempotencyKey: `${RUN_ID}_due4`,
            periodMonth: 3,
            periodYear: 2026,
        })
    ).entryId;

    console.log(`  Created pay2=${pay2}, due2=${due2}, due3=${due3}, due4=${due4}`);

    // AutoSettle: 120k credit → should close due2(30k) + due3(40k) + due4(60k) = 130k
    // But only 120k available, so due2(30k) + due3(40k) = 70k → yes
    // due4(60k) → 70k+60k = 130k > 120k → can't close due4
    // Actually: auto settle closes only dues that fit fully
    // 120k >= 30k → close due2, remaining 90k
    // 90k >= 40k → close due3, remaining 50k
    // 50k < 60k → skip due4
    const settleResult = await callFunction("autoSettleFromCredit", idToken, {
        managementId: mgmtId,
        unitId,
    });
    console.log(`  AutoSettle: ${JSON.stringify(settleResult)}`);

    await runAuditReplay(mgmtId, unitId, "Scenario 2: After autoSettle");

    // ================================================================
    // SCENARIO 3: Partial payment on remaining due
    // ================================================================
    console.log("━━━ Scenario 3: Additional payment to partially-covered unit ━━━");

    const pay3 = (
        await callFunction("createPayment", idToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 60000,
            method: "cash",
            reference: "Payment 3 to close due4",
            idempotencyKey: `${RUN_ID}_pay3`,
            relatedDueId: due4,
        })
    ).entryId;

    console.log(`  Created pay3=${pay3}`);
    await runAuditReplay(mgmtId, unitId, "Scenario 3: All dues closed");

    // ================================================================
    // SCENARIO 4: Multi-payment source drain via autoSettle
    // ================================================================
    console.log("━━━ Scenario 4: Multi-payment FIFO drain ━━━");

    const unitId2 = `unit2_${RUN_ID}`;
    await seedUnit(mgmtId, unitId2);

    // 3 small payments first (no dues)
    await callFunction("createPayment", idToken, {
        managementId: mgmtId,
        unitId: unitId2,
        amountMinor: 20000,
        method: "cash",
        reference: "Small pay A",
        idempotencyKey: `${RUN_ID}_u2payA`,
    });
    await callFunction("createPayment", idToken, {
        managementId: mgmtId,
        unitId: unitId2,
        amountMinor: 15000,
        method: "bank",
        reference: "Small pay B",
        idempotencyKey: `${RUN_ID}_u2payB`,
    });
    await callFunction("createPayment", idToken, {
        managementId: mgmtId,
        unitId: unitId2,
        amountMinor: 25000,
        method: "cash",
        reference: "Small pay C",
        idempotencyKey: `${RUN_ID}_u2payC`,
    });

    // 1 due totaling 50k (less than total 60k credit)
    await callFunction("createExpense", idToken, {
        managementId: mgmtId,
        unitId: unitId2,
        amountMinor: 50000,
        source: "dues",
        reference: "2026-01 Aidat",
        idempotencyKey: `${RUN_ID}_u2due1`,
        periodMonth: 0,
        periodYear: 2026,
    });

    const settle2 = await callFunction("autoSettleFromCredit", idToken, {
        managementId: mgmtId,
        unitId: unitId2,
    });
    console.log(`  AutoSettle unit2: ${JSON.stringify(settle2)}`);

    await runAuditReplay(mgmtId, unitId2, "Scenario 4: Multi-payment FIFO drain");

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log("\n" + "=".repeat(60));
    console.log(
        `🎉 AUDIT REPLAY TEST COMPLETE — ${passCount} assertions passed, ${failCount} failures`
    );
    console.log("=".repeat(60));
    console.log("\n💡 THIS PROVES: All aggregate convenience fields can be ");
    console.log("   reconstructed from ledger + dueAllocations immutable sources.");
    console.log("   The financial engine is trustworthy.\n");
    process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("\n💥 AUDIT REPLAY FAILED:", err.message || err);
    process.exit(1);
});
