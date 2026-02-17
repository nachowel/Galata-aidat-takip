/**
 * autoSettleFromCredit — Concurrency Stress Test
 *
 * Senaryo:
 *   Aynı tenant/management altında aynı unitId için:
 *   - 2 açık due: 700 + 900 = 1600 toplam
 *   - 2 manual payment (bank + cash): 800 + 800 = 1600 toplam kredi
 *   - Aynı anda iki client gibi autoSettleFromCredit çağrısı (Promise.all)
 *
 * Beklentiler:
 *   B-1: Toplam kapanan due sayısı tam 2 (ne 0, ne 3, ne 4 — duplicate yok)
 *   B-2: totalSettledMinor toplamda 1600 (double settle yok)
 *   B-3: Her payment.unappliedMinor >= 0 (negatif yok)
 *   B-4: Toplam payment.unappliedMinor == 0 (tüm kredi tüketildi)
 *   B-5: dueAllocations'da duplicate yok (aynı dueId+sourcePaymentEntryId çifti max 1 kez)
 *   B-6: Her due.dueAllocatedMinor == due.dueTotalMinor (tam kapanma)
 *   B-7: Her due.dueStatus === "paid"
 *   B-8: settlement entry'lerin toplam amountMinor == 1600
 *
 * Kullanım:
 *   1. Emulator'u başlat: firebase emulators:start
 *   2. node functions/scripts/test-auto-settle-concurrency.mjs
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
const RUN_ID = `conc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

////////////////////////////////////////////////////////////
// HELPERS
////////////////////////////////////////////////////////////

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) {
    failCount++;
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  passCount++;
  console.log(`  ✓ ${message}`);
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

async function callFunctionSafe(name, idToken, data) {
  const url = `${FUNCTIONS_BASE}/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.json() };
}

async function callFunction(name, idToken, data) {
  const res = await callFunctionSafe(name, idToken, data);
  if (res.status !== 200) {
    const err = new Error(`${name} failed: ${JSON.stringify(res.body)}`);
    err.status = res.status;
    err.body = res.body;
    throw err;
  }
  return res.body.result;
}

async function seedManagement(mgmtId, adminUid) {
  await db.doc(`managements/${mgmtId}`).set({
    name: `Concurrency Test ${mgmtId}`,
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

////////////////////////////////////////////////////////////
// MAIN TEST
////////////////////////////////////////////////////////////

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  autoSettleFromCredit — Concurrency Stress Test`);
  console.log(`  runId: ${RUN_ID}`);
  console.log(`${"=".repeat(60)}\n`);

  const adminUid = `${RUN_ID}_admin`;
  const idToken = await getIdToken(adminUid);
  console.log("Authenticated\n");

  const mgmtId = `mgmt_${RUN_ID}`;
  const unitId = `unit_${RUN_ID}`;

  // ── SETUP ───────────────────────────────────────────────
  console.log("--- Setup ---");

  await seedManagement(mgmtId, adminUid);
  await seedUnit(mgmtId, unitId);
  console.log("  Management + Unit seeded");

  // Create 2 payments FIRST (no open dues → unapplied credit)
  // bank: 800, cash: 800 → toplam 1600
  const pay1 = await callFunction("createPayment", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor: 800,
    method: "bank",
    reference: "Advance Payment (Bank)",
    idempotencyKey: `${RUN_ID}_pay_bank`,
  });
  console.log(`  Payment 1 (bank/800): ${pay1.entryId} unapplied=${pay1.unappliedMinor}`);

  const pay2 = await callFunction("createPayment", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor: 800,
    method: "cash",
    reference: "Advance Payment (Cash)",
    idempotencyKey: `${RUN_ID}_pay_cash`,
  });
  console.log(`  Payment 2 (cash/800): ${pay2.entryId} unapplied=${pay2.unappliedMinor}`);

  // Now create 2 dues (after payments → no auto-allocation)
  // due1: 700, due2: 900 → toplam 1600
  const due1 = await callFunction("createExpense", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor: 700,
    source: "dues",
    reference: "2026-01 Aidat",
    idempotencyKey: `${RUN_ID}_due_jan`,
    periodMonth: 0,
    periodYear: 2026,
  });
  console.log(`  Due 1 (700): ${due1.entryId}`);

  const due2 = await callFunction("createExpense", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor: 900,
    source: "dues",
    reference: "2026-02 Aidat",
    idempotencyKey: `${RUN_ID}_due_feb`,
    periodMonth: 1,
    periodYear: 2026,
  });
  console.log(`  Due 2 (900): ${due2.entryId}`);

  // Verify pre-conditions
  const prePaySnap = await db
    .collection(`managements/${mgmtId}/ledger`)
    .where("unitId", "==", unitId)
    .where("type", "==", "CREDIT")
    .get();
  const preTotalUnapplied = prePaySnap.docs.reduce(
    (s, d) => s + (d.data().unappliedMinor ?? 0),
    0
  );
  console.log(`  Pre-settle total unapplied credit: ${preTotalUnapplied}`);
  assert(preTotalUnapplied === 1600, `Pre-settle unapplied === 1600 (got ${preTotalUnapplied})`);

  // ── CONCURRENT FIRE ─────────────────────────────────────
  console.log("\n--- Concurrent Fire ---");
  console.log("  Firing 2 autoSettleFromCredit calls simultaneously...\n");

  const [resA, resB] = await Promise.all([
    callFunctionSafe("autoSettleFromCredit", idToken, { managementId: mgmtId, unitId }),
    callFunctionSafe("autoSettleFromCredit", idToken, { managementId: mgmtId, unitId }),
  ]);

  const callerA = { status: resA.status, result: resA.body?.result, error: resA.body?.error };
  const callerB = { status: resB.status, result: resB.body?.result, error: resB.body?.error };

  console.log(`  Caller A: status=${callerA.status} ${callerA.result ? `closed=${callerA.result.closedDueCount} settled=${callerA.result.totalSettledMinor}` : `error=${callerA.error?.message}`}`);
  console.log(`  Caller B: status=${callerB.status} ${callerB.result ? `closed=${callerB.result.closedDueCount} settled=${callerB.result.totalSettledMinor}` : `error=${callerB.error?.message}`}`);

  const successes = [callerA, callerB].filter((c) => c.status === 200);
  const failures = [callerA, callerB].filter((c) => c.status !== 200);
  console.log(`\n  Successes: ${successes.length}, Failures: ${failures.length}`);

  // ── AGGREGATE ASSERTIONS ────────────────────────────────
  console.log("\n--- Aggregate Assertions ---");

  const totalClosedDueCount = successes.reduce((s, c) => s + (c.result?.closedDueCount ?? 0), 0);
  const totalSettledMinor = successes.reduce((s, c) => s + (c.result?.totalSettledMinor ?? 0), 0);

  // B-1: Toplam kapanan due sayısı tam 2
  assert(
    totalClosedDueCount === 2,
    `B-1 Toplam kapanan due == 2 (got ${totalClosedDueCount}).` +
      (totalClosedDueCount > 2
        ? " DUPLICATE SETTLEMENT DETECTED! autoSettleFromCredit is NOT concurrency-safe."
        : totalClosedDueCount < 2
          ? " NOT ALL DUES SETTLED. Possible transaction deadlock or partial failure."
          : "")
  );

  // B-2: totalSettledMinor toplamda 1600
  assert(
    totalSettledMinor === 1600,
    `B-2 Toplam settle == 1600 (got ${totalSettledMinor}).` +
      (totalSettledMinor > 1600
        ? " DOUBLE SETTLE! System settled more than available credit."
        : totalSettledMinor < 1600
          ? " UNDER-SETTLE! Not all eligible dues were settled."
          : "")
  );

  // ── LEDGER STATE VERIFICATION ───────────────────────────
  console.log("\n--- Ledger State Verification ---");

  const ledgerSnap = await db
    .collection(`managements/${mgmtId}/ledger`)
    .where("unitId", "==", unitId)
    .get();
  const allEntries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Source payments
  const sourcePayments = allEntries.filter(
    (e) => e.type === "CREDIT" && e.status === "posted" && (e.source === "bank" || e.source === "cash")
  );
  console.log(`  Source payments: ${sourcePayments.length}`);

  // B-3: Her payment.unappliedMinor >= 0
  for (const p of sourcePayments) {
    assert(
      (p.unappliedMinor ?? 0) >= 0,
      `B-3 Payment ${p.id}: unappliedMinor(${p.unappliedMinor}) >= 0` +
        ((p.unappliedMinor ?? 0) < 0
          ? " NEGATIVE UNAPPLIED! Credit was over-consumed."
          : "")
    );
  }

  // B-4: Toplam payment.unappliedMinor == 0
  const postTotalUnapplied = sourcePayments.reduce((s, p) => s + (p.unappliedMinor ?? 0), 0);
  assert(
    postTotalUnapplied === 0,
    `B-4 Toplam unapplied == 0 (got ${postTotalUnapplied}).` +
      (postTotalUnapplied > 0
        ? " Remaining credit not fully consumed."
        : postTotalUnapplied < 0
          ? " NEGATIVE TOTAL! Credit over-consumed."
          : "")
  );

  // Dues
  const dueEntries = allEntries.filter(
    (e) => e.type === "DEBIT" && e.status === "posted" && (e.source === "dues" || e.id.startsWith("expense_"))
  );
  console.log(`  Due entries: ${dueEntries.length}`);

  // B-6: Her due.dueAllocatedMinor == due.dueTotalMinor
  for (const d of dueEntries) {
    const total = d.dueTotalMinor ?? d.amountMinor;
    const allocated = d.dueAllocatedMinor ?? 0;
    assert(
      allocated === total,
      `B-6 Due ${d.id}: dueAllocatedMinor(${allocated}) === dueTotalMinor(${total})` +
        (allocated > total
          ? " OVER-ALLOCATION on due!"
          : allocated < total
            ? " UNDER-ALLOCATION on due — not fully settled."
            : "")
    );
  }

  // B-7: Her due.dueStatus === "paid"
  for (const d of dueEntries) {
    assert(
      d.dueStatus === "paid",
      `B-7 Due ${d.id}: dueStatus === "paid" (got "${d.dueStatus}")` +
        (d.dueStatus !== "paid"
          ? " Due still open after settlement!"
          : "")
    );
  }

  // Settlement entries
  const settlementEntries = allEntries.filter(
    (e) => e.type === "CREDIT" && e.source === "auto_settlement" && e.status === "posted"
  );
  console.log(`  Settlement entries: ${settlementEntries.length}`);

  // B-8: Settlement entry'lerin toplam amountMinor == 1600
  const settlementTotal = settlementEntries.reduce((s, e) => s + (e.amountMinor ?? 0), 0);
  assert(
    settlementTotal === 1600,
    `B-8 Settlement toplam amountMinor == 1600 (got ${settlementTotal}).` +
      (settlementTotal > 1600
        ? " DUPLICATE SETTLEMENT ENTRIES! More settlement than credit."
        : settlementTotal < 1600
          ? " MISSING SETTLEMENT ENTRIES!"
          : "")
  );

  // Check: each settlement references a distinct due
  const settledDueIds = settlementEntries.map((e) => e.relatedDueId).filter(Boolean);
  const uniqueSettledDueIds = [...new Set(settledDueIds)];
  assert(
    uniqueSettledDueIds.length === settledDueIds.length,
    `Settlement entries reference distinct dues: ${uniqueSettledDueIds.length} unique out of ${settledDueIds.length} total` +
      (uniqueSettledDueIds.length !== settledDueIds.length
        ? " DUPLICATE: same due settled multiple times!"
        : "")
  );

  // ── ALLOCATION DEDUPLICATION ────────────────────────────
  console.log("\n--- Allocation Deduplication ---");

  const allocSnap = await db
    .collection(`managements/${mgmtId}/dueAllocations`)
    .where("unitId", "==", unitId)
    .get();
  const allocs = allocSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`  Total allocations: ${allocs.length}`);

  // B-5: dueAllocations'da duplicate yok
  // Check: no two allocations share the same (dueId, paymentEntryId that is a source payment)
  // Note: autoSettleFromCredit creates settlement entries as the "payment" in allocations,
  // so the key pair is (dueId, paymentEntryId) for settlement-based allocations.
  const allocKeys = allocs.map((a) => `${a.dueId}__${a.paymentEntryId}`);
  const uniqueAllocKeys = [...new Set(allocKeys)];
  assert(
    uniqueAllocKeys.length === allocKeys.length,
    `B-5 No duplicate allocations: ${uniqueAllocKeys.length} unique out of ${allocKeys.length} total` +
      (uniqueAllocKeys.length !== allocKeys.length
        ? ` DUPLICATE ALLOCATION DETECTED! Keys: ${allocKeys.filter((k, i) => allocKeys.indexOf(k) !== i).join(", ")}`
        : "")
  );

  // Verify allocation amounts match settlement amounts
  for (const settlement of settlementEntries) {
    const relatedAllocs = allocs.filter((a) => a.paymentEntryId === settlement.id);
    const allocTotal = relatedAllocs.reduce((s, a) => s + (a.amountMinor ?? 0), 0);
    assert(
      allocTotal === settlement.amountMinor,
      `Allocation total for ${settlement.id} === ${settlement.amountMinor} (got ${allocTotal})`
    );
  }

  // ── AUDIT LOG CHECK ─────────────────────────────────────
  console.log("\n--- Audit Log Check ---");

  const auditSnap = await db
    .collection(`managements/${mgmtId}/auditLogs`)
    .where("action", "==", "AUTO_CREDIT_SETTLEMENT")
    .get();
  const auditEntries = auditSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`  Audit entries: ${auditEntries.length}`);

  // Audit log may have 1 or 2 entries (duplicate writes are acceptable)
  // but the financial state must reflect single settlement
  if (auditEntries.length === 1) {
    console.log("  Single audit entry — one caller won the race, other failed.");
  } else if (auditEntries.length === 2) {
    console.log("  Two audit entries — both callers wrote audit logs.");
    console.log("  (Acceptable if financial state is still correct — verified above)");
  }

  // ── SUMMARY ─────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  if (failCount === 0) {
    console.log(`  ALL CONCURRENCY TESTS PASSED (${passCount} assertions, 0 failures)`);
    console.log(`\n  Concurrent autoSettleFromCredit is SAFE:`);
    console.log(`    - No double settlement`);
    console.log(`    - No negative unapplied`);
    console.log(`    - No duplicate allocations`);
    console.log(`    - All dues fully paid`);
    console.log(`    - Credit fully consumed`);
  } else {
    console.log(`  CONCURRENCY TEST FAILED (${passCount} passed, ${failCount} FAILED)`);
    console.log(`\n  autoSettleFromCredit has CONCURRENCY ISSUES.`);
    console.log(`  Review the failure messages above for details.`);
  }
  console.log(`${"=".repeat(60)}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nTEST CRASHED:", err.message || err);
  process.exit(1);
});
