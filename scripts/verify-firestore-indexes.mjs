import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const indexesPath = path.join(root, "firestore.indexes.json");

function stripLineComments(jsonc) {
  return jsonc
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function readIndexes() {
  if (!fs.existsSync(indexesPath)) {
    throw new Error(`firestore.indexes.json not found: ${indexesPath}`);
  }
  const raw = fs.readFileSync(indexesPath, "utf8");
  const parsed = JSON.parse(stripLineComments(raw));
  const indexes = Array.isArray(parsed.indexes) ? parsed.indexes : [];
  return indexes;
}

function isSameField(def, expected) {
  return def.fieldPath === expected.fieldPath && def.mode === expected.mode;
}

function hasIndex(indexes, required) {
  return indexes.some((idx) => {
    if (idx.collectionGroup !== required.collectionGroup) return false;
    if ((idx.queryScope || "COLLECTION") !== required.queryScope) return false;
    if (!Array.isArray(idx.fields) || idx.fields.length !== required.fields.length) return false;
    for (let i = 0; i < required.fields.length; i += 1) {
      if (!isSameField(idx.fields[i], required.fields[i])) return false;
    }
    return true;
  });
}

const requiredIndexes = [
  {
    name: "due-drift-source-updatedAt",
    collectionGroup: "ledger",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "source", mode: "ASCENDING" },
      { fieldPath: "dueAggregationUpdatedAt", mode: "DESCENDING" }
    ]
  },
  {
    name: "due-drift-source-createdAt",
    collectionGroup: "ledger",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "source", mode: "ASCENDING" },
      { fieldPath: "createdAt", mode: "DESCENDING" }
    ]
  }
];

try {
  const indexes = readIndexes();
  const missing = requiredIndexes.filter((idx) => !hasIndex(indexes, idx));
  if (missing.length > 0) {
    console.error("Missing required Firestore indexes:");
    for (const idx of missing) {
      console.error(`- ${idx.name}: ${idx.collectionGroup} ${idx.queryScope} ${JSON.stringify(idx.fields)}`);
    }
    process.exit(1);
  }
  console.log(`Firestore index guard passed (${requiredIndexes.length} required indexes found).`);
} catch (err) {
  console.error("Firestore index guard failed:", err?.message || err);
  process.exit(1);
}
