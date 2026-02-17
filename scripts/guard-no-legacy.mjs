import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIRS = ["components", "services", "functions", ".github"];
const TOP_FILES = ["App.tsx", "databaseService.ts", "firestore.rules", "package.json"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "lib", "android", ".claude"]);
const ALLOW_CREATE_LEGACY_DEF = path.normalize("functions/src/index.ts");
const ALLOW_TRANSACTIONS_PATH = new Set([
  path.normalize("functions/src/index.ts"),
  path.normalize("functions/scripts/cleanup-transactions.mjs"),
  path.normalize("scripts/guard-no-legacy.mjs"),
  path.normalize("firestore.rules")
]);

/** @param {string} relPath */
function shouldScan(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return [".ts", ".tsx", ".js", ".mjs", ".json", ".yml", ".yaml", ".rules"].includes(ext);
}

/** @param {string} startRel */
function walk(startRel) {
  const abs = path.join(ROOT, startRel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const rel = path.relative(ROOT, current);
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const name = path.basename(current);
      if (SKIP_DIRS.has(name)) continue;
      const entries = fs.readdirSync(current).map((entry) => path.join(current, entry));
      stack.push(...entries);
      continue;
    }
    if (!shouldScan(rel)) continue;
    out.push(path.normalize(rel));
  }
  return out;
}

const files = [
  ...SRC_DIRS.flatMap(walk),
  ...TOP_FILES.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => path.normalize(f))
];

const failures = [];

for (const relPath of files) {
  const absPath = path.join(ROOT, relPath);
  const content = fs.readFileSync(absPath, "utf8");

  if (/\bcreateTransactionFromLegacy\b/.test(content)) {
    failures.push(`${relPath}: createTransactionFromLegacy is forbidden.`);
  }

  if (/httpsCallable\([^)]*['"]createLegacyLedgerEntry['"]\)/.test(content)) {
    failures.push(`${relPath}: createLegacyLedgerEntry callable usage is forbidden.`);
  }

  if (/\bdb\.createLegacyLedgerEntry\b/.test(content)) {
    failures.push(`${relPath}: db.createLegacyLedgerEntry usage is forbidden.`);
  }

  if (/\bcreateLegacyLedgerEntry\s*\(/.test(content) && relPath !== ALLOW_CREATE_LEGACY_DEF) {
    failures.push(`${relPath}: createLegacyLedgerEntry call/definition is forbidden outside functions/src/index.ts.`);
  }

  const usesTransactionsCollection =
    /collection\([^)\n]*['"]transactions['"]/.test(content) ||
    /managements\/\$\{[^}]+\}\/transactions/.test(content) ||
    /['"]managements['"]\s*,\s*[^,\n]+,\s*['"]transactions['"]/.test(content);
  if (usesTransactionsCollection && !ALLOW_TRANSACTIONS_PATH.has(relPath)) {
    failures.push(`${relPath}: direct legacy transactions collection access is forbidden.`);
  }
}

if (failures.length > 0) {
  console.error("Legacy guard failed:");
  for (const fail of failures) console.error(`- ${fail}`);
  process.exit(1);
}

console.log("Legacy guard passed.");
