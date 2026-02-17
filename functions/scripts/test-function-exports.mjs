import path from "node:path";
import { pathToFileURL } from "node:url";

const requiredExports = [
  "validateInvite",
  "consumeInvite",
  "createPayment",
  "autoSettleFromCredit",
  "allocatePaymentToDue",
  "reversePayment",
  "checkDueDrift",
  "rebuildDueAggregates",
  "createExpense",
  "createAdjustment",
  "voidLedgerEntry",
  "reverseLedgerEntry",
  "runMonthlyDues"
];

async function main() {
  const modulePath = path.resolve(process.cwd(), "lib/index.js");
  const mod = await import(pathToFileURL(modulePath).href);

  const missing = requiredExports.filter((name) => !(name in mod));
  if (missing.length > 0) {
    throw new Error(`Missing function export(s): ${missing.join(", ")}`);
  }

  console.log(`OK: required exports present (${requiredExports.length}).`);
}

main().catch((err) => {
  console.error("Function exports smoke test failed:", err?.message || err);
  process.exit(1);
});
