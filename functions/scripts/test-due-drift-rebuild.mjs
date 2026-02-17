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

  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId
    },
    "due-drift-rebuild-test"
  );

  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const createExpense = httpsCallable(functions, "createExpense");
  const createPayment = httpsCallable(functions, "createPayment");
  const checkDueDrift = httpsCallable(functions, "checkDueDrift");
  const rebuildDueAggregates = httpsCallable(functions, "rebuildDueAggregates");

  const mgmtId = "mgmt_due_drift";
  const unitId = "unit_due_drift";
  const suffix = Date.now();
  const adminEmail = `admin-drift-${suffix}@example.com`;
  const managerEmail = `manager-drift-${suffix}@example.com`;
  const password = "Passw0rd!";

  await db.doc(`managements/${mgmtId}`).set({ name: "Due Drift Mgmt", ownerUid: "owner_due_drift", createdAt: Date.now() });
  await db.doc(`managements/${mgmtId}/units/${unitId}`).set({ no: "1", status: "active" });

  const adminCred = await createUserWithEmailAndPassword(auth, adminEmail, password);
  const adminUid = adminCred.user.uid;
  await signOut(auth);

  await db.doc(`users/${adminUid}`).set({
    email: adminEmail,
    role: "admin",
    managementId: mgmtId,
    managementIds: [mgmtId],
    unitId: null,
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtId}/users/${adminUid}`).set({
    role: "admin",
    status: "active",
    createdAt: Date.now()
  });

  await signInWithEmailAndPassword(auth, adminEmail, password);

  const due = await createExpense({
    managementId: mgmtId,
    unitId,
    amountMinor: 10000,
    source: "dues",
    reference: "2026-03 Aidat",
    idempotencyKey: `due_drift_${suffix}`
  });
  const dueId = due.data?.entryId;
  assert(typeof dueId === "string", "due should be created");

  await createPayment({
    managementId: mgmtId,
    unitId,
    amountMinor: 6000,
    method: "cash",
    reference: "drift payment",
    idempotencyKey: `pay_drift_${suffix}`
  });

  await db.doc(`managements/${mgmtId}/ledger/${dueId}`).update({
    dueAllocatedMinor: 1111,
    dueOutstandingMinor: 2222,
    dueStatus: "paid"
  });

  const driftResult = await checkDueDrift({ managementId: mgmtId, sampleLimit: 5 });
  assert((driftResult.data?.drifted ?? 0) >= 1, "drift checker should detect at least one due drift");
  assert(
    Array.isArray(driftResult.data?.dueIds) && driftResult.data?.dueIds.includes(dueId),
    "drift checker should include corrupted dueId"
  );

  const alertRef = db.doc(`managements/${mgmtId}/dueDriftAlerts/${dueId}`);
  const openAlertSnap = await alertRef.get();
  assert(openAlertSnap.exists, "due drift alert should be created");
  assert(openAlertSnap.data()?.status === "open", "due drift alert should be open");

  const rebuildResult = await rebuildDueAggregates({ managementId: mgmtId, dueId });
  assert(rebuildResult.data?.dueAllocatedMinor === 6000, "rebuild should restore dueAllocatedMinor");
  assert(rebuildResult.data?.dueOutstandingMinor === 4000, "rebuild should restore dueOutstandingMinor");
  assert(rebuildResult.data?.dueStatus === "open", "rebuild should restore dueStatus");
  assert(rebuildResult.data?.noop === false, "first rebuild should not be noop");

  const rebuildAgain = await rebuildDueAggregates({ managementId: mgmtId, dueId });
  assert(rebuildAgain.data?.noop === true, "second rebuild should be noop");

  const rebuiltDueSnap = await db.doc(`managements/${mgmtId}/ledger/${dueId}`).get();
  assert(rebuiltDueSnap.data()?.dueAllocatedMinor === 6000, "due doc should be fixed after rebuild");
  assert(rebuiltDueSnap.data()?.dueOutstandingMinor === 4000, "due outstanding should be fixed after rebuild");
  assert(rebuiltDueSnap.data()?.dueStatus === "open", "due status should be fixed after rebuild");

  const resolvedAlertSnap = await alertRef.get();
  assert(resolvedAlertSnap.data()?.status === "resolved", "due drift alert should be resolved after rebuild");

  const managerCred = await createUserWithEmailAndPassword(auth, managerEmail, password);
  const managerUid = managerCred.user.uid;
  await signOut(auth);
  await db.doc(`users/${managerUid}`).set({
    email: managerEmail,
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

  await signInWithEmailAndPassword(auth, managerEmail, password);
  await expectError(
    () => rebuildDueAggregates({ managementId: mgmtId, dueId }),
    "permission-denied",
    "manager rebuildDueAggregates"
  );

  console.log("OK: due drift detection + rebuild flow passed.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.message || err);
  process.exit(1);
});
