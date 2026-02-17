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

  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId
    },
    "auto-settle-credit-test"
  );

  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const createPayment = httpsCallable(functions, "createPayment");
  const createExpense = httpsCallable(functions, "createExpense");
  const autoSettleFromCredit = httpsCallable(functions, "autoSettleFromCredit");

  const mgmtId = "mgmt_auto_settle";
  const unitId = "unit_auto_settle";
  const suffix = Date.now();
  const email = `manager-auto-settle-${suffix}@example.com`;
  const password = "Passw0rd!";

  await db.doc(`managements/${mgmtId}`).set({ name: "Auto Settle Mgmt", ownerUid: "owner_auto", createdAt: Date.now() });
  await db.doc(`managements/${mgmtId}/units/${unitId}`).set({ no: "1", status: "active" });

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  await signOut(auth);
  await db.doc(`users/${uid}`).set({
    email,
    role: "resident",
    managementId: mgmtId,
    managementIds: [mgmtId],
    unitId,
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtId}/users/${uid}`).set({
    role: "manager",
    status: "active",
    createdAt: Date.now()
  });
  await signInWithEmailAndPassword(auth, email, password);

  await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 1000,
    method: "cash",
    reference: "credit seed 1",
    idempotencyKey: `credit_seed_1_${suffix}`
  });
  await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 600,
    method: "bank",
    reference: "credit seed 2",
    idempotencyKey: `credit_seed_2_${suffix}`
  });

  const due1 = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 700,
    source: "dues",
    reference: "2026-01 Aidat",
    idempotencyKey: `due_auto_1_${suffix}`,
    periodMonth: 0,
    periodYear: 2026
  });
  const due2 = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 900,
    source: "dues",
    reference: "2026-02 Aidat",
    idempotencyKey: `due_auto_2_${suffix}`,
    periodMonth: 1,
    periodYear: 2026
  });
  const due3 = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 800,
    source: "dues",
    reference: "2026-03 Aidat",
    idempotencyKey: `due_auto_3_${suffix}`,
    periodMonth: 2,
    periodYear: 2026
  });

  const due1Id = due1.data?.entryId;
  const due2Id = due2.data?.entryId;
  const due3Id = due3.data?.entryId;
  assert(typeof due1Id === "string" && typeof due2Id === "string" && typeof due3Id === "string", "due entries must exist");

  const settleResult = await autoSettleFromCredit({
    managementId: mgmtId,
    unitId
  });

  assert(settleResult.data?.closedDueCount === 2, "exactly two dues must be closed");
  assert(settleResult.data?.totalSettledMinor === 1600, "settled total must be 1600");
  assert(settleResult.data?.remainingCreditMinor === 0, "remaining credit must be 0");

  const due1Snap = await db.doc(`managements/${mgmtId}/ledger/${due1Id}`).get();
  const due2Snap = await db.doc(`managements/${mgmtId}/ledger/${due2Id}`).get();
  const due3Snap = await db.doc(`managements/${mgmtId}/ledger/${due3Id}`).get();

  assert(due1Snap.data()?.dueStatus === "paid", "due1 should be paid");
  assert(due2Snap.data()?.dueStatus === "paid", "due2 should be paid");
  assert(due3Snap.data()?.dueStatus === "open", "due3 should remain open");
  assert(due3Snap.data()?.dueOutstandingMinor === 800, "due3 outstanding should remain 800");

  const sourcePaymentsSnap = await db
    .collection(`managements/${mgmtId}/ledger`)
    .where("unitId", "==", unitId)
    .where("type", "==", "CREDIT")
    .get();
  const sourcePayments = sourcePaymentsSnap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((d) => d.id.startsWith("payment_credit_seed_"));
  const totalUnappliedAfter = sourcePayments.reduce((sum, p) => sum + Number(p.data.unappliedMinor ?? 0), 0);
  assert(totalUnappliedAfter === 0, "source payment unappliedMinor should be fully consumed");

  console.log("OK: autoSettleFromCredit flow passed.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.message || err);
  process.exit(1);
});
