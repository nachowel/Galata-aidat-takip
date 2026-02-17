/**
 * Balance Aggregation Emulator Test
 *
 * Senaryolar:
 *   1. DEBIT posted → unitBalances balanceMinor = -amount
 *   2. CREDIT posted → unitBalances balanceMinor = -debit + credit
 *   3. DEBIT voided → delta geri alınır
 *   4. CREDIT reversed → delta geri alınır + reversal entry uygulanır (net 0)
 *
 * Kullanım:
 *   1. Emulator'ü başlat: npm run serve (functions dizininden)
 *   2. Bu testi çalıştır: node scripts/test-balance-aggregation.mjs
 */

import { initializeApp } from "firebase/app";
import {
    getFirestore,
    connectFirestoreEmulator,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    serverTimestamp,
    deleteDoc,
} from "firebase/firestore";

// ─── Config ────────────────────────────────────────────────────────
const EMULATOR_HOST = "localhost";
const FIRESTORE_PORT = 8080;

const app = initializeApp({ projectId: "demo-test" });
const db = getFirestore(app);
connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_PORT);

const MGMT_ID = "testMgmt";
const UNIT_ID = "unit-101";

// ─── Helpers ───────────────────────────────────────────────────────

let entryCounter = 0;

function ledgerRef(entryId) {
    return doc(db, `managements/${MGMT_ID}/ledger/${entryId}`);
}

function unitBalanceRef() {
    return doc(db, `managements/${MGMT_ID}/unitBalances/${UNIT_ID}`);
}

async function createLedgerEntry(overrides = {}) {
    entryCounter++;
    const entryId = `entry-${entryCounter}-${Date.now()}`;
    const entry = {
        managementId: MGMT_ID,
        unitId: UNIT_ID,
        type: "DEBIT",
        amountMinor: 10000, // 100.00 TRY
        currency: "TRY",
        source: "manual",
        description: `Test entry ${entryCounter}`,
        status: "posted",
        createdAt: Date.now(),
        createdBy: "test-user",
        ...overrides,
    };
    await setDoc(ledgerRef(entryId), entry);
    return entryId;
}

async function waitForBalance(expectedFields, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const snap = await getDoc(unitBalanceRef());
        if (snap.exists()) {
            const data = snap.data();
            let allMatch = true;
            for (const [key, expected] of Object.entries(expectedFields)) {
                if (data[key] !== expected) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) return data;
        }
        // Poll every 500ms
        await new Promise((r) => setTimeout(r, 500));
    }
    // Final read for error reporting
    const finalSnap = await getDoc(unitBalanceRef());
    const finalData = finalSnap.exists() ? finalSnap.data() : null;
    throw new Error(
        `Timeout waiting for balance. Expected: ${JSON.stringify(expectedFields)}, Got: ${JSON.stringify(finalData)}`
    );
}

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`✅ ${message}`);
}

// ─── Cleanup ───────────────────────────────────────────────────────

async function cleanup() {
    // Delete unitBalance doc if exists
    try {
        await deleteDoc(unitBalanceRef());
    } catch {
        // ignore
    }
}

// ─── Tests ─────────────────────────────────────────────────────────

