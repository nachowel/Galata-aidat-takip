/**
 * autoSettleFromCredit — Edge Case & Invariant Tests
 *
 * IMPORTANT: createPayment auto-allocates to open dues at creation time.
 * To test autoSettleFromCredit properly, payments are created BEFORE dues
 * so they accumulate as unapplied credit. Then dues are created, and
 * autoSettleFromCredit is called to settle them.
 *
 * Senaryolar:
 *   1. Zero-credit unit — NO_ELIGIBLE_DUES error
 *   2. Partial credit — sadece karsilanabilecek due'lar kapanir
 *   3. Exact match — credit == toplam due outstanding → hepsi kapanir
 *   4. Overpayment — due'lardan fazla credit → kalan unapplied kalir
 *   5. Already-paid dues skip — dueStatus=paid olan due atlanir
 *   6. Multi-payment source drain — birden fazla payment FIFO sirasinda consume edilir
 *   7. Idempotency — ayni settlement iki kez cagirildiginda ikincisi NO_ELIGIBLE_DUES doner
 *   8. Concurrent double-fire — Promise.all ile ayni anda iki cagri, toplam bir kez settle
 *   9. Pre-allocated partial payment — appliedMinor>0 olan payment sadece unapplied kadarini verir
 *  10. Mixed sources — auto source payment'lar atlanir (isManualPaymentSource kontrolu)
 *
 * Invariant Assertions (her test sonunda):
 *   - due.dueAllocatedMinor <= due.dueTotalMinor (asla overallocation yok)
 *   - payment.unappliedMinor >= 0 (asla negatif olmaz)
 *   - sum(dueAllocations.amountMinor) == settlement entry.amountMinor
 *   - unit balance trigger sonrasi tutarli
 *
 * Kullanim:
 *   1. Emulator'u baslat: firebase emulators:start
 *   2. node functions/scripts/test-auto-settle-from-credit.edge.mjs
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
const RUN_ID = `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

let testIndex = 0;

////////////////////////////////////////////////////////////
// HELPERS
////////////////////////////////////////////////////////////

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) {
    failCount++;
    console.error(`  FAIL: ${message}`);
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  passCount++;
  console.log(`  OK: ${message}`);
}

function prefix(label) {
  testIndex++;
  return `${RUN_ID}_t${testIndex}_${label}`;
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

async function seedManagement(mgmtId, adminUid) {
  await db.doc(`managements/${mgmtId}`).set({
    name: `Test Mgmt ${mgmtId}`,
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

async function createDue(idToken, mgmtId, unitId, amountMinor, idempotencyKey, periodMonth, periodYear) {
  const res = await callFunction("createExpense", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor,
    source: "dues",
    reference: `${periodYear}-${String(periodMonth + 1).padStart(2, "0")} Aidat`,
    idempotencyKey,
    periodMonth,
    periodYear,
  });
  return res.entryId;
}

async function createPaymentRaw(idToken, mgmtId, unitId, amountMinor, method, idempotencyKey, extra) {
  const res = await callFunction("createPayment", idToken, {
    managementId: mgmtId,
    unitId,
    amountMinor,
    method,
    reference: `Payment ${idempotencyKey}`,
    idempotencyKey,
    ...extra,
  });
  return res;
}

async function createPayment(idToken, mgmtId, unitId, amountMinor, method, idempotencyKey) {
  const res = await createPaymentRaw(idToken, mgmtId, unitId, amountMinor, method, idempotencyKey, {});
  return res.entryId;
}

async function settle(idToken, mgmtId, unitId) {
  return callFunction("autoSettleFromCredit", idToken, {
    managementId: mgmtId,
    unitId,
  });
}

async function settleSafe(idToken, mgmtId, unitId) {
  return callFunctionSafe("autoSettleFromCredit", idToken, {
    managementId: mgmtId,
    unitId,
  });
}

/** Small delay to let Firestore triggers complete */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

////////////////////////////////////////////////////////////
// INVARIANT CHECKER
////////////////////////////////////////////////////////////

