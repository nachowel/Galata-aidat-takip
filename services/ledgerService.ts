// ============================================================
// ledgerService.ts — Aidat Calculation Engine
// Pure functions (getDuesForPeriod, calculateUnitBalance,
// generateMonthlyDuesDryRun) + Firestore commit layer
// (generateMonthlyDuesAndCommit).
// ============================================================

import {
  type Firestore,
  collection,
  doc,
  getDocs,
  getDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig.ts';

// --------------- Type Definitions ---------------

export type AidatRate = {
  id: string;
  amount: number;
  startDate: Date;
};

export type LedgerUnit = {
  id: string;
  accountingStartDate: Date;
  isManagerExempt?: boolean;
};

export type LedgerTransaction = {
  id: string;
  type: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  unitId?: string;
  periodMonth?: number;
  periodYear?: number;
  createdAt?: Date;
};

// --------------- Helpers ---------------

/** Return a new Date set to the 1st of the given date's month, time zeroed. */
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Advance a month-start date by one month (handles year rollover). */
function nextMonth(d: Date): Date {
  const year = d.getFullYear();
  const month = d.getMonth();
  return month === 11
    ? new Date(year + 1, 0, 1)
    : new Date(year, month + 1, 1);
}

// --------------- 1. getDuesForPeriod ---------------

/**
 * Given a period date and a list of rates, return the applicable
 * aidat amount for that period.
 *
 * Rules:
 *  - rates must not be empty.
 *  - Filter rates whose startDate <= periodDate.
 *  - Pick the one with the largest startDate (most recent).
 *  - If no rate qualifies, throw.
 */
export function getDuesForPeriod(periodDate: Date, rates: AidatRate[]): number {
  if (rates.length === 0) {
    throw new Error('getDuesForPeriod: rates array is empty');
  }

  const period = startOfMonth(periodDate);

  // Normalize rate startDates to month-start for comparison.
  // A rate with startDate 15-Jul is effective from 01-Jul.
  const applicable = rates.filter(r => startOfMonth(r.startDate) <= period);

  if (applicable.length === 0) {
    throw new Error(
      `getDuesForPeriod: no rate found for period ${periodDate.toISOString()}`
    );
  }

  // Most-recent startDate wins
  applicable.sort((a, b) => startOfMonth(b.startDate).getTime() - startOfMonth(a.startDate).getTime());
  return applicable[0].amount;
}

// --------------- 2. calculateUnitBalance ---------------

/**
 * Net balance for a single unit.
 * balance = sum(DEBIT amounts) - sum(CREDIT amounts)
 *
 * Positive → unit owes money (debt).
 * Negative → unit has overpaid (credit).
 */
export function calculateUnitBalance(
  unitId: string,
  transactions: LedgerTransaction[]
): number {
  let balance = 0;
  for (const tx of transactions) {
    if (tx.unitId !== unitId) continue;
    if (tx.direction === 'DEBIT') balance += tx.amount;
    else if (tx.direction === 'CREDIT') balance -= tx.amount;
  }
  return balance;
}

// --------------- 3. generateMonthlyDuesDryRun ---------------

/**
 * Produce an array of new transactions (AIDAT_AUTO debits and
 * optional CREDIT_APPLY credits) for every unit × month that
 * has not yet been generated.
 *
 * Pure function — no Firestore writes, no mutations.
 * Deterministic IDs: `aidat_{unitId}_{year}_{month}`
 *                    `creditApply_{unitId}_{year}_{month}`
 */
export function generateMonthlyDuesDryRun(
  units: LedgerUnit[],
  transactions: LedgerTransaction[],
  rates: AidatRate[],
  today: Date
): LedgerTransaction[] {
  const newTransactions: LedgerTransaction[] = [];

  // Build sets of existing IDs for O(1) duplicate detection
  const existingAidatSet = new Set<string>(
    transactions.filter(tx => tx.type === 'AIDAT_AUTO').map(tx => tx.id)
  );
  const existingCreditApplySet = new Set<string>(
    transactions.filter(tx => tx.type === 'CREDIT_APPLY').map(tx => tx.id)
  );

  // Pre-compute per-unit balances
  const unitBalanceMap = new Map<string, number>();
  for (const unit of units) {
    unitBalanceMap.set(unit.id, calculateUnitBalance(unit.id, transactions));
  }

  const endMonth = startOfMonth(today);

  for (const unit of units) {
    if (unit.isManagerExempt) continue;

    let current = startOfMonth(unit.accountingStartDate);
    let balance = unitBalanceMap.get(unit.id) ?? 0;

    while (current <= endMonth) {
      const year = current.getFullYear();
      const month = current.getMonth();

      const aidatId = `aidat_${unit.id}_${year}_${month}`;

      if (existingAidatSet.has(aidatId)) {
        current = nextMonth(current);
        continue;
      }

      const amount = getDuesForPeriod(current, rates);
      const balanceBefore = balance;

      // AIDAT_AUTO — debit
      const aidatTx: LedgerTransaction = {
        id: aidatId,
        type: 'AIDAT_AUTO',
        direction: 'DEBIT',
        amount,
        unitId: unit.id,
        periodMonth: month,
        periodYear: year,
        createdAt: today
      };
      newTransactions.push(aidatTx);
      balance += amount;

      // CREDIT_APPLY — if unit had credit before this aidat
      if (balanceBefore < 0) {
        const creditApplyId = `creditApply_${unit.id}_${year}_${month}`;

        if (!existingCreditApplySet.has(creditApplyId)) {
          const creditAvailable = Math.abs(balanceBefore);
          const applyAmount = Math.min(creditAvailable, amount);

          if (applyAmount > 0) {
            const creditApplyTx: LedgerTransaction = {
              id: creditApplyId,
              type: 'CREDIT_APPLY',
              direction: 'CREDIT',
              amount: applyAmount,
              unitId: unit.id,
              periodMonth: month,
              periodYear: year,
              createdAt: today
            };
            newTransactions.push(creditApplyTx);
            balance -= applyAmount;
          }
        }
      }

      current = nextMonth(current);
    }
  }

  return newTransactions;
}

// ============================================================
// 4. generateMonthlyDuesAndCommit — Firestore Commit Layer
// ============================================================

const CHUNK_SIZE = 25;

/**
 * Read units + ledger + aidat rates from Firestore, run the
 * dry-run engine, then commit new entries through server-side
 * callable (client never writes ledger directly).
 *
 * Firestore paths:
 *   managements/{mgmtId}            → duesAmount, isManagerExempt, managerUnitId
 *   managements/{mgmtId}/units      → unit docs
 *   managements/{mgmtId}/ledger      → existing + new entries
 *   managements/{mgmtId}/aidatRates → rate history docs
 *
 * Returns { created: number } with the count of written transactions.
 */
export async function generateMonthlyDuesAndCommit(
  mgmtId: string,
  firestoreDb: Firestore
): Promise<{ created: number }> {
  if (!mgmtId) throw new Error('generateMonthlyDuesAndCommit: mgmtId is required');

  // ---- 1. Read management doc (for managerUnitId, isManagerExempt) ----
  const mgmtSnap = await getDoc(doc(firestoreDb, 'managements', mgmtId));
  if (!mgmtSnap.exists()) {
    throw new Error(`generateMonthlyDuesAndCommit: management ${mgmtId} not found`);
  }
  const mgmtData = mgmtSnap.data();
  const managerUnitId = mgmtData.managerUnitId ?? '';
  const isManagerExempt = Boolean(mgmtData.isManagerExempt);

  // ---- 2. Read units (skip those without accountingStartDate) ----
  const unitsSnap = await getDocs(collection(firestoreDb, 'managements', mgmtId, 'units'));
  const units: LedgerUnit[] = [];
  for (const d of unitsSnap.docs) {
    const data = d.data();
    const raw = data.accountingStartDate;
    if (!raw) {
      console.warn(`generateMonthlyDuesAndCommit: unit ${d.id} has no accountingStartDate — skipped`);
      continue;
    }
    units.push({
      id: d.id,
      accountingStartDate: raw.toDate?.() ?? new Date(raw),
      isManagerExempt: isManagerExempt && d.id === managerUnitId
    });
  }

  // ---- 3. Read existing ledger entries ----
  const txSnap = await getDocs(collection(firestoreDb, 'managements', mgmtId, 'ledger'));
  const transactions: LedgerTransaction[] = txSnap.docs.map(d => {
    const data = d.data();
    const direction: 'DEBIT' | 'CREDIT' = (data.type === 'CREDIT' || data.direction === 'CREDIT')
      ? 'CREDIT'
      : 'DEBIT';
    const amount = typeof data.amountMinor === 'number'
      ? Number(data.amountMinor) / 100
      : (Number(data.amount) || 0);
    const kind = data.metadata?.kind;
    const inferredType = d.id.startsWith('aidat_') || kind === 'DUES'
      ? 'AIDAT_AUTO'
      : (d.id.startsWith('creditApply_') || kind === 'CREDIT_APPLY'
        ? 'CREDIT_APPLY'
        : (data.legacyCategoryType ?? (direction === 'CREDIT' ? 'GELİR' : 'GİDER')));
    return {
      id: d.id,
      type: inferredType,
      direction,
      amount,
      unitId: data.unitId,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear,
      createdAt: data.createdAt?.toDate?.() ?? undefined
    };
  }).filter(tx => tx.type === 'AIDAT_AUTO' || tx.type === 'CREDIT_APPLY');

  // ---- 4. Read aidat rates ----
  const ratesSnap = await getDocs(collection(firestoreDb, 'managements', mgmtId, 'aidatRates'));
  let rates: AidatRate[];

  // Filter out archived rates
  const activeRateDocs = ratesSnap.docs.filter(d => !d.data().archived);

  if (activeRateDocs.length === 0) {
    // Fallback: use duesAmount from management doc as the sole rate
    const duesAmount = Number(mgmtData.duesAmount) || 0;
    if (duesAmount <= 0) {
      throw new Error('generateMonthlyDuesAndCommit: no aidat rates found and duesAmount is 0');
    }
    rates = [{
      id: 'default',
      amount: duesAmount,
      startDate: new Date(2000, 0, 1) // epoch-like start — covers all periods
    }];
  } else {
    rates = activeRateDocs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        amount: Number(data.amount) || 0,
        startDate: data.startDate?.toDate?.()
          ?? new Date(data.startDate ?? Date.now())
      };
    });
  }

  // ---- 5. Dry run ----
  const today = new Date();
  const newTxs = generateMonthlyDuesDryRun(units, transactions, rates, today);

  if (newTxs.length === 0) {
    return { created: 0 };
  }

  // ---- 6. Commit through callable (idempotent per tx.id) ----
  const createExpense = httpsCallable(functions, 'createExpense');
  const createPayment = httpsCallable(functions, 'createPayment');
  let created = 0;

  for (let i = 0; i < newTxs.length; i += CHUNK_SIZE) {
    const chunk = newTxs.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (tx) => {
        const amountMinor = Math.round(Number(tx.amount) * 100);
        if (!Number.isFinite(amountMinor) || amountMinor <= 0) return false;
        const reference = tx.type === 'AIDAT_AUTO'
          ? `${tx.periodYear}-${String((tx.periodMonth ?? 0) + 1).padStart(2, '0')} Aidat Tahakkuku`
          : `${tx.periodYear}-${String((tx.periodMonth ?? 0) + 1).padStart(2, '0')} Kredi Mahsubu`;
        if (tx.direction === 'CREDIT' && !tx.unitId) return false;
        const result = tx.direction === 'CREDIT'
          ? await createPayment({
            managementId: mgmtId,
            unitId: tx.unitId,
            amountMinor,
            method: 'auto',
            reference,
            idempotencyKey: tx.id,
            legacyDate: today.toLocaleDateString('tr-TR'),
            legacyCategoryType: 'GELİR',
            periodMonth: tx.periodMonth ?? null,
            periodYear: tx.periodYear ?? null
          })
          : await createExpense({
            managementId: mgmtId,
            unitId: tx.unitId ?? null,
            amountMinor,
            source: 'auto',
            reference,
            idempotencyKey: tx.id,
            legacyDate: today.toLocaleDateString('tr-TR'),
            legacyCategoryType: 'BORÇLANDIRMA',
            periodMonth: tx.periodMonth ?? null,
            periodYear: tx.periodYear ?? null
          });
        const data = result.data as { created?: boolean };
        return data?.created === true;
      })
    );
    created += chunkResults.filter(Boolean).length;
  }

  return { created };
}
