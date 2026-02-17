import * as admin from "firebase-admin";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const projectId = process.env.FIREBASE_PROJECT_ID || "demo-galata-aidat-takip";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || projectId;
process.env.FUNCTIONS_EMULATOR = "true";

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}
const db = admin.firestore();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasToken(err, token) {
  const msg = `${err?.code ?? ""} ${err?.message ?? ""}`;
  return msg.includes(token);
}

async function expectError(fn, token, label) {
  try {
    await fn();
    throw new Error(`${label}: expected error (${token}) but call succeeded`);
  } catch (err) {
    if (!hasToken(err, token)) {
      throw new Error(`${label}: expected token '${token}', got '${err?.code ?? ""} ${err?.message ?? ""}'`);
    }
  }
}

async function clearFirestoreEmulator() {
  const res = await fetch(
    `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator (${res.status})`);
  }
}

async function main() {
  await clearFirestoreEmulator();

  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId
  }, "due-allocation-test");

  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const createExpense = httpsCallable(functions, "createExpense");
  const createPayment = httpsCallable(functions, "createPayment");
  const allocatePaymentToDue = httpsCallable(functions, "allocatePaymentToDue");
  const reversePayment = httpsCallable(functions, "reversePayment");

  const mgmtId = "mgmt_due_alloc";
  const unitId = "unit_due_alloc";
  const suffix = Date.now();
  const email = `admin-due-${suffix}@example.com`;
  const password = "Passw0rd!";

  await db.doc(`managements/${mgmtId}`).set({ name: "Due Alloc Mgmt", ownerUid: "owner_due", createdAt: Date.now() });
  await db.doc(`managements/${mgmtId}/units/${unitId}`).set({ no: "1", status: "active" });

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  await signOut(auth);

  await db.doc(`users/${uid}`).set({
    email,
    role: "admin",
    managementId: mgmtId,
    managementIds: [mgmtId],
    unitId: null,
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtId}/users/${uid}`).set({
    role: "admin",
    status: "active",
    createdAt: Date.now()
  });

  await signInWithEmailAndPassword(auth, email, password);

  const due1 = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 10000,
    source: "dues",
    reference: "2026-01 Aidat",
    idempotencyKey: `due1_${suffix}`
  });
  const due1Id = due1.data?.entryId;
  assert(typeof due1Id === "string", "due1 should be created");

  const payment1 = await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 6000,
    method: "cash",
    reference: "payment 1",
    idempotencyKey: `pay1_${suffix}`
  });
  const payment1Id = payment1.data?.entryId;
  assert(typeof payment1Id === "string", "payment1 should be created");
  assert(payment1.data?.appliedMinor === 6000, "payment1 appliedMinor should be 6000");
  assert(payment1.data?.unappliedMinor === 0, "payment1 unappliedMinor should be 0");

  const due1SnapAfterP1 = await db.doc(`managements/${mgmtId}/ledger/${due1Id}`).get();
  const due1DataAfterP1 = due1SnapAfterP1.data();
  assert(due1DataAfterP1?.dueStatus === "open", "due1 should be open after partial payment");
  assert(due1DataAfterP1?.dueOutstandingMinor === 4000, "due1 outstanding should be 4000 after payment1");

  const payment2 = await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 5000,
    method: "bank",
    reference: "payment 2",
    idempotencyKey: `pay2_${suffix}`
  });
  const payment2Id = payment2.data?.entryId;
  assert(typeof payment2Id === "string", "payment2 should be created");
  assert(payment2.data?.appliedMinor === 4000, "payment2 should auto-apply remaining due1");
  assert(payment2.data?.unappliedMinor === 1000, "payment2 should keep 1000 unapplied");

  const due1SnapAfterP2 = await db.doc(`managements/${mgmtId}/ledger/${due1Id}`).get();
  const due1DataAfterP2 = due1SnapAfterP2.data();
  assert(due1DataAfterP2?.dueStatus === "paid", "due1 should be paid after payment2");
  assert(due1DataAfterP2?.dueOutstandingMinor === 0, "due1 outstanding should be 0");

  const due2 = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 3000,
    source: "dues",
    reference: "2026-02 Aidat",
    idempotencyKey: `due2_${suffix}`
  });
  const due2Id = due2.data?.entryId;
  assert(typeof due2Id === "string", "due2 should be created");

  const allocResult = await allocatePaymentToDue({
    managementId: mgmtId,
    paymentEntryId: payment2Id,
    dueId: due2Id,
    amountMinor: 1000
  });
  assert(allocResult.data?.appliedMinor === 1000, "manual allocation should apply 1000");
  assert(allocResult.data?.unappliedMinor === 0, "payment2 should be fully applied after manual allocation");

  const reverseResult = await reversePayment({
    managementId: mgmtId,
    paymentEntryId: payment2Id,
    reason: "allocation rollback test"
  });
  const reversalEntryId = reverseResult.data?.reversalEntryId;
  assert(typeof reversalEntryId === "string" && reversalEntryId.length > 0, "reversePayment should return reversalEntryId");
  assert(reverseResult.data?.reversedAllocationCount === 2, "reversePayment should reverse both allocations for payment2");
  assert(reverseResult.data?.reversedAllocationMinor === 5000, "reversePayment should reverse 5000 minor");

  const payment2Snap = await db.doc(`managements/${mgmtId}/ledger/${payment2Id}`).get();
  assert(payment2Snap.data()?.status === "reversed", "payment2 status should be reversed");
  assert(payment2Snap.data()?.reversalEntryId === reversalEntryId, "payment2 should reference reversal entry id");

  const reversalSnap = await db.doc(`managements/${mgmtId}/ledger/${reversalEntryId}`).get();
  assert(reversalSnap.exists, "reversal entry should exist");
  assert(reversalSnap.data()?.type === "DEBIT", "reversal entry type must be DEBIT");
  assert(reversalSnap.data()?.amountMinor === 5000, "reversal entry amount must match original payment");
  assert(reversalSnap.data()?.source === "reversal", "reversal entry source must be reversal");

  const due1AfterReverse = await db.doc(`managements/${mgmtId}/ledger/${due1Id}`).get();
  assert(due1AfterReverse.data()?.dueOutstandingMinor === 4000, "due1 outstanding should return to 4000");
  assert(due1AfterReverse.data()?.dueAllocatedMinor === 6000, "due1 allocated should return to 6000");
  assert(due1AfterReverse.data()?.dueStatus === "open", "due1 status should be open after reverse");

  const due2AfterReverse = await db.doc(`managements/${mgmtId}/ledger/${due2Id}`).get();
  assert(due2AfterReverse.data()?.dueOutstandingMinor === 3000, "due2 outstanding should return to 3000");
  assert(due2AfterReverse.data()?.dueAllocatedMinor === 0, "due2 allocated should return to 0");
  assert(due2AfterReverse.data()?.dueStatus === "open", "due2 status should be open after reverse");

  const payment3 = await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 4000,
    method: "cash",
    reference: "payment 3 partial allocation",
    idempotencyKey: `pay3_${suffix}`
  });
  const payment3Id = payment3.data?.entryId;
  assert(typeof payment3Id === "string", "payment3 should be created");
  assert(payment3.data?.appliedMinor === 3000, "payment3 should apply only remaining due2 amount");
  assert(payment3.data?.unappliedMinor === 1000, "payment3 should remain partially unapplied");

  const reversePayment3 = await reversePayment({
    managementId: mgmtId,
    paymentEntryId: payment3Id,
    reason: "partial allocation reverse test"
  });
  assert(reversePayment3.data?.reversedAllocationCount === 1, "payment3 reverse should rollback single allocation");
  assert(reversePayment3.data?.reversedAllocationMinor === 3000, "payment3 reverse should rollback allocated portion only");

  const due2AfterPayment3Reverse = await db.doc(`managements/${mgmtId}/ledger/${due2Id}`).get();
  assert(due2AfterPayment3Reverse.data()?.dueOutstandingMinor === 3000, "due2 outstanding should restore after payment3 reverse");
  assert(due2AfterPayment3Reverse.data()?.dueStatus === "open", "due2 status should restore to open");

  const reverseAgain = await reversePayment({
    managementId: mgmtId,
    paymentEntryId: payment2Id,
    reason: "idempotency retry"
  });
  assert(reverseAgain.data?.noop === true, "double reverse should be idempotent noop");
  assert(reverseAgain.data?.reversalEntryId === reversalEntryId, "double reverse should return same reversalEntryId");

  const allocationSnap = await db.collection(`managements/${mgmtId}/dueAllocations`).get();
  assert(allocationSnap.size >= 5, "expected original + reversal allocation docs");

  const managerCred = await createUserWithEmailAndPassword(auth, `manager-due-${suffix}@example.com`, password);
  const managerUid = managerCred.user.uid;
  await signOut(auth);
  await db.doc(`users/${managerUid}`).set({
    email: `manager-due-${suffix}@example.com`,
    role: "resident",
    managementId: mgmtId,
    managementIds: [mgmtId],
    unitId,
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtId}/users/${managerUid}`).set({
    role: "manager",
    status: "active",
    createdAt: Date.now()
  });
  await signInWithEmailAndPassword(auth, `manager-due-${suffix}@example.com`, password);
  await expectError(
    () => reversePayment({
      managementId: mgmtId,
      paymentEntryId: payment1Id,
      reason: "manager should fail"
    }),
    "permission-denied",
    "manager reversePayment"
  );

  console.log("OK: due allocation + reversePayment flow passed.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.message || err);
  process.exit(1);
});
