import * as admin from "firebase-admin";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const projectId = process.env.FIREBASE_PROJECT_ID || "demo-galata-aidat-takip";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || projectId;

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const mgmtId = "mgmt_test_001";
  const inviteId = "invite_test_001";
  const unitId = "unit_001";
  const reservationKey = "session_test_key_001";

  await db.doc(`managements/${mgmtId}`).set({
    name: "Test Management",
    ownerUid: "admin_test_uid",
    createdAt: Date.now()
  });
  await db.doc(`managements/${mgmtId}/invites/${inviteId}`).set({
    unitId,
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    usedByUid: null,
    reserved: false,
    reservedNonce: null,
    reservedUntil: null,
    reservedByKey: null
  });

  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId
  }, "invite-flow-test");

  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const email = `invite-flow-${Date.now()}@example.com`;
  const password = "Passw0rd!";
  await createUserWithEmailAndPassword(auth, email, password);

  const validateInvite = httpsCallable(functions, "validateInvite");
  const consumeInvite = httpsCallable(functions, "consumeInvite");

  const validateResult = await validateInvite({ mgmtId, inviteId, reservationKey });
  const validateData = validateResult.data;
  assert(validateData && validateData.reservedNonce, "validateInvite reservedNonce dönmedi");

  await consumeInvite({
    mgmtId,
    inviteId,
    reservedNonce: validateData.reservedNonce
  });

  // Idempotency: aynı kullanıcı tekrar consume çağırdığında success dönmeli.
  await consumeInvite({
    mgmtId,
    inviteId,
    reservedNonce: validateData.reservedNonce
  });

  const createdUser = auth.currentUser;
  assert(createdUser?.uid, "Auth user oluşturulamadı");
  const userSnap = await db.doc(`users/${createdUser.uid}`).get();
  assert(userSnap.exists, "users/{uid} yazılmadı");
  assert(userSnap.get("managementId") === mgmtId, "managementId beklenen değerde değil");
  assert(userSnap.get("unitId") === unitId, "unitId beklenen değerde değil");

  const inviteSnap = await db.doc(`managements/${mgmtId}/invites/${inviteId}`).get();
  assert(inviteSnap.get("status") === "used", "invite used olmadı");
  assert(inviteSnap.get("usedByUid") === createdUser.uid, "usedByUid beklenen uid değil");

  console.log("OK: validateInvite + consumeInvite + idempotency testi geçti.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err?.message || err);
  process.exit(1);
});