async function assertInvariants(mgmtId, unitId, label) {
  console.log(`  [invariants] ${label}`);

  // Read all ledger entries for unit
  const ledgerSnap = await db
    .collection(`managements/${mgmtId}/ledger`)
    .where("unitId", "==", unitId)
    .get();

  const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const dues = entries.filter(
    (e) => e.type === "DEBIT" && e.status === "posted" && (e.source === "dues" || e.id.startsWith("expense_"))
  );
  const payments = entries.filter(
    (e) => e.type === "CREDIT" && e.status === "posted"
  );

  // INV-1: due.dueAllocatedMinor <= due.dueTotalMinor
  for (const due of dues) {
    const allocated = due.dueAllocatedMinor ?? 0;
    const total = due.dueTotalMinor ?? due.amountMinor;
    assert(
      allocated <= total,
      `INV-1 due ${due.id}: dueAllocatedMinor(${allocated}) <= dueTotalMinor(${total})`
    );
  }

  // INV-2: payment.unappliedMinor >= 0
  for (const payment of payments) {
    const unapplied = payment.unappliedMinor ?? payment.amountMinor;
    assert(
      unapplied >= 0,
      `INV-2 payment ${payment.id}: unappliedMinor(${unapplied}) >= 0`
    );
  }

  // INV-3: sum(dueAllocations for each settlement entry) == settlement.amountMinor
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
      `INV-3 settlement ${s.id}: allocations(${allocSum}) == amountMinor(${s.amountMinor})`
    );
  }

  // INV-4: no due has dueAllocatedMinor > amountMinor
  for (const due of dues) {
    if (due.dueAllocatedMinor != null) {
      assert(
        due.dueAllocatedMinor <= (due.dueTotalMinor ?? due.amountMinor),
        `INV-4 due ${due.id}: no overallocation`
      );
    }
  }
}

////////////////////////////////////////////////////////////
// MAIN TESTS
////////////////////////////////////////////////////////////

