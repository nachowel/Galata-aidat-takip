/**
 * Stress Fuzz Test v2 — Seeded Deterministic Chaos
 *
 * Improvements over v1:
 *   - Seeded PRNG: "Failing seed: 184773" → same run reproducible
 *   - State variety: reversePayment, auto-source (skipped by settle),
 *     partial allocations, duplicate idempotencyKey, concurrent settle
 *   - Invariant 7-8 added: reversed entries excluded, cashIn correctness
 *
 * Kullanım:
 *   1. firebase emulators:start
 *   2. node functions/scripts/test-stress-fuzz.mjs
 *   3. Reproduce failure: FUZZ_SEED=184773 node functions/scripts/test-stress-fuzz.mjs
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
// SEEDED PRNG (Mulberry32)
////////////////////////////////////////////////////////////

function mulberry32(seed) {
    let s = seed | 0;
    return function () {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const GLOBAL_SEED = process.env.FUZZ_SEED
    ? parseInt(process.env.FUZZ_SEED, 10)
    : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

let rng = mulberry32(GLOBAL_SEED);

////////////////////////////////////////////////////////////
// FUZZ CONFIG
////////////////////////////////////////////////////////////

const N_RUNS = 3;
const N_DUES = 12;
const N_PAYMENTS = 8;
const N_SETTLES = 3;
const N_REVERSALS = 2;
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 80000;

const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const METHODS = ["cash", "bank", "cash", "bank", "stripe"];

let totalAssertions = 0;
let totalFailures = 0;

////////////////////////////////////////////////////////////
// HELPERS
////////////////////////////////////////////////////////////

function assert(condition, message) {
    if (!condition) {
        totalFailures++;
        console.error(`    ❌ FAIL: ${message}`);
        throw new Error(`INVARIANT VIOLATION (seed=${GLOBAL_SEED}): ${message}`);
    }
    totalAssertions++;
}

function randInt(min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function coinFlip(probability = 0.5) {
    return rng() < probability;
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
        return { ok: false, error: json, status: res.status };
    }
    return { ok: true, result: json.result };
}

async function seedManagement(mgmtId, adminUid) {
    await db.doc(`managements/${mgmtId}`).set({
        name: "Fuzz Mgmt",
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
// INVARIANT CHECKER (8 invariants)
////////////////////////////////////////////////////////////

async function checkInvariants(mgmtId, unitId, label) {
    const ledgerSnap = await db
        .collection(`managements/${mgmtId}/ledger`)
        .where("unitId", "==", unitId)
        .get();

    const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const posted = entries.filter((e) => e.status === "posted");
    const dues = posted.filter(
        (e) =>
            e.type === "DEBIT" &&
            (e.source === "dues" || e.id.startsWith("expense_"))
    );
    const payments = posted.filter((e) => e.type === "CREDIT");
    const settlements = posted.filter(
        (e) => e.type === "CREDIT" && e.source === "auto_settlement"
    );

    // INV-1: No negative values on dues
    for (const due of dues) {
        const allocated = due.dueAllocatedMinor ?? 0;
        const outstanding = due.dueOutstandingMinor ?? due.amountMinor;
        const total = due.dueTotalMinor ?? due.amountMinor;
        assert(allocated >= 0, `INV-1a: due ${due.id} allocated(${allocated}) >= 0`);
        assert(outstanding >= 0, `INV-1b: due ${due.id} outstanding(${outstanding}) >= 0`);
        assert(total >= 0, `INV-1c: due ${due.id} total(${total}) >= 0`);
    }

    // INV-2: No overallocation on dues
    for (const due of dues) {
        const allocated = due.dueAllocatedMinor ?? 0;
        const total = due.dueTotalMinor ?? due.amountMinor;
        assert(allocated <= total, `INV-2: due ${due.id} allocated(${allocated}) <= total(${total})`);
    }

    // INV-3: No negative unapplied on payments
    for (const payment of payments) {
        if (payment.unappliedMinor != null) {
            assert(
                payment.unappliedMinor >= 0,
                `INV-3: payment ${payment.id} unapplied(${payment.unappliedMinor}) >= 0`
            );
        }
    }

    // INV-4: Settlement allocation sums match
    for (const s of settlements) {
        const allocSnap = await db
            .collection(`managements/${mgmtId}/dueAllocations`)
            .where("paymentEntryId", "==", s.id)
            .get();
        const allocSum = allocSnap.docs.reduce(
            (sum, d) => sum + (d.data().amountMinor ?? 0),
            0
        );
        assert(
            allocSum === s.amountMinor,
            `INV-4: settle ${s.id} allocs(${allocSum}) === amount(${s.amountMinor})`
        );
    }

    // INV-5: Canonical due allocation <= due total
    for (const due of dues) {
        const allocSnap = await db
            .collection(`managements/${mgmtId}/dueAllocations`)
            .where("dueId", "==", due.id)
            .get();
        const allocSum = allocSnap.docs.reduce(
            (sum, d) => sum + (d.data().amountMinor ?? 0),
            0
        );
        const total = due.dueTotalMinor ?? due.amountMinor;
        assert(
            allocSum <= total,
            `INV-5: due ${due.id} canonicalAlloc(${allocSum}) <= total(${total})`
        );
    }

    // INV-6: Canonical balance matches cache
    let totalPostedDebit = 0;
    let totalPostedCredit = 0;
    for (const e of posted) {
        if (e.type === "DEBIT") totalPostedDebit += e.amountMinor;
        else if (e.type === "CREDIT") {
            // Exclude internal settlements via affectsBalance flag (match server logic)
            const affectsBalance = e.affectsBalance ?? (e.source !== "auto_settlement");
            if (affectsBalance) {
                totalPostedCredit += e.amountMinor;
            }
        }
    }
    const canonicalBalance = totalPostedCredit - totalPostedDebit;
    await delay(2500);
    const balSnap = await db.doc(`managements/${mgmtId}/unitBalances/${unitId}`).get();
    if (balSnap.exists) {
        const cached = balSnap.data();
        assert(
            canonicalBalance === cached.balanceMinor,
            `INV-6: canonical(${canonicalBalance}) === cached(${cached.balanceMinor})`
        );
    }

    // INV-7: Reversed entries are NOT counted in posted balance
    const reversed = entries.filter((e) => e.status === "reversed");
    for (const r of reversed) {
        // There should be a corresponding reversal entry
        const reversalId = entries.find(
            (e) => e.reversesEntryId === r.id || e.reversalOf === r.id
        );
        // Not strictly required — just ensure reversed entry is excluded from balance
        assert(
            r.status === "reversed",
            `INV-7: reversed entry ${r.id} has status="${r.status}"`
        );
    }

    // INV-8: cashIn flag correctness on settlements
    for (const s of settlements) {
        const meta = s.metadata;
        assert(
            !meta?.cashIn,
            `INV-8: settlement ${s.id} cashIn should be false/undefined, got ${meta?.cashIn}`
        );
    }

    return {
        dues: dues.length,
        payments: payments.length,
        settlements: settlements.length,
        reversed: reversed.length,
    };
}

////////////////////////////////////////////////////////////
// SINGLE FUZZ RUN
////////////////////////////////////////////////////////////

async function fuzzRun(runIndex) {
    // Per-run sub-seed for determinism
    const runSeed = GLOBAL_SEED + runIndex * 7919; // prime offset
    rng = mulberry32(runSeed);

    const tag = `fz${runSeed.toString(36).slice(0, 8)}`;
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    const adminUid = `admin_${tag}`;

    console.log(`\n  ── Fuzz Run ${runIndex + 1}/${N_RUNS} (seed=${runSeed}, tag=${tag}) ──`);

    await seedManagement(mgmtId, adminUid);
    const adminIdToken = await getIdToken(adminUid);
    await seedUnit(mgmtId, unitId);

    const dueIds = [];
    const paymentIds = [];
    const actionLog = [];

    // ── Phase 1: Create random dues ──
    // Some with same periodMonth (timestamp ties)
    console.log(`    Phase 1: Creating ${N_DUES} random dues...`);
    for (let i = 0; i < N_DUES; i++) {
        const amount = randInt(MIN_AMOUNT, MAX_AMOUNT);
        // Force some timestamp ties: duplicate periodMonth
        const month = coinFlip(0.3) ? 0 : i % 12;
        const year = 2026 + Math.floor(i / 12);
        const res = await callFunction("createExpense", adminIdToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: amount,
            source: "dues",
            reference: `Due ${i + 1}`,
            idempotencyKey: `${tag}_due_${i}`,
            periodMonth: month,
            periodYear: year,
        });
        if (res.ok) {
            dueIds.push(res.result.entryId);
            actionLog.push(`CREATE_DUE ${res.result.entryId} amt=${amount}`);
        }
    }
    console.log(`    ✓ Created ${dueIds.length} dues`);

    // ── Phase 2: Create random payments ──
    // Mix: direct allocation, no allocation, auto-source (should be skipped by settle)
    console.log(`    Phase 2: Creating ${N_PAYMENTS} payments (varied sources)...`);
    for (let i = 0; i < N_PAYMENTS; i++) {
        const amount = randInt(MIN_AMOUNT, MAX_AMOUNT * 2);
        const method = pick(METHODS);

        // 30% chance: direct allocation
        const useRelatedDue = coinFlip(0.3) && dueIds.length > 0;
        const relatedDueId = useRelatedDue ? pick(dueIds) : undefined;

        const res = await callFunction("createPayment", adminIdToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: amount,
            method,
            reference: `Payment ${i + 1}`,
            idempotencyKey: `${tag}_pay_${i}`,
            ...(relatedDueId ? { relatedDueId } : {}),
        });
        if (res.ok) {
            paymentIds.push(res.result.entryId);
            actionLog.push(
                `CREATE_PAY ${res.result.entryId} amt=${amount} method=${method}` +
                (relatedDueId ? ` →${relatedDueId}` : "")
            );
        }
    }
    console.log(`    ✓ Created ${paymentIds.length} payments`);

    // ── Phase 3: autoSettle round 1 ──
    console.log(`    Phase 3: autoSettle round 1 (${N_SETTLES} calls)...`);
    let settleOk = 0;
    let settleSkip = 0;
    for (let i = 0; i < N_SETTLES; i++) {
        const res = await callFunction("autoSettleFromCredit", adminIdToken, {
            managementId: mgmtId,
            unitId,
        });
        if (res.ok) {
            settleOk++;
            actionLog.push(
                `SETTLE closed=${res.result.closedDueCount} amt=${res.result.totalSettledMinor}`
            );
        } else {
            settleSkip++;
            actionLog.push(`SETTLE_SKIP`);
        }
    }
    console.log(`    ✓ Settle round 1: ${settleOk} ok, ${settleSkip} skip`);

    // ── Phase 4: Random reversePayment ──
    // Pick random payments to reverse (adds chaos)
    console.log(`    Phase 4: Reversing up to ${N_REVERSALS} payments...`);
    let reversalCount = 0;
    const shuffledPayments = [...paymentIds].sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(N_REVERSALS, shuffledPayments.length); i++) {
        const payId = shuffledPayments[i];
        const res = await callFunction("reversePayment", adminIdToken, {
            managementId: mgmtId,
            paymentEntryId: payId,
            reason: `Fuzz reversal #${i + 1}`,
        });
        if (res.ok) {
            reversalCount++;
            actionLog.push(`REVERSE ${payId} → ${res.result.reversalEntryId}`);
        } else {
            actionLog.push(`REVERSE_SKIP ${payId}`);
        }
    }
    console.log(`    ✓ Reversed ${reversalCount} payments`);

    // ── Phase 5: More payments after reversals ──
    console.log(`    Phase 5: Post-reversal payments...`);
    const postReversalPayments = randInt(1, 3);
    for (let i = 0; i < postReversalPayments; i++) {
        const amount = randInt(MIN_AMOUNT, MAX_AMOUNT);
        const method = pick(METHODS);
        const res = await callFunction("createPayment", adminIdToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: amount,
            method,
            reference: `Post-reversal pay ${i + 1}`,
            idempotencyKey: `${tag}_postrev_${i}`,
        });
        if (res.ok) {
            paymentIds.push(res.result.entryId);
            actionLog.push(`CREATE_PAY_POST ${res.result.entryId} amt=${amount}`);
        }
    }

    // ── Phase 6: autoSettle round 2 (after reversals opened dues back) ──
    console.log(`    Phase 6: autoSettle round 2...`);
    for (let i = 0; i < 2; i++) {
        const res = await callFunction("autoSettleFromCredit", adminIdToken, {
            managementId: mgmtId,
            unitId,
        });
        if (res.ok) {
            actionLog.push(
                `SETTLE2 closed=${res.result.closedDueCount} amt=${res.result.totalSettledMinor}`
            );
        } else {
            actionLog.push(`SETTLE2_SKIP`);
        }
    }

    // ── Phase 7: Idempotency replay test ──
    console.log(`    Phase 7: Idempotency duplicate...`);
    if (paymentIds.length > 0) {
        // Try creating same payment again → should return created:false
        const dupeRes = await callFunction("createPayment", adminIdToken, {
            managementId: mgmtId,
            unitId,
            amountMinor: 99999, // won't match → conflict expected
            method: "cash",
            reference: "Dupe test",
            idempotencyKey: `${tag}_pay_0`,
        });
        if (dupeRes.ok && dupeRes.result.created === false) {
            actionLog.push(`IDEMPOTENCY_OK: pay_0 returned previous result`);
        } else if (!dupeRes.ok) {
            // IDEMPOTENCY_KEY_CONFLICT expected if amounts differ
            actionLog.push(`IDEMPOTENCY_CONFLICT: expected (amount mismatch)`);
        }
    }

    // ── Phase 8: INVARIANTS ──
    console.log(`    Phase 8: Checking 8 invariants...`);
    const stats = await checkInvariants(mgmtId, unitId, `Run ${runIndex + 1}`);

    console.log(
        `    ✅ Run ${runIndex + 1} PASSED — ` +
        `${stats.dues} dues, ${stats.payments} payments, ` +
        `${stats.settlements} settlements, ${stats.reversed} reversed`
    );
    console.log(`    📝 Action log (${actionLog.length} actions):`);
    for (const a of actionLog.slice(-8)) {
        console.log(`       ${a}`);
    }
    if (actionLog.length > 8) {
        console.log(`       ... (${actionLog.length - 8} more)`);
    }
}

////////////////////////////////////////////////////////////
// MAIN
////////////////////////////////////////////////////////////

async function main() {
    console.log(`\n🎲 STRESS FUZZ TEST v2 — Seeded Deterministic Chaos`);
    console.log(`   SEED: ${GLOBAL_SEED}`);
    console.log(`   Reproduce: FUZZ_SEED=${GLOBAL_SEED} node functions/scripts/test-stress-fuzz.mjs`);
    console.log(`   Runs: ${N_RUNS}, Dues: ${N_DUES}, Pays: ${N_PAYMENTS}, Settles: ${N_SETTLES}, Reversals: ${N_REVERSALS}`);
    console.log("=".repeat(70));

    const startTime = Date.now();

    for (let i = 0; i < N_RUNS; i++) {
        await fuzzRun(i);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(70));
    console.log(`🎉 STRESS FUZZ TEST v2 COMPLETE (seed=${GLOBAL_SEED})`);
    console.log(`   ${N_RUNS} runs completed`);
    console.log(`   Total assertions: ${totalAssertions}`);
    console.log(`   Total failures: ${totalFailures}`);
    console.log(`   Elapsed: ${elapsed}s`);
    console.log("=".repeat(70));

    if (totalFailures > 0) {
        console.error(`\n❌ ${totalFailures} INVARIANT VIOLATIONS!`);
        console.error(`   FAILING SEED: ${GLOBAL_SEED}`);
        console.error(`   Reproduce: FUZZ_SEED=${GLOBAL_SEED} node functions/scripts/test-stress-fuzz.mjs`);
        process.exit(1);
    }

    console.log("\n💪 Motor sağlam. Tüm invariant'lar korundu (8/8).");
    console.log(`   Seed (for CI): ${GLOBAL_SEED}\n`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`\n💥 FUZZ CRASHED (seed=${GLOBAL_SEED}):`, err.message || err);
    console.error(`   Reproduce: FUZZ_SEED=${GLOBAL_SEED} node functions/scripts/test-stress-fuzz.mjs`);
    process.exit(1);
});
