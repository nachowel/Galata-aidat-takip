import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import fs from "node:fs";

function parseArgs(argv) {
  let projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null;
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--projectId=")) {
      projectId = arg.split("=")[1] || projectId;
    }
  }
  return { projectId };
}

function resolveServiceAccount(projectId) {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Point it to a service account JSON file.");
    process.exit(1);
  }
  if (!fs.existsSync(credPath)) {
    console.error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${credPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(credPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    console.error("Invalid service account JSON. Missing client_email/private_key.");
    process.exit(1);
  }
  if (parsed.project_id && parsed.project_id !== projectId) {
    console.error(
      `Service account project_id (${parsed.project_id}) does not match --projectId (${projectId}).`
    );
    process.exit(1);
  }
  return parsed;
}

async function main() {
  const { projectId } = parseArgs(process.argv);
  if (!projectId) {
    console.error("Missing projectId. Pass --projectId=<firebase-project-id>.");
    process.exit(1);
  }
  if (!admin.apps.length) {
    const serviceAccount = resolveServiceAccount(projectId);
    admin.initializeApp({
      projectId,
      credential: admin.credential.cert(serviceAccount)
    });
  }
  const db = admin.firestore();

  const usersSnap = await db.collection("users").get();
  const mgmtSnap = await db.collection("managements").get();

  const ownerByMgmt = new Map();
  for (const mgmt of mgmtSnap.docs) {
    const ownerUid = mgmt.data().ownerUid;
    if (typeof ownerUid === "string" && ownerUid) {
      ownerByMgmt.set(mgmt.id, ownerUid);
    }
  }

  let created = 0;
  let updated = 0;
  const batch = db.batch();
  let ops = 0;

  async function flush() {
    if (ops === 0) return;
    await batch.commit();
    ops = 0;
  }

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const roleFromUser = data.role === "admin" ? "admin" : "viewer";
    const mgmtIds = new Set();
    if (typeof data.managementId === "string" && data.managementId) mgmtIds.add(data.managementId);
    if (Array.isArray(data.managementIds)) {
      for (const mgmtId of data.managementIds) {
        if (typeof mgmtId === "string" && mgmtId) mgmtIds.add(mgmtId);
      }
    }

    for (const mgmtId of mgmtIds) {
      const membershipRef = db.doc(`managementMemberships/${mgmtId}/users/${uid}`);
      const membershipSnap = await membershipRef.get();
      const role = ownerByMgmt.get(mgmtId) === uid ? "owner" : roleFromUser;
      if (membershipSnap.exists) {
        batch.set(membershipRef, {
          role,
          status: "active",
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        updated++;
      } else {
        batch.set(membershipRef, {
          role,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        created++;
      }
      ops++;
      if (ops >= 350) {
        await flush();
      }
    }
  }

  await flush();
  console.log(`Membership backfill complete. created=${created} updated=${updated}`);
}

main().catch((err) => {
  console.error("backfill-memberships failed:", err);
  process.exit(1);
});
