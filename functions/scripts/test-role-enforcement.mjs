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
  }, "role-enforcement-test");

  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const createPayment = httpsCallable(functions, "createPayment");
  const reverseLedgerEntry = httpsCallable(functions, "reverseLedgerEntry");
  const voidLedgerEntry = httpsCallable(functions, "voidLedgerEntry");

  const mgmtA = "mgmt_role_a";
  const mgmtB = "mgmt_role_b";
  const unitA = "unit_role_a";
  const unitB = "unit_role_b";

  await db.doc(`managements/${mgmtA}`).set({ name: "Role Mgmt A", ownerUid: "owner_a", createdAt: Date.now() });
  await db.doc(`managements/${mgmtB}`).set({ name: "Role Mgmt B", ownerUid: "owner_b", createdAt: Date.now() });
  await db.doc(`managements/${mgmtA}/units/${unitA}`).set({ no: "1", status: "active" });
  await db.doc(`managements/${mgmtB}/units/${unitB}`).set({ no: "2", status: "active" });

  const suffix = Date.now();
  const password = "Passw0rd!";

  const managerCred = await createUserWithEmailAndPassword(auth, `manager-${suffix}@example.com`, password);
  const managerUid = managerCred.user.uid;
  await signOut(auth);

  const viewerCred = await createUserWithEmailAndPassword(auth, `viewer-${suffix}@example.com`, password);
  const viewerUid = viewerCred.user.uid;
  await signOut(auth);

  const adminCred = await createUserWithEmailAndPassword(auth, `admin-${suffix}@example.com`, password);
  const adminUid = adminCred.user.uid;
  await signOut(auth);

  await db.doc(`users/${managerUid}`).set({
    email: `manager-${suffix}@example.com`,
    role: "resident",
    managementId: mgmtA,
    managementIds: [mgmtA],
    unitId: unitA,
    createdAt: Date.now()
  });
  await db.doc(`users/${viewerUid}`).set({
    email: `viewer-${suffix}@example.com`,
    role: "resident",
    managementId: mgmtA,
    managementIds: [mgmtA],
    unitId: unitA,
    createdAt: Date.now()
  });
  await db.doc(`users/${adminUid}`).set({
    email: `admin-${suffix}@example.com`,
    role: "admin",
    managementId: mgmtA,
    managementIds: [mgmtA],
    unitId: null,
    createdAt: Date.now()
  });

  await db.doc(`managementMemberships/${mgmtA}/users/${managerUid}`).set({
    role: "manager",
    status: "active",
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtA}/users/${viewerUid}`).set({
    role: "viewer",
    status: "active",
    createdAt: Date.now()
  });
  await db.doc(`managementMemberships/${mgmtA}/users/${adminUid}`).set({
    role: "admin",
    status: "active",
    createdAt: Date.now()
  });

  await signInWithEmailAndPassword(auth, `manager-${suffix}@example.com`, password);

  const managerPaymentResult = await createPayment({
    managementId: mgmtA,
    unitId: unitA,
    amountMinor: 50000,
    method: "cash",
    reference: "manager payment",
    idempotencyKey: `mgr_ok_${suffix}`
  });
  const managerEntryId = managerPaymentResult.data?.entryId;
  assert(typeof managerEntryId === "string" && managerEntryId.length > 0, "manager createPayment should succeed");

  await expectError(
    () => reverseLedgerEntry({ mgmtId: mgmtA, entryId: managerEntryId, reason: "manager should fail reverse" }),
    "permission-denied",
    "manager reverse"
  );
  await expectError(
    () => voidLedgerEntry({ mgmtId: mgmtA, entryId: managerEntryId, reason: "manager should fail void" }),
    "permission-denied",
    "manager void"
  );
  await expectError(
    () => createPayment({
      managementId: mgmtB,
      unitId: unitB,
      amountMinor: 1000,
      method: "cash",
      reference: "cross tenant manager",
      idempotencyKey: `mgr_cross_${suffix}`
    }),
    "permission-denied",
    "manager cross-tenant payment"
  );
  await expectError(
    () => createPayment({
      managementId: mgmtA,
      unitId: unitB,
      amountMinor: 1000,
      method: "cash",
      reference: "wrong unit boundary",
      idempotencyKey: `mgr_wrong_unit_${suffix}`
    }),
    "UNIT_NOT_FOUND",
    "manager wrong unit boundary"
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, `viewer-${suffix}@example.com`, password);
  await expectError(
    () => createPayment({
      managementId: mgmtA,
      unitId: unitA,
      amountMinor: 1000,
      method: "cash",
      reference: "viewer payment forbidden",
      idempotencyKey: `viewer_fail_${suffix}`
    }),
    "permission-denied",
    "viewer payment own tenant"
  );
  await expectError(
    () => createPayment({
      managementId: mgmtB,
      unitId: unitB,
      amountMinor: 1000,
      method: "cash",
      reference: "viewer cross tenant forbidden",
      idempotencyKey: `viewer_cross_${suffix}`
    }),
    "permission-denied",
    "viewer payment cross tenant"
  );
  await signOut(auth);

  await signInWithEmailAndPassword(auth, `admin-${suffix}@example.com`, password);
  const adminPayment = await createPayment({
    managementId: mgmtA,
    unitId: unitA,
    amountMinor: 75000,
    method: "bank",
    reference: "admin payment",
    idempotencyKey: `admin_ok_${suffix}`
  });
  const adminEntryId = adminPayment.data?.entryId;
  assert(typeof adminEntryId === "string" && adminEntryId.length > 0, "admin createPayment should succeed");
  await voidLedgerEntry({ mgmtId: mgmtA, entryId: adminEntryId, reason: "admin void should pass" });

  console.log("OK: role enforcement + tenant boundary callable tests passed.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.message || err);
  process.exit(1);
});