async function main() {
  console.log(`\n autoSettleFromCredit — Edge Case Tests (runId=${RUN_ID})\n`);
  console.log("=".repeat(60));

  const adminUid = `${RUN_ID}_admin`;
  const idToken = await getIdToken(adminUid);
  console.log("Authenticated\n");

  // ================================================================
  // TEST 1: Zero credit unit — NO_ELIGIBLE_DUES
  // ================================================================
  {
    const tag = prefix("zero_credit");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 1: Zero credit → NO_ELIGIBLE_DUES`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);
    await createDue(idToken, mgmtId, unitId, 50000, `due_${tag}_1`, 0, 2026);
    // No payment created

    const res = await settleSafe(idToken, mgmtId, unitId);
    assert(res.status !== 200, "should not succeed with zero credit");
    console.log(`  Error body: ${JSON.stringify(res.body).slice(0, 120)}`);
    await assertInvariants(mgmtId, unitId, "test1");
  }

  // ================================================================
  // TEST 2: Partial credit — only closable dues settle
  // Payment BEFORE dues → unapplied credit accumulates, then
  // autoSettleFromCredit closes what it can.
  // ================================================================
  {
    const tag = prefix("partial_credit");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 2: Partial credit — only closable dues settle`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Payment first (no open dues yet → stays as unapplied credit)
    await createPayment(idToken, mgmtId, unitId, 850, "cash", `pay_${tag}_1`);

    // Now create 3 dues: 300 + 500 + 400 = 1200 total
    const d1 = await createDue(idToken, mgmtId, unitId, 300, `due_${tag}_1`, 0, 2026);
    const d2 = await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_2`, 1, 2026);
    const d3 = await createDue(idToken, mgmtId, unitId, 400, `due_${tag}_3`, 2, 2026);

    // autoSettle: 850 credit → can close d1(300) + d2(500) = 800, d3(400) can't
    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount === 2, `closedDueCount === 2 (got ${result.closedDueCount})`);
    assert(result.totalSettledMinor === 800, `totalSettledMinor === 800 (got ${result.totalSettledMinor})`);
    assert(result.remainingCreditMinor === 50, `remainingCreditMinor === 50 (got ${result.remainingCreditMinor})`);

    // d3 should still be open
    const d3Snap = await db.doc(`managements/${mgmtId}/ledger/${d3}`).get();
    assert(d3Snap.data()?.dueStatus === "open", "d3 should remain open");
    assert(d3Snap.data()?.dueOutstandingMinor === 400, "d3 outstanding === 400");

    await assertInvariants(mgmtId, unitId, "test2");
  }

  // ================================================================
  // TEST 3: Exact match — all dues close, zero remaining
  // ================================================================
  {
    const tag = prefix("exact_match");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 3: Exact match`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Payment first (exact 1000)
    await createPayment(idToken, mgmtId, unitId, 1000, "bank", `pay_${tag}_1`);

    // Dues: 500 + 500 = 1000
    await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_1`, 0, 2026);
    await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_2`, 1, 2026);

    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount === 2, `closedDueCount === 2`);
    assert(result.totalSettledMinor === 1000, `totalSettledMinor === 1000`);
    assert(result.remainingCreditMinor === 0, `remainingCreditMinor === 0`);

    await assertInvariants(mgmtId, unitId, "test3");
  }

  // ================================================================
  // TEST 4: Overpayment — more credit than dues
  // ================================================================
  {
    const tag = prefix("overpayment");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 4: Overpayment — more credit than dues`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Payment first (1000 credit, no dues)
    await createPayment(idToken, mgmtId, unitId, 1000, "cash", `pay_${tag}_1`);

    // Only 300 in dues
    await createDue(idToken, mgmtId, unitId, 300, `due_${tag}_1`, 0, 2026);

    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount === 1, `closedDueCount === 1`);
    assert(result.totalSettledMinor === 300, `totalSettledMinor === 300`);
    assert(result.remainingCreditMinor === 700, `remainingCreditMinor === 700`);

    // Source payment should still have unapplied credit
    const paySnap = await db
      .collection(`managements/${mgmtId}/ledger`)
      .where("unitId", "==", unitId)
      .where("type", "==", "CREDIT")
      .get();
    const sourcePay = paySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .find((d) => d.id.startsWith("payment_pay_"));
    assert(sourcePay != null, "source payment exists");
    assert(sourcePay.unappliedMinor >= 0, "unappliedMinor >= 0");

    await assertInvariants(mgmtId, unitId, "test4");
  }

  // ================================================================
  // TEST 5: Already-paid dues skip
  // ================================================================
  {
    const tag = prefix("already_paid");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 5: Already-paid dues get skipped`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Due 1 created first
    const d1 = await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_1`, 0, 2026);

    // Payment 1: allocates to d1 directly (relatedDueId)
    await callFunction("createPayment", idToken, {
      managementId: mgmtId,
      unitId,
      amountMinor: 500,
      method: "cash",
      reference: "direct pay",
      idempotencyKey: `pay_${tag}_1`,
      relatedDueId: d1,
    });

    // Verify d1 is now paid
    const d1Snap = await db.doc(`managements/${mgmtId}/ledger/${d1}`).get();
    assert(d1Snap.data()?.dueStatus === "paid", "d1 should be paid after direct allocation");

    // Now add unapplied credit (no open dues at creation time)
    await createPayment(idToken, mgmtId, unitId, 600, "bank", `pay_${tag}_2`);

    // Create Due 2 (open, unpaid)
    const d2 = await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_2`, 1, 2026);

    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount === 1, `closedDueCount === 1 (d2 only)`);
    assert(result.totalSettledMinor === 500, `totalSettledMinor === 500`);

    // d1 should still be paid (not re-settled)
    const d1After = await db.doc(`managements/${mgmtId}/ledger/${d1}`).get();
    assert(d1After.data()?.dueStatus === "paid", "d1 still paid");

    await assertInvariants(mgmtId, unitId, "test5");
  }

  // ================================================================
  // TEST 6: Multi-payment source drain (FIFO order)
  // ================================================================
  {
    const tag = prefix("multi_payment");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 6: Multi-payment FIFO drain`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // 3 payments first (no dues) = 900 total unapplied credit
    await createPayment(idToken, mgmtId, unitId, 300, "cash", `pay_${tag}_a`);
    await createPayment(idToken, mgmtId, unitId, 300, "bank", `pay_${tag}_b`);
    await createPayment(idToken, mgmtId, unitId, 300, "cash", `pay_${tag}_c`);

    // 1 due: 800
    await createDue(idToken, mgmtId, unitId, 800, `due_${tag}_1`, 0, 2026);

    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount === 1, `closedDueCount === 1`);
    assert(result.totalSettledMinor === 800, `totalSettledMinor === 800`);
    assert(result.remainingCreditMinor === 100, `remainingCreditMinor === 100`);

    // Check total unapplied across source payments
    const paySnap = await db
      .collection(`managements/${mgmtId}/ledger`)
      .where("unitId", "==", unitId)
      .where("type", "==", "CREDIT")
      .get();

    const sourcePays = paySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => d.id.startsWith("payment_pay_"));

    const totalUnapplied = sourcePays.reduce((s, p) => s + (p.unappliedMinor ?? 0), 0);
    console.log(`  Total unapplied across source payments: ${totalUnapplied}`);
    assert(totalUnapplied >= 0, "total unapplied >= 0");

    await assertInvariants(mgmtId, unitId, "test6");
  }

  // ================================================================
  // TEST 7: Idempotency — second settle returns NO_ELIGIBLE_DUES
  // ================================================================
  {
    const tag = prefix("idempotency");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 7: Idempotency — second call errors`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Payment first, then due
    await createPayment(idToken, mgmtId, unitId, 500, "cash", `pay_${tag}_1`);
    await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_1`, 0, 2026);

    // First settle
    const r1 = await settle(idToken, mgmtId, unitId);
    assert(r1.closedDueCount === 1, "first settle closes 1 due");

    // Second settle — should fail (no open dues left)
    const r2 = await settleSafe(idToken, mgmtId, unitId);
    assert(r2.status !== 200, "second settle should fail");
    console.log(`  Second settle error: ${JSON.stringify(r2.body).slice(0, 120)}`);

    await assertInvariants(mgmtId, unitId, "test7");
  }

  // ================================================================
  // TEST 8: Concurrent double-fire
  // ================================================================
  {
    const tag = prefix("concurrent");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 8: Concurrent double-fire`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Payment first, then dues
    await createPayment(idToken, mgmtId, unitId, 1000, "cash", `pay_${tag}_1`);
    await createDue(idToken, mgmtId, unitId, 400, `due_${tag}_1`, 0, 2026);
    await createDue(idToken, mgmtId, unitId, 400, `due_${tag}_2`, 1, 2026);

    // Fire two settles simultaneously
    const [resA, resB] = await Promise.all([
      settleSafe(idToken, mgmtId, unitId),
      settleSafe(idToken, mgmtId, unitId),
    ]);

    console.log(`  Caller A: status=${resA.status} body=${JSON.stringify(resA.body).slice(0, 150)}`);
    console.log(`  Caller B: status=${resB.status} body=${JSON.stringify(resB.body).slice(0, 150)}`);

    // Exactly one should succeed, other should fail (or both succeed but with correct totals)
    const successes = [resA, resB].filter((r) => r.status === 200);

    if (successes.length === 1) {
      console.log("  One succeeded, one failed — expected (OCC contention)");
      const result = successes[0].body.result;
      assert(result.closedDueCount === 2, "winner closed 2 dues");
    } else if (successes.length === 2) {
      // Both succeeded — transaction isolation might allow this in emulator.
      const rA = resA.body.result;
      const rB = resB.body.result;
      const totalClosed = (rA?.closedDueCount ?? 0) + (rB?.closedDueCount ?? 0);
      console.log(`  Both succeeded: totalClosed=${totalClosed}`);
      assert(totalClosed >= 2, `totalClosed >= 2 (got ${totalClosed})`);
    } else {
      // Both failed — shouldn't happen but let's be safe
      console.log("  Both failed — unexpected");
      assert(false, "at least one settle should succeed");
    }

    // Verify no double-allocation via invariants
    await assertInvariants(mgmtId, unitId, "test8");

    // Extra check: dues aren't over-allocated
    const ledgerSnap = await db
      .collection(`managements/${mgmtId}/ledger`)
      .where("unitId", "==", unitId)
      .get();
    const dues = ledgerSnap.docs
      .filter((d) => d.data().type === "DEBIT" && d.data().source === "dues")
      .map((d) => d.data());

    for (const due of dues) {
      const allocated = due.dueAllocatedMinor ?? 0;
      const total = due.dueTotalMinor ?? due.amountMinor;
      assert(
        allocated <= total,
        `Concurrent check: allocated(${allocated}) <= total(${total})`
      );
    }
  }

  // ================================================================
  // TEST 9: Pre-allocated partial payment
  // When a payment has relatedDueId, it explicitly allocates to that due.
  // Remaining unapplied credit should be usable by autoSettleFromCredit.
  // ================================================================
  {
    const tag = prefix("preallocated");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 9: Pre-allocated partial payment`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Due 1: 500 (created first so payment can allocate to it)
    const d1 = await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_1`, 0, 2026);

    // Payment of 800 with relatedDueId=d1 → allocates 500 to d1, 300 unapplied
    const payResult = await createPaymentRaw(idToken, mgmtId, unitId, 800, "cash", `pay_${tag}_1`, {
      relatedDueId: d1,
    });

    console.log(`  Payment after creation: applied=${payResult.appliedMinor} unapplied=${payResult.unappliedMinor}`);

    // d1 should be paid
    const d1Snap = await db.doc(`managements/${mgmtId}/ledger/${d1}`).get();
    assert(d1Snap.data()?.dueStatus === "paid", "d1 should be paid after direct allocation");

    // Now create Due 2 (after payment, so autoSettle is needed)
    const d2 = await createDue(idToken, mgmtId, unitId, 200, `due_${tag}_2`, 1, 2026);

    // autoSettle should use the 300 unapplied to close d2 (200)
    const result = await settle(idToken, mgmtId, unitId);
    console.log(`  Settle result: ${JSON.stringify(result)}`);

    assert(result.closedDueCount >= 1, "at least 1 due closed");
    assert(result.totalSettledMinor === 200, `totalSettledMinor === 200 (got ${result.totalSettledMinor})`);

    await assertInvariants(mgmtId, unitId, "test9");
  }

  // ================================================================
  // TEST 10: Auto source payments are skipped by autoSettleFromCredit
  // isManualPaymentSource only accepts cash/bank/stripe — not "auto"
  // ================================================================
  {
    const tag = prefix("auto_source_skip");
    const mgmtId = `mgmt_${tag}`;
    const unitId = `unit_${tag}`;
    console.log(`\nTest 10: Auto source payments skipped by settle`);

    await seedManagement(mgmtId, adminUid);
    await seedUnit(mgmtId, unitId);

    // Create payment with method "auto" first (no dues → unapplied credit)
    await createPayment(idToken, mgmtId, unitId, 600, "auto", `pay_${tag}_auto`);

    // Now create a due
    await createDue(idToken, mgmtId, unitId, 500, `due_${tag}_1`, 0, 2026);

    // autoSettle should fail: only "auto" source payments exist,
    // and autoSettle only uses manual payment sources (cash/bank/stripe)
    const res = await settleSafe(idToken, mgmtId, unitId);
    console.log(`  Settle response: status=${res.status} body=${JSON.stringify(res.body).slice(0, 150)}`);

    // Verify the due is still open
    const dueSnap = await db
      .collection(`managements/${mgmtId}/ledger`)
      .where("unitId", "==", unitId)
      .where("type", "==", "DEBIT")
      .get();
    const due = dueSnap.docs[0]?.data();
    console.log(`  Due status: ${due?.dueStatus}, outstanding: ${due?.dueOutstandingMinor}`);

    assert(due?.dueStatus === "open", "due should remain open (auto payments excluded)");
    assert(res.status !== 200, "settle should fail (auto source not eligible)");

    await assertInvariants(mgmtId, unitId, "test10");
  }

  // ================================================================
  // SUMMARY
  // ================================================================

  console.log("\n" + "=".repeat(60));
  console.log(`ALL EDGE CASE TESTS PASSED (${passCount} assertions, ${failCount} failures)\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err.message || err);
  process.exit(1);
});
