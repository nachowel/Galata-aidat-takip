import admin from "firebase-admin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import fs from "node:fs";

function parseArgs(argv) {
  const out = {
    all: false,
    mgmtId: null,
    execute: false,
    mode: "migrate_and_delete",
    batchSize: 300,
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--all") out.all = true;
    else if (arg === "--execute") out.execute = true;
    else if (arg.startsWith("--mgmtId=")) out.mgmtId = arg.split("=")[1] || null;
    else if (arg.startsWith("--mode=")) out.mode = arg.split("=")[1] || out.mode;
    else if (arg.startsWith("--batchSize=")) out.batchSize = Number(arg.split("=")[1]) || out.batchSize;
    else if (arg.startsWith("--projectId=")) out.projectId = arg.split("=")[1] || out.projectId;
  }

  out.batchSize = Math.max(1, Math.min(400, out.batchSize));
  return out;
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

function printUsageAndExit() {
  console.error(
    "Usage: node scripts/cleanup-transactions.mjs (--all | --mgmtId=<id>) " +
    "[--mode=migrate_and_delete|archive_and_delete|delete_only] [--batchSize=300] [--projectId=<id>] [--execute]"
  );
  process.exit(1);
}

function mapDirection(txData) {
  return txData.direction === "CREDIT" || txData.type === "GELİR" ? "CREDIT" : "DEBIT";
}

function mapAmountMinor(txData) {
  if (typeof txData.amountMinor === "number" && Number.isInteger(txData.amountMinor) && txData.amountMinor > 0) {
    return txData.amountMinor;
  }
  const amount = Number(txData.amount ?? 0);
  const minor = Math.round(amount * 100);
  return Number.isInteger(minor) && minor > 0 ? minor : 0;
}

async function getManagementIds({ all, mgmtId }, db) {
  if (all) {
    const snap = await db.collection("managements").select().get();
    return snap.docs.map((d) => d.id);
  }
  if (!mgmtId) printUsageAndExit();
  return [mgmtId];
}

async function cleanupManagement(db, mgmtId, { mode, batchSize, execute }) {
  let migrated = 0;
  let archived = 0;
  let deleted = 0;
  let scanned = 0;
  let lastDoc = null;

  while (true) {
    let q = db
      .collection(`managements/${mgmtId}/transactions`)
      .orderBy(FieldPath.documentId())
      .limit(batchSize);

    if (lastDoc) {
      q = q.startAfter(lastDoc.id);
    }

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();

    for (const txDoc of snap.docs) {
      scanned++;
      const txData = txDoc.data();

      if (mode === "migrate_and_delete") {
        const amountMinor = mapAmountMinor(txData);
        if (amountMinor > 0) {
          const ledgerRef = db.doc(`managements/${mgmtId}/ledger/legacytx_${txDoc.id}`);
          const auditRef = db.doc(`managements/${mgmtId}/auditLogs/legacy_cleanup_${txDoc.id}`);
          if (execute) {
            batch.set(ledgerRef, {
              managementId: mgmtId,
              unitId: typeof txData.unitId === "string" ? txData.unitId : null,
              type: mapDirection(txData),
              amountMinor,
              currency: "TRY",
              source: "legacy_migration",
              description: typeof txData.description === "string" ? txData.description : "Legacy migration",
              status: "posted",
              idempotencyKey: `legacytx_${txDoc.id}`,
              legacyDate: typeof txData.date === "string" ? txData.date : null,
              legacyCategoryType: typeof txData.type === "string" ? txData.type : null,
              periodMonth: typeof txData.periodMonth === "number" ? txData.periodMonth : null,
              periodYear: typeof txData.periodYear === "number" ? txData.periodYear : null,
              createdAt: FieldValue.serverTimestamp(),
              createdBy: "migration_script"
            }, { merge: true });
            batch.set(auditRef, {
              action: "LEGACY_TX_MIGRATED",
              actorUid: "migration_script",
              targetId: `legacytx_${txDoc.id}`,
              targetType: "ledgerEntry",
              managementId: mgmtId,
              at: FieldValue.serverTimestamp(),
              metadata: { legacyTransactionId: txDoc.id }
            }, { merge: true });
          }
          migrated++;
        }
      } else if (mode === "archive_and_delete") {
        const archiveRef = db.doc(`managements/${mgmtId}/legacyTransactionsArchive/${txDoc.id}`);
        if (execute) {
          batch.set(archiveRef, {
            ...txData,
            legacyTransactionId: txDoc.id,
            archivedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
        archived++;
      }

      if (execute) {
        batch.delete(txDoc.ref);
      }
      deleted++;
    }

    if (execute) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return { mgmtId, scanned, migrated, archived, deleted, execute, mode };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.all && !args.mgmtId) printUsageAndExit();
  if (!["migrate_and_delete", "archive_and_delete", "delete_only"].includes(args.mode)) {
    printUsageAndExit();
  }
  if (!args.projectId) {
    console.error("Missing projectId. Pass --projectId=<firebase-project-id>.");
    process.exit(1);
  }

  if (!admin.apps.length) {
    const serviceAccount = resolveServiceAccount(args.projectId);
    admin.initializeApp({
      projectId: args.projectId,
      credential: admin.credential.cert(serviceAccount)
    });
  }
  const db = admin.firestore();

  const managementIds = await getManagementIds(args, db);
  console.log(`Starting cleanup for ${managementIds.length} management(s). execute=${args.execute} mode=${args.mode}`);

  let totalScanned = 0;
  let totalMigrated = 0;
  let totalArchived = 0;
  let totalDeleted = 0;

  for (const mgmtId of managementIds) {
    const r = await cleanupManagement(db, mgmtId, args);
    totalScanned += r.scanned;
    totalMigrated += r.migrated;
    totalArchived += r.archived;
    totalDeleted += r.deleted;
    console.log(
      `[${mgmtId}] scanned=${r.scanned} migrated=${r.migrated} archived=${r.archived} deleted=${r.deleted}`
    );
  }

  console.log(
    `Done. scanned=${totalScanned} migrated=${totalMigrated} archived=${totalArchived} deleted=${totalDeleted} execute=${args.execute}`
  );
}

main().catch((err) => {
  console.error("cleanup-transactions failed:", err);
  process.exit(1);
});