async function main() {
    console.log("\n🧪 Balance Aggregation Emulator Test\n");
    console.log("─".repeat(50));

    await cleanup();

    // ── Step 1: DEBIT posted ─────────────────────────────────────────
    console.log("\n📌 Step 1: Create DEBIT posted entry (10000 kuruş)");
    const debitEntryId = await createLedgerEntry({
        type: "DEBIT",
        amountMinor: 10000,
        description: "Ocak aidatı borçlandırma",
    });

    let bal = await waitForBalance({ balanceMinor: -10000 });
    assert(bal.balanceMinor === -10000, "balanceMinor === -10000 (borç)");
    assert(bal.postedDebitMinor === 10000, "postedDebitMinor === 10000");
    assert(bal.postedCreditMinor === 0, "postedCreditMinor === 0");
    assert(bal.version === 1, "version === 1");
    console.log("   ✅ Step 1 passed\n");

    // ── Step 2: CREDIT posted ────────────────────────────────────────
    console.log("📌 Step 2: Create CREDIT posted entry (7500 kuruş)");
    const creditEntryId = await createLedgerEntry({
        type: "CREDIT",
        amountMinor: 7500,
        description: "Ocak aidatı ödeme",
    });

    bal = await waitForBalance({ balanceMinor: -2500 });
    assert(bal.balanceMinor === -2500, "balanceMinor === -2500 (-10000 + 7500)");
    assert(bal.postedDebitMinor === 10000, "postedDebitMinor === 10000");
    assert(bal.postedCreditMinor === 7500, "postedCreditMinor === 7500");
    console.log("   ✅ Step 2 passed\n");

    // ── Step 3: VOID the DEBIT ──────────────────────────────────────
    console.log("📌 Step 3: Void the DEBIT entry (geri al)");
    await updateDoc(ledgerRef(debitEntryId), {
        status: "voided",
        voidReason: "Yanlış borçlandırma",
        voidedAt: Date.now(),
        voidedBy: "test-admin",
    });

    bal = await waitForBalance({ balanceMinor: 7500 });
    assert(bal.balanceMinor === 7500, "balanceMinor === 7500 (void sonrası: 0 debit + 7500 credit)");
    assert(bal.postedDebitMinor === 0, "postedDebitMinor === 0 (void geri aldı)");
    assert(bal.postedCreditMinor === 7500, "postedCreditMinor === 7500");
    console.log("   ✅ Step 3 passed\n");

    // ── Step 4: REVERSE the CREDIT ──────────────────────────────────
    console.log("📌 Step 4: Reverse the CREDIT entry");

    // 4a. Mark original CREDIT as reversed
    await updateDoc(ledgerRef(creditEntryId), {
        status: "reversed",
        reversedAt: Date.now(),
        reversedBy: "test-admin",
    });

    // Wait for the revert to happen
    bal = await waitForBalance({ balanceMinor: 0 });
    assert(bal.balanceMinor === 0, "balanceMinor === 0 (credit reversed)");
    assert(bal.postedDebitMinor === 0, "postedDebitMinor === 0");
    assert(bal.postedCreditMinor === 0, "postedCreditMinor === 0 (credit reversed)");

    // 4b. Create the reversal entry (DEBIT, same amount, source=reversal)
    console.log("   Creating reversal entry (DEBIT 7500, source=reversal)...");
    await createLedgerEntry({
        type: "DEBIT",
        amountMinor: 7500,
        source: "reversal",
        description: "Reversal of credit ödeme",
        reversalOf: creditEntryId,
    });

    bal = await waitForBalance({ balanceMinor: -7500 });
    assert(bal.balanceMinor === -7500, "balanceMinor === -7500 (reversed + reversal entry)");
    assert(bal.postedDebitMinor === 7500, "postedDebitMinor === 7500 (reversal debit)");
    assert(bal.postedCreditMinor === 0, "postedCreditMinor === 0");
    console.log("   ✅ Step 4 passed\n");

    // ── Step 5: New fresh CREDIT to bring to positive ───────────────
    console.log("📌 Step 5: Final CREDIT entry (20000 kuruş)");
    await createLedgerEntry({
        type: "CREDIT",
        amountMinor: 20000,
        description: "Büyük ödeme",
    });

    bal = await waitForBalance({ balanceMinor: 12500 });
    assert(bal.balanceMinor === 12500, "balanceMinor === 12500 (-7500 + 20000)");
    assert(bal.postedDebitMinor === 7500, "postedDebitMinor === 7500");
    assert(bal.postedCreditMinor === 20000, "postedCreditMinor === 20000");
    console.log("   ✅ Step 5 passed\n");

    // ── Done ─────────────────────────────────────────────────────────
    console.log("─".repeat(50));
    console.log("🎉 All balance aggregation tests passed!\n");
    process.exit(0);
}

main().catch((err) => {
    console.error("\n💥 Test failed:", err.message);
    process.exit(1);
});
