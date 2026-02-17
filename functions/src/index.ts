import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10
});

const INVITE_RESERVE_MINUTES = 10;
const IS_FUNCTIONS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";
const CALLABLE_OPTIONS = { enforceAppCheck: !IS_FUNCTIONS_EMULATOR };
const LEGACY_BRIDGE_DISABLED = true;
const ENABLE_DESTRUCTIVE_CALLABLES = process.env.ENABLE_DESTRUCTIVE_CALLABLES === "true";

type InviteStatus = "active" | "used" | "revoked";
type MembershipRole = "owner" | "admin" | "manager" | "viewer";
type Permission = "payment" | "void" | "reverse" | "dues_run" | "expense" | "adjustment" | "admin_ops";

type InviteDoc = {
  unitId?: string;
  status?: InviteStatus;
  expiresAt?: Timestamp;
  reserved?: boolean;
  reservedNonce?: string | null;
  reservedUntil?: Timestamp | null;
  reservedByKey?: string | null;
  usedByUid?: string | null;
};

function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(value);
}

function isInviteExpired(expiresAt?: Timestamp): boolean {
  if (!expiresAt) return true;
  return expiresAt.toMillis() <= Date.now();
}

function inviteRef(mgmtId: string, inviteId: string) {
  return db.doc(`managements/${mgmtId}/invites/${inviteId}`);
}

function mapInviteStateToError(invite: InviteDoc): HttpsError {
  if (invite.status === "used") return new HttpsError("failed-precondition", "INVITE_ALREADY_USED");
  if (invite.status === "revoked") return new HttpsError("failed-precondition", "INVITE_REVOKED");
  if (isInviteExpired(invite.expiresAt)) return new HttpsError("failed-precondition", "INVITE_EXPIRED");
  return new HttpsError("failed-precondition", "INVITE_INVALID_STATE");
}

export const validateInvite = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const inviteId = request.data?.inviteId;
    const reservationKey = request.data?.reservationKey;

    if (!isValidId(mgmtId) || !isValidId(inviteId) || !isValidId(reservationKey)) {
      throw new HttpsError("invalid-argument", "INVALID_LINK");
    }

    const ref = inviteRef(mgmtId, inviteId);
    const nonce = db.collection("_").doc().id;
    const reservedUntil = Timestamp.fromMillis(Date.now() + INVITE_RESERVE_MINUTES * 60 * 1000);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "INVALID_LINK");

      const invite = snap.data() as InviteDoc;
      if (invite.status !== "active") throw mapInviteStateToError(invite);
      if (isInviteExpired(invite.expiresAt)) throw new HttpsError("failed-precondition", "INVITE_EXPIRED");
      if (!invite.unitId || typeof invite.unitId !== "string") throw new HttpsError("failed-precondition", "INVITE_INVALID_STATE");

      const currentlyReserved =
        invite.reserved === true &&
        invite.reservedUntil &&
        invite.reservedUntil.toMillis() > Date.now();

      if (currentlyReserved) {
        if (invite.reservedByKey === reservationKey && invite.reservedNonce && invite.reservedUntil) {
          return {
            mgmtId,
            unitId: invite.unitId,
            reservedNonce: invite.reservedNonce,
            reservedUntil: invite.reservedUntil.toMillis()
          };
        }
        throw new HttpsError("failed-precondition", "INVITE_RESERVED");
      }

      tx.update(ref, {
        reserved: true,
        reservedNonce: nonce,
        reservedUntil,
        reservedByKey: reservationKey
      });

      return {
        mgmtId,
        unitId: invite.unitId,
        reservedNonce: nonce,
        reservedUntil: reservedUntil.toMillis()
      };
    });

    return result;
  }
);

export const consumeInvite = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    const uid = request.auth.uid;

    const mgmtId = request.data?.mgmtId;
    const inviteId = request.data?.inviteId;
    const reservedNonce = request.data?.reservedNonce;

    if (!isValidId(mgmtId) || !isValidId(inviteId) || !isValidId(reservedNonce)) {
      throw new HttpsError("invalid-argument", "INVALID_LINK");
    }

    const ref = inviteRef(mgmtId, inviteId);
    const userRef = db.doc(`users/${uid}`);
    const membershipDocRef = membershipRef(mgmtId, uid);
    const now = Timestamp.now();

    await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(ref);
      if (!inviteSnap.exists) throw new HttpsError("not-found", "INVALID_LINK");

      const invite = inviteSnap.data() as InviteDoc;
      if (invite.status === "used" && invite.usedByUid === uid) {
        return;
      }
      if (invite.status !== "active") throw mapInviteStateToError(invite);
      if (isInviteExpired(invite.expiresAt)) throw new HttpsError("failed-precondition", "INVITE_EXPIRED");
      if (!invite.reserved || !invite.reservedUntil || invite.reservedUntil.toMillis() <= now.toMillis()) {
        throw new HttpsError("failed-precondition", "INVITE_RESERVATION_TIMEOUT");
      }
      if (!invite.reservedNonce || invite.reservedNonce !== reservedNonce) {
        throw new HttpsError("failed-precondition", "INVITE_NONCE_MISMATCH");
      }
      if (!invite.unitId || typeof invite.unitId !== "string") {
        throw new HttpsError("failed-precondition", "INVITE_INVALID_STATE");
      }

      const userSnap = await tx.get(userRef);
      const existingRole = userSnap.exists ? userSnap.get("role") : null;
      const role = existingRole === "admin" ? "admin" : "resident";

      tx.set(
        userRef,
        {
          email: request.auth?.token?.email ?? null,
          role,
          managementId: mgmtId,
          unitId: invite.unitId,
          managementIds: FieldValue.arrayUnion(mgmtId),
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: userSnap.exists ? userSnap.get("createdAt") ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      tx.set(
        membershipDocRef,
        {
          role: "viewer",
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          unitId: invite.unitId
        },
        { merge: true }
      );

      tx.update(ref, {
        status: "used",
        usedAt: FieldValue.serverTimestamp(),
        usedByUid: uid,
        reserved: false,
        reservedNonce: null,
        reservedUntil: null,
        reservedByKey: null
      });
    });

    return { ok: true };
  }
);

export const cleanupInvites = onSchedule("every day 03:00", async () => {
  const nowTs = Timestamp.now();

  while (true) {
    const expiredSnap = await db
      .collectionGroup("invites")
      .where("status", "==", "active")
      .where("expiresAt", "<", nowTs)
      .limit(300)
      .get();

    if (expiredSnap.empty) break;

    const batch = db.batch();
    expiredSnap.docs.forEach((d) => {
      batch.update(d.ref, {
        status: "revoked",
        reserved: false,
        reservedNonce: null,
        reservedUntil: null,
        reservedByKey: null
      });
    });
    await batch.commit();
  }

  while (true) {
    const staleSnap = await db
      .collectionGroup("invites")
      .where("reservedUntil", "<", nowTs)
      .limit(300)
      .get();

    if (staleSnap.empty) break;

    const batch = db.batch();
    staleSnap.docs.forEach((d) => {
      const data = d.data() as InviteDoc;
      if (data.status === "active" && data.reserved) {
        batch.update(d.ref, {
          reserved: false,
          reservedNonce: null,
          reservedUntil: null,
          reservedByKey: null
        });
      }
    });
    await batch.commit();
  }
});

// ─── Balance Aggregation ────────────────────────────────────────────

const LEDGER_DOCUMENT_PATH = "managements/{mgmtId}/ledger/{entryId}";

type LedgerType = "DEBIT" | "CREDIT";
type LedgerStatusValue = "posted" | "voided" | "reversed";
type PaymentMethod = "cash" | "bank" | "stripe" | "auto";

interface LedgerDoc {
  managementId?: string;
  unitId?: string | null;
  type: LedgerType;
  amountMinor: number;
  currency?: string;
  source?: string;
  description?: string;
  status: LedgerStatusValue;
  affectsBalance?: boolean; // Default true. False for internal settlements.
  createdAt?: Timestamp | number | null;
  createdBy?: string;
  reversalOf?: string | null;
  voidReason?: string | null;
  voidedAt?: Timestamp | null;
  voidedBy?: string | null;
  reversedAt?: Timestamp | null;
  reversedBy?: string | null;
  reversalEntryId?: string | null;
  reversesEntryId?: string | null;
  balanceAppliedAt?: Timestamp | null;
  balanceAppliedVersion?: number | null;
  balanceRevertedAt?: Timestamp | null;
  balanceRevertedVersion?: number | null;
  idempotencyKey?: string | null;
  reference?: string | null;
  relatedDueId?: string | null;
  legacyDate?: string;
  legacyCategoryType?: string;
  periodMonth?: number | null;
  periodYear?: number | null;
  // Due tracking fields (for DEBIT dues entries)
  dueTotalMinor?: number | null;
  dueAllocatedMinor?: number | null;
  dueOutstandingMinor?: number | null;
  dueStatus?: "open" | "paid" | null;
  // Payment allocation fields (for CREDIT payment entries)
  appliedMinor?: number | null;
  unappliedMinor?: number | null;
  allocationStatus?: "unapplied" | "partial" | "applied" | null;
  metadata?: Record<string, unknown>;
}

type DueStatus = "open" | "paid";
type AllocationStatus = "unapplied" | "partial" | "applied";

interface DueAllocationDoc {
  managementId: string;
  unitId: string;
  dueId: string;
  paymentId: string;
  paymentEntryId: string;
  amountMinor: number;
  status: "applied";
  createdAt: FirebaseFirestore.FieldValue;
  createdBy: string;
  idempotencyKey: string;
  originalAllocationId?: string;
}

const MAX_ALLOCATION_REVERSALS_PER_TX = 180;

interface PaymentAllocationSummary {
  allocatedMinor: number;
  unappliedMinor: number;
  allocationStatus: AllocationStatus;
  allocationCount: number;
  allocationDueIds: string[];
}

function isValidPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "cash" || value === "bank" || value === "stripe" || value === "auto";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "INVALID_STRING_FIELD");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new HttpsError("invalid-argument", "INVALID_STRING_FIELD");
  }
  return trimmed;
}

function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "IDEMPOTENCY_KEY_REQUIRED");
  }
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new HttpsError("invalid-argument", "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
}

function ensureOptionalDocId(value: unknown, fieldName: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${fieldName.toUpperCase()}_INVALID`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(trimmed)) {
    throw new HttpsError("invalid-argument", `${fieldName.toUpperCase()}_INVALID`);
  }
  return trimmed;
}

function safeMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return fallback;
}

function computeDueProgress(due: LedgerDoc): { total: number; allocated: number; outstanding: number; status: DueStatus } {
  const total = safeMinor(due.dueTotalMinor ?? due.amountMinor);
  const allocated = Math.min(safeMinor(due.dueAllocatedMinor), total);
  const outstanding = Math.max(total - allocated, 0);
  const status: DueStatus = outstanding > 0 ? "open" : "paid";
  return { total, allocated, outstanding, status };
}

function computePaymentProgress(payment: LedgerDoc): { total: number; applied: number; unapplied: number; status: AllocationStatus } {
  const total = safeMinor(payment.amountMinor);
  const applied = Math.min(safeMinor(payment.appliedMinor), total);
  const unapplied = Math.max(total - applied, 0);
  const status: AllocationStatus = unapplied === 0 ? "applied" : applied > 0 ? "partial" : "unapplied";
  return { total, applied, unapplied, status };
}

function dueAllocationRef(mgmtId: string, allocationId: string) {
  return db.doc(`managements/${mgmtId}/dueAllocations/${allocationId}`);
}

function canonicalDueSortKey(entry: LedgerDoc): string {
  const metadataYearMonth =
    entry.metadata && typeof entry.metadata.yearMonth === "string"
      ? entry.metadata.yearMonth
      : null;
  if (metadataYearMonth && /^\d{4}-\d{2}$/.test(metadataYearMonth)) {
    return metadataYearMonth;
  }
  if (Number.isInteger(entry.periodYear) && Number.isInteger(entry.periodMonth)) {
    return `${entry.periodYear}-${String((entry.periodMonth ?? 0) + 1).padStart(2, "0")}`;
  }
  const created = entry.createdAt;
  if (created && typeof (created as Timestamp).toMillis === "function") {
    const d = new Date((created as Timestamp).toMillis());
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof created === "number" && Number.isFinite(created)) {
    const d = new Date(created);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return "9999-12";
}

function dueFifoWeight(entry: LedgerDoc): number {
  if (Number.isInteger(entry.periodYear) && Number.isInteger(entry.periodMonth)) {
    return (entry.periodYear as number) * 100 + ((entry.periodMonth as number) + 1);
  }
  const metadataYearMonth =
    entry.metadata && typeof entry.metadata.yearMonth === "string"
      ? entry.metadata.yearMonth
      : null;
  if (metadataYearMonth && /^\d{4}-\d{2}$/.test(metadataYearMonth)) {
    const [y, m] = metadataYearMonth.split("-").map((v) => Number(v));
    if (Number.isInteger(y) && Number.isInteger(m)) return y * 100 + m;
  }
  return Number.MAX_SAFE_INTEGER;
}

function isDueLedgerEntry(entry: LedgerDoc, entryId?: string): boolean {
  if (entry.type !== "DEBIT") return false;
  if (entry.source === "dues") return true;
  if (entry.metadata && entry.metadata.kind === "DUES") return true;
  if (entryId && entryId.startsWith("aidat_")) return true;
  return false;
}

function isPaymentLedgerEntry(entry: LedgerDoc, entryId?: string): boolean {
  if (entry.type !== "CREDIT") return false;
  if (entryId && entryId.startsWith("payment_")) return true;
  return entry.source === "cash" || entry.source === "bank" || entry.source === "stripe" || entry.source === "auto";
}

function isManualPaymentSource(source: unknown): boolean {
  return source === "cash" || source === "bank" || source === "stripe";
}

type CanonicalDueAggregates = {
  dueRef: admin.firestore.DocumentReference;
  dueTotalMinor: number;
  allocatedMinor: number;
  outstandingMinor: number;
  status: DueStatus;
};

async function computeCanonicalDueAggregates(
  managementId: string,
  dueId: string,
  tx?: admin.firestore.Transaction
): Promise<CanonicalDueAggregates> {
  const dueRef = db.doc(`managements/${managementId}/ledger/${dueId}`);
  const dueSnap = tx ? await tx.get(dueRef) : await dueRef.get();
  if (!dueSnap.exists) {
    throw new HttpsError("not-found", "DUE_NOT_FOUND");
  }

  const due = dueSnap.data() as LedgerDoc;
  if (due.managementId && due.managementId !== managementId) {
    throw new HttpsError("permission-denied", "TENANT_BOUNDARY_VIOLATION");
  }
  if (!isDueLedgerEntry(due, dueId)) {
    throw new HttpsError("failed-precondition", "NOT_DUE_ENTRY");
  }

  const allocationsQuery = db
    .collection(`managements/${managementId}/dueAllocations`)
    .where("dueId", "==", dueId);
  const allocationsSnap = tx ? await tx.get(allocationsQuery) : await allocationsQuery.get();

  let allocatedMinor = 0;
  for (const allocationDoc of allocationsSnap.docs) {
    const allocation = allocationDoc.data() as DueAllocationDoc;
    allocatedMinor += toInt(allocation.amountMinor, 0);
  }

  const dueTotalMinor = safeMinor(due.dueTotalMinor ?? due.amountMinor);
  const outstandingMinor = dueTotalMinor - allocatedMinor;
  const status: DueStatus = outstandingMinor > 0 ? "open" : "paid";

  return {
    dueRef,
    dueTotalMinor,
    allocatedMinor,
    outstandingMinor,
    status
  };
}

/**
 * Write-only variant: uses pre-read snapshots to avoid reads after writes.
 * Used by createPayment which pre-reads all docs in Phase 1.
 */
function allocateAmountToDuePreRead(
  tx: admin.firestore.Transaction,
  params: {
    managementId: string;
    unitId: string;
    dueRef: admin.firestore.DocumentReference;
    dueId: string;
    dueData: LedgerDoc | null;
    allocationSnap: admin.firestore.DocumentSnapshot;
    paymentRef: admin.firestore.DocumentReference;
    paymentEntryId: string;
    paymentDoc: LedgerDoc;
    actorUid: string;
    amountToApplyMinor: number;
  }
): number {
  const { managementId, unitId, dueRef, dueId, dueData, allocationSnap, paymentRef, paymentEntryId, paymentDoc, actorUid, amountToApplyMinor } = params;
  if (amountToApplyMinor <= 0) return 0;

  if (!dueData) {
    throw new HttpsError("not-found", "DUE_NOT_FOUND");
  }
  const due = dueData;
  if (due.managementId !== managementId) {
    throw new HttpsError("permission-denied", "TENANT_BOUNDARY_VIOLATION");
  }
  if (due.status !== "posted") {
    throw new HttpsError("failed-precondition", "DUE_NOT_ALLOCATABLE");
  }
  if (!isDueLedgerEntry(due, dueId)) {
    throw new HttpsError("failed-precondition", "DUE_SOURCE_INVALID");
  }
  if (!due.unitId || due.unitId !== unitId) {
    throw new HttpsError("failed-precondition", "DUE_UNIT_MISMATCH");
  }

  const dueProgress = computeDueProgress(due);
  if (dueProgress.outstanding <= 0) return 0;

  const paymentProgress = computePaymentProgress(paymentDoc);
  if (paymentProgress.unapplied <= 0) return 0;

  const applyMinor = Math.min(amountToApplyMinor, paymentProgress.unapplied, dueProgress.outstanding);
  if (applyMinor <= 0) return 0;

  const allocationId = `alloc_${paymentEntryId}_${dueId}`;
  const allocationRef = dueAllocationRef(managementId, allocationId);
  if (allocationSnap.exists) {
    const existing = allocationSnap.data() as DueAllocationDoc;
    if (existing.amountMinor !== applyMinor || existing.dueId !== dueId || existing.paymentEntryId !== paymentEntryId) {
      throw new HttpsError("already-exists", "ALLOCATION_ID_CONFLICT");
    }
    return 0;
  }

  const nextDueAllocated = dueProgress.allocated + applyMinor;
  const nextDueOutstanding = Math.max(dueProgress.total - nextDueAllocated, 0);
  const nextDueStatus: DueStatus = nextDueOutstanding > 0 ? "open" : "paid";

  const nextPaymentApplied = paymentProgress.applied + applyMinor;
  const nextPaymentUnapplied = Math.max(paymentProgress.total - nextPaymentApplied, 0);
  const nextPaymentStatus: AllocationStatus =
    nextPaymentUnapplied === 0 ? "applied" : nextPaymentApplied > 0 ? "partial" : "unapplied";

  tx.set(allocationRef, {
    managementId,
    unitId,
    dueId,
    paymentId: paymentEntryId,
    paymentEntryId,
    amountMinor: applyMinor,
    status: "applied",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    idempotencyKey: allocationId
  } satisfies DueAllocationDoc);

  tx.update(dueRef, {
    dueTotalMinor: dueProgress.total,
    dueAllocatedMinor: nextDueAllocated,
    dueOutstandingMinor: nextDueOutstanding,
    dueStatus: nextDueStatus,
    dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
    dueAggregateVersion: FieldValue.increment(1)
  });

  tx.update(paymentRef, {
    relatedDueId: paymentDoc.relatedDueId ?? dueId,
    appliedMinor: nextPaymentApplied,
    unappliedMinor: nextPaymentUnapplied,
    allocationStatus: nextPaymentStatus
  });

  paymentDoc.appliedMinor = nextPaymentApplied;
  paymentDoc.unappliedMinor = nextPaymentUnapplied;
  paymentDoc.allocationStatus = nextPaymentStatus;
  paymentDoc.relatedDueId = paymentDoc.relatedDueId ?? dueId;

  return applyMinor;
}

async function allocateAmountToDue(
  tx: admin.firestore.Transaction,
  params: {
    managementId: string;
    unitId: string;
    dueRef: admin.firestore.DocumentReference;
    dueId: string;
    paymentRef: admin.firestore.DocumentReference;
    paymentEntryId: string;
    paymentDoc: LedgerDoc;
    actorUid: string;
    amountToApplyMinor: number;
  }
): Promise<number> {
  const { managementId, unitId, dueRef, dueId, paymentRef, paymentEntryId, paymentDoc, actorUid, amountToApplyMinor } = params;
  if (amountToApplyMinor <= 0) return 0;

  const dueSnap = await tx.get(dueRef);
  if (!dueSnap.exists) {
    throw new HttpsError("not-found", "DUE_NOT_FOUND");
  }
  const due = dueSnap.data() as LedgerDoc;
  if (due.managementId !== managementId) {
    throw new HttpsError("permission-denied", "TENANT_BOUNDARY_VIOLATION");
  }
  if (due.status !== "posted") {
    throw new HttpsError("failed-precondition", "DUE_NOT_ALLOCATABLE");
  }
  if (!isDueLedgerEntry(due, dueId)) {
    throw new HttpsError("failed-precondition", "DUE_SOURCE_INVALID");
  }
  if (!due.unitId || due.unitId !== unitId) {
    throw new HttpsError("failed-precondition", "DUE_UNIT_MISMATCH");
  }

  const dueProgress = computeDueProgress(due);
  if (dueProgress.outstanding <= 0) return 0;

  const paymentProgress = computePaymentProgress(paymentDoc);
  if (paymentProgress.unapplied <= 0) return 0;

  const applyMinor = Math.min(amountToApplyMinor, paymentProgress.unapplied, dueProgress.outstanding);
  if (applyMinor <= 0) return 0;

  const allocationId = `alloc_${paymentEntryId}_${dueId}`;
  const allocationRef = dueAllocationRef(managementId, allocationId);
  const allocationSnap = await tx.get(allocationRef);
  if (allocationSnap.exists) {
    const existing = allocationSnap.data() as DueAllocationDoc;
    if (existing.amountMinor !== applyMinor || existing.dueId !== dueId || existing.paymentEntryId !== paymentEntryId) {
      throw new HttpsError("already-exists", "ALLOCATION_ID_CONFLICT");
    }
    return 0;
  }

  const nextDueAllocated = dueProgress.allocated + applyMinor;
  const nextDueOutstanding = Math.max(dueProgress.total - nextDueAllocated, 0);
  const nextDueStatus: DueStatus = nextDueOutstanding > 0 ? "open" : "paid";

  const nextPaymentApplied = paymentProgress.applied + applyMinor;
  const nextPaymentUnapplied = Math.max(paymentProgress.total - nextPaymentApplied, 0);
  const nextPaymentStatus: AllocationStatus =
    nextPaymentUnapplied === 0 ? "applied" : nextPaymentApplied > 0 ? "partial" : "unapplied";

  tx.set(allocationRef, {
    managementId,
    unitId,
    dueId,
    paymentId: paymentEntryId,
    paymentEntryId,
    amountMinor: applyMinor,
    status: "applied",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    idempotencyKey: allocationId
  } satisfies DueAllocationDoc);

  tx.update(dueRef, {
    dueTotalMinor: dueProgress.total,
    dueAllocatedMinor: nextDueAllocated,
    dueOutstandingMinor: nextDueOutstanding,
    dueStatus: nextDueStatus,
    dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
    dueAggregateVersion: FieldValue.increment(1)
  });

  tx.update(paymentRef, {
    relatedDueId: paymentDoc.relatedDueId ?? dueId,
    appliedMinor: nextPaymentApplied,
    unappliedMinor: nextPaymentUnapplied,
    allocationStatus: nextPaymentStatus
  });

  paymentDoc.appliedMinor = nextPaymentApplied;
  paymentDoc.unappliedMinor = nextPaymentUnapplied;
  paymentDoc.allocationStatus = nextPaymentStatus;
  paymentDoc.relatedDueId = paymentDoc.relatedDueId ?? dueId;

  return applyMinor;
}

function unitBalanceRef(mgmtId: string, unitId: string) {
  return db.doc(`managements/${mgmtId}/unitBalances/${unitId}`);
}

/**
 * Applies a posted ledger entry delta to the unitBalances cache.
 * Idempotent: skips if balanceAppliedAt is already set on the entry.
 */
export const onLedgerCreated = onDocumentCreated(
  LEDGER_DOCUMENT_PATH,
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const entry = snap.data() as LedgerDoc;
    const { mgmtId, entryId } = event.params;

    // Only apply posted entries with a unitId
    if (entry.status !== "posted" || !entry.unitId) return;

    const balRef = unitBalanceRef(mgmtId, entry.unitId);
    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);

    try {
      await db.runTransaction(async (tx) => {
        const entrySnap = await tx.get(entryRef);
        const entryData = entrySnap.data() as LedgerDoc | undefined;

        // Idempotency: already applied
        if (entryData?.balanceAppliedAt) return;

        const balSnap = await tx.get(balRef);
        const now = FieldValue.serverTimestamp();

        const isDebit = entry.type === "DEBIT";

        // Exclude internal settlements from balance delta via explicit flag
        let delta = 0;
        let creditDelta = 0;
        let debitDelta = 0;

        const affectsBalance = entry.affectsBalance ?? (entry.source !== "auto_settlement");

        if (affectsBalance) {
          delta = isDebit ? -entry.amountMinor : entry.amountMinor;
          debitDelta = isDebit ? entry.amountMinor : 0;
          creditDelta = isDebit ? 0 : entry.amountMinor;
        }

        if (balSnap.exists) {
          tx.update(balRef, {
            balanceMinor: FieldValue.increment(delta),
            postedDebitMinor: FieldValue.increment(debitDelta),
            postedCreditMinor: FieldValue.increment(creditDelta),
            lastLedgerEventAt: now,
            lastAppliedEntryId: entryId,
            updatedAt: now,
            appliedCount: FieldValue.increment(1),
          });
        } else {
          tx.set(balRef, {
            unitId: entry.unitId,
            balanceMinor: delta,
            postedDebitMinor: debitDelta,
            postedCreditMinor: creditDelta,
            lastLedgerEventAt: now,
            lastAppliedEntryId: entryId,
            updatedAt: now,
            version: 1,
            appliedCount: 1,
          });
        }

        // Mark entry as applied (idempotency flag)
        tx.update(entryRef, {
          balanceAppliedAt: now,
          balanceAppliedVersion: 1,
        });
      });
    } catch (err) {
      console.error(`💥 Ledger Apply Failed: mgmt=${event.params.mgmtId} entry=${event.params.entryId}`, err);
      // Critical: Cache drift is imminent. Write alert immediately.
      // We catch, log/alert, and then RE-THROW so Firestore retries the event.
      try {
        await db.collection(`managements/${event.params.mgmtId}/alerts`).doc().set({
          type: "CACHE_APPLY_FAILED",
          unitId: (event.data?.data() as LedgerDoc)?.unitId || "unknown",
          ledgerEntryId: event.params.entryId,
          errorMessage: err instanceof Error ? err.message : String(err),
          detectedAt: FieldValue.serverTimestamp(),
          status: "open",
        });
      } catch (alertErr) {
        console.error("Failed to write CACHE_APPLY_FAILED alert:", alertErr);
      }
      throw err; // Ensure retry
    }
  });

/**
 * Reverts a posted ledger entry delta from unitBalances when status
 * transitions to voided or reversed.
 * Idempotent: skips if balanceRevertedAt is already set on the entry.
 *
 * Defensive guard: also skips if balanceAppliedAt was never set
 * (entry was never applied to cache → nothing to revert).
 */
export const onLedgerUpdated = onDocumentUpdated(
  LEDGER_DOCUMENT_PATH,
  async (event) => {
    const beforeData = event.data?.before?.data() as LedgerDoc | undefined;
    const afterData = event.data?.after?.data() as LedgerDoc | undefined;
    if (!beforeData || !afterData) return;

    // Only act on status transitions from posted to voided/reversed
    if (beforeData.status !== "posted") return;
    if (afterData.status !== "voided" && afterData.status !== "reversed") return;

    const { mgmtId, entryId } = event.params;
    const unitId = beforeData.unitId;

    // No unitId → no unit balance to revert
    if (!unitId) return;

    const balRef = unitBalanceRef(mgmtId, unitId);
    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);

    try {
      await db.runTransaction(async (tx) => {
        const entrySnap = await tx.get(entryRef);
        const entryData = entrySnap.data() as LedgerDoc | undefined;

        // Idempotency: already reverted
        if (entryData?.balanceRevertedAt) return;

        // Defensive: entry was never applied to cache → nothing to revert.
        // This can happen if void/reverse occurs before onLedgerCreated
        // trigger completes (race condition). Mark as reverted to prevent
        // future retries — the entry's delta was never in the cache.
        if (!entryData?.balanceAppliedAt) {
          console.warn(
            `⚠️ Entry ${entryId} was never applied (no balanceAppliedAt). ` +
            `Marking as reverted to prevent orphan revert.`
          );
          tx.update(entryRef, {
            balanceRevertedAt: FieldValue.serverTimestamp(),
            balanceRevertedVersion: 1,
          });
          return;
        }

        const balSnap = await tx.get(balRef);
        if (!balSnap.exists) {
          // Cache doc doesn't exist — nothing to revert
          // Still mark entry as reverted to prevent future retries
          tx.update(entryRef, {
            balanceRevertedAt: FieldValue.serverTimestamp(),
            balanceRevertedVersion: 1,
          });
          return;
        }

        const now = FieldValue.serverTimestamp();
        const isDebit = beforeData.type === "DEBIT";

        // Reverse the original delta (respecting affectsBalance)
        let reverseDelta = 0;
        let reverseCredit = 0;
        let reverseDebit = 0;

        const affectsBalance = beforeData.affectsBalance ?? (beforeData.source !== "auto_settlement");

        if (affectsBalance) {
          reverseDelta = isDebit ? beforeData.amountMinor : -beforeData.amountMinor;
          reverseDebit = isDebit ? -beforeData.amountMinor : 0;
          reverseCredit = isDebit ? 0 : -beforeData.amountMinor;
        }

        tx.update(balRef, {
          balanceMinor: FieldValue.increment(reverseDelta),
          postedDebitMinor: FieldValue.increment(reverseDebit),
          postedCreditMinor: FieldValue.increment(reverseCredit),
          lastLedgerEventAt: now,
          lastAppliedEntryId: entryId,
          updatedAt: now,
          appliedCount: FieldValue.increment(1),
        });

        // Mark entry as reverted (idempotency flag)
        tx.update(entryRef, {
          balanceRevertedAt: now,
          balanceRevertedVersion: 1,
        });
      });
    } catch (err) {
      console.error(`💥 Ledger Revert Failed: mgmt=${event.params.mgmtId} entry=${event.params.entryId}`, err);
      try {
        await db.collection(`managements/${event.params.mgmtId}/alerts`).doc().set({
          type: "CACHE_APPLY_FAILED",
          subtype: "REVERT_FAILED",
          unitId: (event.data?.before?.data() as LedgerDoc)?.unitId || "unknown",
          ledgerEntryId: event.params.entryId,
          errorMessage: err instanceof Error ? err.message : String(err),
          detectedAt: FieldValue.serverTimestamp(),
          status: "open",
        });
      } catch (alertErr) {
        console.error("Failed to write CACHE_APPLY_FAILED alert:", alertErr);
      }
      throw err; // Ensure retry
    }
  });

// ─── Cache Rebuild & Drift Guard ────────────────────────────────────

const REBUILD_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Writes an immutable audit log entry to managements/{mgmtId}/auditLogs.
 * Fire-and-forget style — audit write failure should not block the caller.
 * On failure, writes an AUDIT_WRITE_FAILED alert as a breadcrumb.
 */
async function writeAuditLog(
  mgmtId: string,
  action: string,
  actorUid: string,
  targetId: string,
  targetType: "unit" | "ledgerEntry" | "alert",
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const logRef = db.collection(`managements/${mgmtId}/auditLogs`).doc();
    await logRef.set({
      action,
      actorUid,
      targetId,
      targetType,
      managementId: mgmtId,
      at: FieldValue.serverTimestamp(),
      ...(metadata ? { metadata } : {}),
    });
  } catch (err) {
    // Audit log failure must not block the operation
    console.error(`⚠️ Audit log write failed: mgmt=${mgmtId} action=${action}`, err);

    // Leave a breadcrumb: write an AUDIT_WRITE_FAILED alert
    // Dedup: skip if an open AUDIT_WRITE_FAILED alert for the same action
    // already exists within the last hour (prevents spam on persistent failures).
    try {
      const oneHourAgo = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      const existingFailAlerts = await db
        .collection(`managements/${mgmtId}/alerts`)
        .where("type", "==", "AUDIT_WRITE_FAILED")
        .where("action", "==", action)
        .where("status", "==", "open")
        .where("detectedAt", ">=", oneHourAgo)
        .limit(1)
        .get();

      if (!existingFailAlerts.empty) {
        console.warn(
          `⏭️ AUDIT_WRITE_FAILED alert already exists for mgmt=${mgmtId} action=${action} within last hour, skipping.`
        );
      } else {
        await db.collection(`managements/${mgmtId}/alerts`).doc().set({
          type: "AUDIT_WRITE_FAILED",
          action,
          actorUid,
          targetId,
          targetType,
          errorMessage: err instanceof Error ? err.message : String(err),
          detectedAt: FieldValue.serverTimestamp(),
          status: "open",
        });
        console.warn(`🔔 AUDIT_WRITE_FAILED alert created for mgmt=${mgmtId} action=${action}`);
      }
    } catch (alertErr) {
      // Both audit log AND alert failed — only console.error remains
      console.error(`💥 AUDIT_WRITE_FAILED alert also failed: mgmt=${mgmtId}`, alertErr);
    }
  }
}

/**
 * Resolves open BALANCE_DRIFT alerts for a specific unit.
 * Only resolves alerts where detectedAt <= cutoffTime (rebuiltAt).
 * This prevents resolving alerts created AFTER the rebuild started
 * (race condition between concurrent driftCheck and rebuild).
 */
async function resolveAlertsForUnit(
  mgmtId: string,
  unitId: string,
  resolvedBy: string,
  cutoffTime?: Timestamp
): Promise<number> {
  let alertQuery = db
    .collection(`managements/${mgmtId}/alerts`)
    .where("type", "==", "BALANCE_DRIFT")
    .where("unitId", "==", unitId)
    .where("status", "==", "open");

  // Cutoff: only resolve alerts detected BEFORE or AT the rebuild time
  if (cutoffTime) {
    alertQuery = alertQuery.where("detectedAt", "<=", cutoffTime);
  }

  const openAlerts = await alertQuery.get();

  if (openAlerts.empty) return 0;

  const batch = db.batch();
  for (const alertDoc of openAlerts.docs) {
    batch.update(alertDoc.ref, {
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy,
      resolvedReason: "REBUILD_AUTO_RESOLVE",
    });
  }
  await batch.commit();

  // Write audit log for each resolved alert
  for (const alertDoc of openAlerts.docs) {
    const alertData = alertDoc.data();
    await writeAuditLog(mgmtId, "ALERT_AUTO_RESOLVED", resolvedBy, alertDoc.id, "alert", {
      unitId,
      originalAlertType: "BALANCE_DRIFT",
      resolvedReason: "REBUILD_AUTO_RESOLVE",
      canonicalBalance: alertData.canonicalBalance, // Link context: what was the correct balance?
      driftWas: alertData.diff // Link context: how bad was it?
    });
  }

  return openAlerts.size;
}

type MembershipDoc = {
  role?: MembershipRole;
  status?: "active" | "inactive" | "revoked";
};

const ROLE_PERMISSIONS: Record<MembershipRole, ReadonlyArray<Permission>> = {
  owner: ["payment", "void", "reverse", "dues_run", "expense", "adjustment", "admin_ops"],
  admin: ["payment", "void", "reverse", "dues_run", "expense", "adjustment", "admin_ops"],
  manager: ["payment"],
  viewer: []
};

function membershipRef(mgmtId: string, uid: string) {
  return db.doc(`managementMemberships/${mgmtId}/users/${uid}`);
}

function isMembershipRole(value: unknown): value is MembershipRole {
  return value === "owner" || value === "admin" || value === "manager" || value === "viewer";
}

function roleHasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

async function resolveCallerRole(mgmtId: string, uid: string): Promise<MembershipRole | null> {
  const mgmtSnap = await db.doc(`managements/${mgmtId}`).get();
  if (!mgmtSnap.exists) {
    throw new HttpsError("not-found", "MANAGEMENT_NOT_FOUND");
  }
  const mgmtData = mgmtSnap.data();
  if (mgmtData?.ownerUid === uid) {
    return "owner";
  }

  const membershipSnap = await membershipRef(mgmtId, uid).get();
  if (!membershipSnap.exists) return null;
  const membership = membershipSnap.data() as MembershipDoc;
  if (membership.status !== "active") return null;
  if (!isMembershipRole(membership.role)) return null;
  return membership.role;
}

async function requireManagementPermission(
  request: { auth?: { uid: string } },
  mgmtId: string,
  permission: Permission
): Promise<{ uid: string; role: MembershipRole }> {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const uid = request.auth.uid;
  const role = await resolveCallerRole(mgmtId, uid);
  if (!role) {
    throw new HttpsError("permission-denied", "MEMBERSHIP_REQUIRED");
  }
  if (!roleHasPermission(role, permission)) {
    throw new HttpsError("permission-denied", "INSUFFICIENT_ROLE_PERMISSION");
  }
  return { uid, role };
}

/**
 * Computes canonical balance from ALL ledger entries for a unit.
 * Only posted entries are counted. Voided/reversed entries are ignored.
 * This is the single source of truth computation — used by both
 * rebuild and drift check.
 */
async function computeCanonicalBalance(mgmtId: string, unitId: string) {
  let postedDebitMinor = 0;
  let postedCreditMinor = 0;
  let entryCount = 0;
  let latestCreatedAt = 0;

  const ledgerSnap = await db
    .collection(`managements/${mgmtId}/ledger`)
    .where("unitId", "==", unitId)
    .get();

  for (const doc of ledgerSnap.docs) {
    const entry = doc.data() as LedgerDoc & { createdAt?: number };

    // Only count posted entries
    if (entry.status !== "posted") continue;

    if (entry.type === "DEBIT") {
      postedDebitMinor += entry.amountMinor;
    } else if (entry.type === "CREDIT") {
      // Exclude internal settlements based on affectsBalance flag
      const affectsBalance = entry.affectsBalance ?? (entry.source !== "auto_settlement");
      if (affectsBalance) {
        postedCreditMinor += entry.amountMinor;
      }
    }

    entryCount++;

    if (entry.createdAt && entry.createdAt > latestCreatedAt) {
      latestCreatedAt = entry.createdAt;
    }
  }

  const balanceMinor = postedCreditMinor - postedDebitMinor;

  return {
    balanceMinor,
    postedDebitMinor,
    postedCreditMinor,
    entryCount,
    totalEntries: ledgerSnap.size,
    latestCreatedAt,
  };
}

/**
 * Rebuilds the unitBalances cache doc for a single unit from canonical
 * ledger data. Uses set (NEVER increment). Idempotent.
 * Callable: admin/owner only, App Check enforced.
 */
export const rebuildUnitBalance = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const unitId = request.data?.unitId;
    const force = request.data?.force === true;

    if (!isValidId(mgmtId) || !isValidId(unitId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    // ── Tenant boundary + admin/owner check ──────────────────────
    await requireManagementPermission(request, mgmtId, "admin_ops");
    const callerUid = request.auth!.uid;

    // ── Phase 1: Snapshot current cache state ───────────────────
    const balRef = unitBalanceRef(mgmtId, unitId);
    const preSnap = await balRef.get();
    const preData = preSnap.exists ? preSnap.data() : null;
    const currentVersion = preData?.version ?? 0;
    const preAppliedCount: number = preData?.appliedCount ?? 0;

    // ── Rebuild throttle guard ───────────────────────────────────
    // Prevents accidental cost spikes from repeated rebuilds.
    // Admin can override with force: true.
    if (!force && preSnap.exists) {
      const rebuiltAt = preData?.rebuiltAt;
      if (rebuiltAt) {
        const rebuiltMs = typeof rebuiltAt.toMillis === "function"
          ? rebuiltAt.toMillis()
          : rebuiltAt;
        const elapsed = Date.now() - rebuiltMs;
        if (elapsed < REBUILD_THROTTLE_MS) {
          const remainingSec = Math.ceil((REBUILD_THROTTLE_MS - elapsed) / 1000);
          throw new HttpsError(
            "failed-precondition",
            `REBUILD_THROTTLED: Last rebuild was ${Math.floor(elapsed / 1000)}s ago. ` +
            `Wait ${remainingSec}s or use force:true.`
          );
        }
      }
    }

    // ── Phase 2: Compute canonical balance (potentially slow) ───
    const canonical = await computeCanonicalBalance(mgmtId, unitId);

    // ── Phase 3: Watermark-safe conditional commit ──────────────
    // Transaction reads only 1 doc (balRef) — well within 10s limit.
    // If a trigger incremented appliedCount during Phase 2,
    // our canonical snapshot is stale — abort to prevent data loss.
    const committed = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(balRef);
      const freshAppliedCount: number = freshSnap.exists
        ? (freshSnap.data()?.appliedCount ?? 0)
        : 0;

      if (freshAppliedCount > preAppliedCount) {
        console.warn(
          `⚠️ Rebuild skipped (watermark advanced): mgmt=${mgmtId} unit=${unitId} ` +
          `pre=${preAppliedCount} now=${freshAppliedCount}`
        );
        return false;
      }

      // Safe to overwrite: cache has not been mutated since our snapshot
      tx.set(balRef, {
        unitId,
        balanceMinor: canonical.balanceMinor,
        postedDebitMinor: canonical.postedDebitMinor,
        postedCreditMinor: canonical.postedCreditMinor,
        lastLedgerEventAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        rebuiltAt: FieldValue.serverTimestamp(),
        rebuiltBy: callerUid,
        rebuiltFromEntryCount: canonical.entryCount,
        version: currentVersion + 1,
        appliedCount: freshAppliedCount, // Preserve counter — triggers continue from here
      });

      return true;
    });

    if (!committed) {
      return {
        ok: false,
        skipped: true,
        reason: "CONCURRENT_LEDGER_ACTIVITY",
        preAppliedCount,
      };
    }

    console.log(
      `✅ Rebuilt unitBalance: mgmt=${mgmtId} unit=${unitId} ` +
      `balance=${canonical.balanceMinor} debit=${canonical.postedDebitMinor} ` +
      `credit=${canonical.postedCreditMinor} entries=${canonical.entryCount}`
    );

    // ── Alert auto-resolve ───────────────────────────────────────
    // After successful rebuild, resolve all open BALANCE_DRIFT alerts
    // for this unit. Only resolve alerts detected BEFORE the rebuild.
    const rebuildCutoff = Timestamp.now();
    const resolvedCount = await resolveAlertsForUnit(mgmtId, unitId, callerUid, rebuildCutoff);
    if (resolvedCount > 0) {
      console.log(
        `🔔 Auto-resolved ${resolvedCount} open alert(s) for mgmt=${mgmtId} unit=${unitId}`
      );
    }

    // ── Audit log ────────────────────────────────────────────────
    await writeAuditLog(mgmtId, "REBUILD_BALANCE", callerUid, unitId, "unit", {
      balanceMinor: canonical.balanceMinor,
      postedDebitMinor: canonical.postedDebitMinor,
      postedCreditMinor: canonical.postedCreditMinor,
      entryCount: canonical.entryCount,
      version: currentVersion + 1,
      force,
      alertsResolved: resolvedCount,
    });

    return {
      ok: true,
      balanceMinor: canonical.balanceMinor,
      postedDebitMinor: canonical.postedDebitMinor,
      postedCreditMinor: canonical.postedCreditMinor,
      entryCount: canonical.entryCount,
      version: currentVersion + 1,
      alertsResolved: resolvedCount,
    };
  }
);

// ─── Drift Check (Optimized Sampling) ───────────────────────────────

const DRIFT_SAMPLE_SIZE = 5;

/**
 * Daily scheduled drift check.
 * Samples up to 5 units per management using orderBy("updatedAt", "desc").limit(5).
 * This targets the most recently mutated caches — where drift is most likely.
 * No full-scan, no Fisher–Yates shuffle. O(5) reads per management.
 */
export const driftCheckUnitBalances = onSchedule("every day 04:00", async () => {
  // Get all managements
  const mgmtSnap = await db.collection("managements").get();

  for (const mgmtDoc of mgmtSnap.docs) {
    const mgmtId = mgmtDoc.id;

    // ── Optimized sampling ─────────────────────────────────────
    // orderBy updatedAt desc → most recently changed caches first
    // limit(DRIFT_SAMPLE_SIZE) → O(5) reads, not O(n)
    const balSnap = await db
      .collection(`managements/${mgmtId}/unitBalances`)
      .orderBy("updatedAt", "desc")
      .limit(DRIFT_SAMPLE_SIZE)
      .get();

    if (balSnap.empty) {
      console.log(`ℹ️ No unitBalances for mgmt=${mgmtId}, skipping drift check.`);
      continue;
    }

    for (const balDoc of balSnap.docs) {
      const unitId = balDoc.id;
      const cachedData = balDoc.data();
      const cachedBalance: number = cachedData?.balanceMinor ?? 0;

      // Compute canonical from ledger
      const canonical = await computeCanonicalBalance(mgmtId, unitId);

      if (canonical.balanceMinor === cachedBalance) {
        console.log(`✅ No drift: mgmt=${mgmtId} unit=${unitId} balance=${cachedBalance}`);
        continue;
      }

      // Drift detected!
      const diff = canonical.balanceMinor - cachedBalance;
      const appliedCount = cachedData?.appliedCount ?? "N/A";
      console.warn(
        `⚠️ DRIFT DETECTED: mgmt=${mgmtId} unit=${unitId} ` +
        `canonical=${canonical.balanceMinor} cached=${cachedBalance} diff=${diff} appliedCount=${appliedCount}`
      );

      // ── Alert spam guard ─────────────────────────────────────
      const existingAlerts = await db
        .collection(`managements/${mgmtId}/alerts`)
        .where("type", "==", "BALANCE_DRIFT")
        .where("unitId", "==", unitId)
        .where("status", "==", "open")
        .limit(1)
        .get();

      if (!existingAlerts.empty) {
        console.log(
          `⏭️ Open alert already exists for mgmt=${mgmtId} unit=${unitId}, skipping.`
        );
        continue;
      }

      // Write alert
      const alertRef = db.collection(`managements/${mgmtId}/alerts`).doc();
      await alertRef.set({
        type: "BALANCE_DRIFT",
        unitId,
        canonicalBalance: canonical.balanceMinor,
        cachedBalance,
        diff,
        detectedAt: FieldValue.serverTimestamp(),
        status: "open",
      });

      console.log(`🔔 Alert created: mgmt=${mgmtId} alertId=${alertRef.id}`);

      // Audit log for drift detection
      await writeAuditLog(mgmtId, "DRIFT_DETECTED", "system", unitId, "unit", {
        canonicalBalance: canonical.balanceMinor,
        cachedBalance,
        diff,
        alertId: alertRef.id,
      });
    }
  }

  console.log("🏁 Drift check completed.");
});

// ─── Ledger Void / Reverse (Server-Side) ────────────────────────────

/**
 * Creates a payment ledger entry with strict idempotency.
 * Doc ID is deterministic: payment_{idempotencyKey}
 */
export const createPayment = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const unitId = request.data?.unitId;
    const amountMinor = request.data?.amountMinor;
    const method = request.data?.method;
    const idempotencyKey = normalizeIdempotencyKey(request.data?.idempotencyKey);
    const reference = normalizeOptionalString(request.data?.reference, 512);
    const relatedDueId = ensureOptionalDocId(request.data?.relatedDueId, "related_due_id");
    const legacyDate = normalizeOptionalString(request.data?.legacyDate, 32);
    const legacyCategoryType = normalizeOptionalString(request.data?.legacyCategoryType, 32);
    const periodMonth = request.data?.periodMonth;
    const periodYear = request.data?.periodYear;

    if (!isValidId(managementId) || !isValidId(unitId)) {
      throw new HttpsError("invalid-argument", "INVALID_MANAGEMENT_OR_UNIT");
    }
    if (!isPositiveInteger(amountMinor)) {
      throw new HttpsError("invalid-argument", "INVALID_AMOUNT_MINOR");
    }
    if (!isValidPaymentMethod(method)) {
      throw new HttpsError("invalid-argument", "INVALID_PAYMENT_METHOD");
    }
    if (!reference) {
      throw new HttpsError("invalid-argument", "REFERENCE_REQUIRED");
    }
    if (periodMonth != null && (!Number.isInteger(periodMonth) || periodMonth < 0 || periodMonth > 11)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_MONTH");
    }
    if (periodYear != null && (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 3000)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_YEAR");
    }

    const authz = await requireManagementPermission(request, managementId, "payment");
    const callerUid = authz.uid;

    const entryId = `payment_${idempotencyKey}`;
    const paymentRef = db.doc(`managements/${managementId}/ledger/${entryId}`);
    const unitRef = db.doc(`managements/${managementId}/units/${unitId}`);
    const auditRef = db.doc(`managements/${managementId}/auditLogs/payment_${idempotencyKey}`);

    const result = await db.runTransaction(async (tx) => {
      // ── PHASE 1: ALL READS ──────────────────────────────────────────
      const existingSnap = await tx.get(paymentRef);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as LedgerDoc;
        const existingAmount = Number(existing.amountMinor ?? 0);
        const existingUnitId = (existing.unitId as string | null) ?? null;
        const existingRelatedDueId =
          typeof existing.relatedDueId === "string" && existing.relatedDueId.trim().length > 0
            ? existing.relatedDueId
            : null;
        if (existing.type !== "CREDIT" || existingAmount !== amountMinor || existingUnitId !== unitId) {
          throw new HttpsError("already-exists", "IDEMPOTENCY_KEY_CONFLICT");
        }
        if (relatedDueId && existingRelatedDueId && relatedDueId !== existingRelatedDueId) {
          throw new HttpsError("already-exists", "IDEMPOTENCY_KEY_CONFLICT");
        }
        const paymentProgress = computePaymentProgress(existing);
        return {
          created: false,
          entryId,
          managementId,
          unitId: existingUnitId ?? unitId,
          amountMinor: existingAmount,
          source: String(existing.source ?? method),
          reference: String(existing.reference ?? reference),
          relatedDueId: existingRelatedDueId,
          status: String(existing.status ?? "posted"),
          appliedMinor: paymentProgress.applied,
          unappliedMinor: paymentProgress.unapplied,
          allocationStatus: paymentProgress.status,
          allocationCount: 0,
          allocationDueIds: [] as string[]
        };
      }

      const unitSnap = await tx.get(unitRef);
      if (!unitSnap.exists) {
        throw new HttpsError("not-found", "UNIT_NOT_FOUND");
      }

      // Pre-read due candidates or explicit due + allocation refs
      // (Firestore requires all reads before any writes)
      type DueCandidate = { id: string; ref: admin.firestore.DocumentReference; data: LedgerDoc };
      let dueCandidates: DueCandidate[] = [];
      let explicitDueSnap: admin.firestore.DocumentSnapshot | null = null;
      let explicitAllocationSnap: admin.firestore.DocumentSnapshot | null = null;

      if (relatedDueId) {
        const explicitDueRef = db.doc(`managements/${managementId}/ledger/${relatedDueId}`);
        const allocationId = `alloc_payment_${idempotencyKey}_${relatedDueId}`;
        const allocRef = dueAllocationRef(managementId, allocationId);
        [explicitDueSnap, explicitAllocationSnap] = await Promise.all([
          tx.get(explicitDueRef),
          tx.get(allocRef)
        ]);
      } else {
        const dueCandidatesSnap = await tx.get(
          db.collection(`managements/${managementId}/ledger`).where("unitId", "==", unitId)
        );
        const rawCandidates = dueCandidatesSnap.docs
          .map((d) => ({ id: d.id, ref: d.ref, data: d.data() as LedgerDoc }))
          .filter((d) => d.data.status === "posted" && isDueLedgerEntry(d.data, d.id))
          .filter((d) => computeDueProgress(d.data).outstanding > 0)
          .sort((a, b) => {
            const keyA = canonicalDueSortKey(a.data);
            const keyB = canonicalDueSortKey(b.data);
            if (keyA !== keyB) return keyA.localeCompare(keyB);
            return a.id.localeCompare(b.id);
          });
        dueCandidates = rawCandidates;

        // Pre-read all allocation docs for candidates
        const allocSnaps = await Promise.all(
          rawCandidates.map((d) => {
            const allocId = `alloc_payment_${idempotencyKey}_${d.id}`;
            return tx.get(dueAllocationRef(managementId, allocId));
          })
        );
        // Attach pre-read allocation snaps to candidates for later use
        (dueCandidates as (DueCandidate & { _allocSnap?: admin.firestore.DocumentSnapshot })[])
          .forEach((c, i) => { (c as DueCandidate & { _allocSnap?: admin.firestore.DocumentSnapshot })._allocSnap = allocSnaps[i]; });
      }

      // ── PHASE 2: ALL WRITES ─────────────────────────────────────────
      const paymentDoc: LedgerDoc = {
        managementId,
        unitId,
        type: "CREDIT",
        source: method,
        status: "posted",
        affectsBalance: true,
        amountMinor,
        currency: "TRY",
        description: reference,
        reference,
        relatedDueId: relatedDueId ?? null,
        appliedMinor: 0,
        unappliedMinor: amountMinor,
        allocationStatus: "unapplied",
        ...(legacyDate ? { legacyDate } : {}),
        ...(legacyCategoryType ? { legacyCategoryType } : {}),
        periodMonth: periodMonth ?? null,
        periodYear: periodYear ?? null,
        idempotencyKey,
        createdBy: callerUid,
        metadata: {
          cashIn: true,
          paymentMethod: method,
        }
      };

      tx.set(paymentRef, {
        ...paymentDoc,
        createdAt: FieldValue.serverTimestamp()
      });

      let allocatedMinor = 0;
      let allocationCount = 0;
      const allocationDueIds: string[] = [];

      if (relatedDueId) {
        const explicitDueRef = db.doc(`managements/${managementId}/ledger/${relatedDueId}`);
        const applied = allocateAmountToDuePreRead(tx, {
          managementId,
          unitId,
          dueRef: explicitDueRef,
          dueId: relatedDueId,
          dueData: explicitDueSnap?.exists ? explicitDueSnap.data() as LedgerDoc : null,
          allocationSnap: explicitAllocationSnap!,
          paymentRef,
          paymentEntryId: entryId,
          paymentDoc,
          actorUid: callerUid,
          amountToApplyMinor: amountMinor
        });
        if (applied <= 0) {
          throw new HttpsError("failed-precondition", "DUE_ALREADY_PAID");
        }
        allocatedMinor += applied;
        allocationCount += 1;
        allocationDueIds.push(relatedDueId);
      } else {
        for (let i = 0; i < dueCandidates.length; i++) {
          const due = dueCandidates[i] as DueCandidate & { _allocSnap?: admin.firestore.DocumentSnapshot };
          const remaining = computePaymentProgress(paymentDoc).unapplied;
          if (remaining <= 0) break;

          const allocId = `alloc_payment_${idempotencyKey}_${due.id}`;
          const allocRef = dueAllocationRef(managementId, allocId);
          const allocSnap = due._allocSnap;

          const applied = allocateAmountToDuePreRead(tx, {
            managementId,
            unitId,
            dueRef: due.ref,
            dueId: due.id,
            dueData: due.data,
            allocationSnap: allocSnap!,
            paymentRef,
            paymentEntryId: entryId,
            paymentDoc,
            actorUid: callerUid,
            amountToApplyMinor: remaining
          });
          if (applied > 0) {
            allocatedMinor += applied;
            allocationCount += 1;
            allocationDueIds.push(due.id);
          }
        }
      }

      const paymentProgress = computePaymentProgress(paymentDoc);

      tx.set(auditRef, {
        action: "PAYMENT_CREATED",
        actorUid: callerUid,
        targetId: entryId,
        targetType: "ledgerEntry",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          unitId,
          amountMinor,
          method,
          reference,
          idempotencyKey,
          relatedDueId: relatedDueId ?? null,
          allocatedMinor,
          unappliedMinor: paymentProgress.unapplied,
          allocationStatus: paymentProgress.status,
          allocationCount,
          allocationDueIds,
          periodMonth: periodMonth ?? null,
          periodYear: periodYear ?? null
        }
      });

      return {
        created: true,
        entryId,
        managementId,
        unitId,
        amountMinor,
        source: method,
        reference,
        relatedDueId: relatedDueId ?? null,
        status: "posted",
        appliedMinor: paymentProgress.applied,
        unappliedMinor: paymentProgress.unapplied,
        allocationStatus: paymentProgress.status,
        allocationCount,
        allocationDueIds
      };
    });

    return { ok: true, ...result };
  }
);

/**
 * Reverses a posted payment entry with allocation reversal.
 * Immutable model: original payment/allocation docs are never deleted.
 * New documents:
 *   - ledger/reversal_{paymentEntryId} (DEBIT)
 *   - dueAllocations/reversalAlloc_{allocationId} (negative amountMinor)
 */
export const reversePayment = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const paymentEntryId = request.data?.paymentEntryId;
    const reason = normalizeOptionalString(request.data?.reason ?? "", 512) ?? "";

    if (!isValidId(managementId) || !isValidId(paymentEntryId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    const authz = await requireManagementPermission(request, managementId, "reverse");
    const callerUid = authz.uid;

    const paymentRef = db.doc(`managements/${managementId}/ledger/${paymentEntryId}`);
    const reversalEntryId = `reversal_${paymentEntryId}`;
    const reversalRef = db.doc(`managements/${managementId}/ledger/${reversalEntryId}`);
    const auditRef = db.doc(`managements/${managementId}/auditLogs/reversePayment_${paymentEntryId}`);

    const result = await db.runTransaction(async (tx) => {
      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new HttpsError("not-found", "PAYMENT_NOT_FOUND");
      }
      const payment = paymentSnap.data() as LedgerDoc;
      if (payment.managementId && payment.managementId !== managementId) {
        throw new HttpsError("permission-denied", "TENANT_BOUNDARY_VIOLATION");
      }
      if (payment.type !== "CREDIT") {
        throw new HttpsError("failed-precondition", "PAYMENT_TYPE_INVALID");
      }

      const reversalSnap = await tx.get(reversalRef);
      if (reversalSnap.exists) {
        const existing = reversalSnap.data() as LedgerDoc;
        return {
          noop: true as const,
          reversalEntryId,
          reversedAllocationCount: Number(existing.metadata?.reversedAllocationCount ?? 0),
          reversedAllocationMinor: Number(existing.metadata?.reversedAllocationMinor ?? 0),
          dueIds: Array.isArray(existing.metadata?.dueIds)
            ? (existing.metadata?.dueIds as string[])
            : []
        };
      }

      if (payment.status === "reversed") {
        throw new HttpsError("failed-precondition", "PAYMENT_ALREADY_REVERSED_WITHOUT_REVERSAL_DOC");
      }
      if (payment.status !== "posted") {
        throw new HttpsError("failed-precondition", `PAYMENT_NOT_POSTED: '${payment.status}'`);
      }
      if (!isPositiveInteger(payment.amountMinor)) {
        throw new HttpsError("failed-precondition", "PAYMENT_AMOUNT_INVALID");
      }

      const allocByPaymentIdQuery = db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("paymentId", "==", paymentEntryId);
      const allocByPaymentEntryIdQuery = db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("paymentEntryId", "==", paymentEntryId);

      const allocByPaymentIdSnap = await tx.get(allocByPaymentIdQuery);
      const allocByPaymentEntryIdSnap = await tx.get(allocByPaymentEntryIdQuery);

      const originalAllocations = new Map<
        string,
        { id: string; ref: admin.firestore.DocumentReference; data: DueAllocationDoc }
      >();
      for (const d of allocByPaymentIdSnap.docs) {
        originalAllocations.set(d.id, {
          id: d.id,
          ref: d.ref,
          data: d.data() as DueAllocationDoc
        });
      }
      for (const d of allocByPaymentEntryIdSnap.docs) {
        if (!originalAllocations.has(d.id)) {
          originalAllocations.set(d.id, {
            id: d.id,
            ref: d.ref,
            data: d.data() as DueAllocationDoc
          });
        }
      }

      if (originalAllocations.size > MAX_ALLOCATION_REVERSALS_PER_TX) {
        throw new HttpsError("resource-exhausted", "TOO_MANY_ALLOCATIONS_FOR_SINGLE_REVERSE_TX");
      }

      const dueReverseMinorById = new Map<string, number>();
      const pendingReversalAllocations: Array<{
        ref: admin.firestore.DocumentReference;
        data: DueAllocationDoc;
      }> = [];
      const dueIds = new Set<string>();
      let reversedAllocationCount = 0;
      let reversedAllocationMinor = 0;

      for (const allocation of originalAllocations.values()) {
        const dueId = allocation.data?.dueId;
        const amountMinor = safeMinor(allocation.data?.amountMinor);
        if (!isValidId(dueId) || amountMinor <= 0) {
          continue;
        }

        const existingReverseAllocRef = dueAllocationRef(managementId, `reversalAlloc_${allocation.id}`);
        const existingReverseAllocSnap = await tx.get(existingReverseAllocRef);
        if (existingReverseAllocSnap.exists) {
          continue;
        }

        const unitId = allocation.data.unitId || payment.unitId;
        if (!unitId || typeof unitId !== "string") {
          throw new HttpsError("failed-precondition", "ALLOCATION_UNIT_MISSING");
        }

        pendingReversalAllocations.push({
          ref: existingReverseAllocRef,
          data: {
            managementId,
            unitId,
            dueId,
            paymentId: reversalEntryId,
            paymentEntryId: reversalEntryId,
            originalAllocationId: allocation.id,
            amountMinor: -amountMinor,
            status: "applied",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: callerUid,
            idempotencyKey: `reversalAlloc_${allocation.id}`
          } satisfies DueAllocationDoc
        });

        dueReverseMinorById.set(dueId, (dueReverseMinorById.get(dueId) ?? 0) + amountMinor);
        reversedAllocationCount += 1;
        reversedAllocationMinor += amountMinor;
        dueIds.add(dueId);
      }

      const dueUpdates: Array<{
        dueRef: admin.firestore.DocumentReference;
        dueTotalMinor: number;
        dueAllocatedMinor: number;
        dueOutstandingMinor: number;
        dueStatus: DueStatus;
      }> = [];

      for (const [dueId, reverseMinorRaw] of dueReverseMinorById.entries()) {
        const reverseMinor = safeMinor(reverseMinorRaw);
        if (reverseMinor <= 0) continue;
        const canonical = await computeCanonicalDueAggregates(managementId, dueId, tx);
        const reversibleMinor = Math.min(reverseMinor, Math.max(canonical.allocatedMinor, 0));
        const nextDueAllocatedMinor = canonical.allocatedMinor - reversibleMinor;
        const nextDueOutstandingMinor = canonical.dueTotalMinor - nextDueAllocatedMinor;
        const nextDueStatus: DueStatus = nextDueOutstandingMinor > 0 ? "open" : "paid";

        dueUpdates.push({
          dueRef: canonical.dueRef,
          dueTotalMinor: canonical.dueTotalMinor,
          dueAllocatedMinor: nextDueAllocatedMinor,
          dueOutstandingMinor: nextDueOutstandingMinor,
          dueStatus: nextDueStatus
        });
      }

      for (const allocation of pendingReversalAllocations) {
        tx.set(allocation.ref, allocation.data);
      }

      for (const dueUpdate of dueUpdates) {
        tx.update(dueUpdate.dueRef, {
          dueTotalMinor: dueUpdate.dueTotalMinor,
          dueAllocatedMinor: dueUpdate.dueAllocatedMinor,
          dueOutstandingMinor: dueUpdate.dueOutstandingMinor,
          dueStatus: dueUpdate.dueStatus,
          dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
          dueAggregateVersion: FieldValue.increment(1)
        });
      }

      tx.set(reversalRef, {
        managementId,
        unitId: payment.unitId ?? null,
        type: "DEBIT",
        amountMinor: payment.amountMinor,
        currency: payment.currency ?? "TRY",
        source: "reversal",
        description: reason
          ? `Payment reversal: ${reason}`
          : `Payment reversal of ${paymentEntryId}`,
        status: "posted",
        reversalOf: paymentEntryId,
        reversesEntryId: paymentEntryId,
        idempotencyKey: reversalEntryId,
        relatedDueId: payment.relatedDueId ?? null,
        reference: payment.reference ?? null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
        metadata: {
          kind: "PAYMENT_REVERSAL",
          originalPaymentId: paymentEntryId,
          reversedAllocationCount,
          reversedAllocationMinor,
          dueIds: Array.from(dueIds),
          reason: reason || null
        }
      });

      tx.update(paymentRef, {
        status: "reversed",
        reversedAt: FieldValue.serverTimestamp(),
        reversedBy: callerUid,
        reversalEntryId
      });

      tx.set(auditRef, {
        action: "PAYMENT_REVERSED",
        actorUid: callerUid,
        targetId: paymentEntryId,
        targetType: "ledgerEntry",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          reversalEntryId,
          reversedAllocationCount,
          reversedAllocationMinor,
          dueIds: Array.from(dueIds),
          reason: reason || null
        }
      });

      return {
        noop: false as const,
        reversalEntryId,
        reversedAllocationCount,
        reversedAllocationMinor,
        dueIds: Array.from(dueIds)
      };
    });

    return { ok: true, managementId, paymentEntryId, ...result };
  }
);

/**
 * Auto-settles FIFO open dues from existing manual credit balance.
 * Permission: owner/admin/manager (payment permission set).
 *
 * SaaS-level idempotency: if `clientRequestId` is provided, the result
 * is stored and returned on duplicate calls. Frontend retries get the
 * original successful result instead of an error.
 */
export const autoSettleFromCredit = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const unitId = request.data?.unitId;
    const clientRequestId = typeof request.data?.clientRequestId === "string"
      ? request.data.clientRequestId.trim().slice(0, 128)
      : null;

    if (!isValidId(managementId) || !isValidId(unitId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    const authz = await requireManagementPermission(request, managementId, "payment");
    const callerUid = authz.uid;

    // ── SaaS Idempotency: check for previous result ─────────────
    if (clientRequestId) {
      const prevRef = db.doc(
        `managements/${managementId}/settleResults/${clientRequestId}`
      );
      const prevSnap = await prevRef.get();
      if (prevSnap.exists) {
        const prev = prevSnap.data() as Record<string, unknown>;
        // Validate tenant + unit boundary
        if (prev.managementId === managementId && prev.unitId === unitId) {
          console.log(
            `ℹ️ autoSettleFromCredit idempotent replay: clientRequestId=${clientRequestId}`
          );


          // ── stillValid check: verify allocations integrity ──
          // Simply checking ledger status is risky if intermediate reversals occurred.
          // We check the NET EFFECT: do the allocations still exist with positive value?
          let stillValid = true;
          const settlementIds = Array.isArray(prev.settlementEntryIds)
            ? (prev.settlementEntryIds as string[])
            : [];

          if (settlementIds.length > 0) {
            // Sample check to ensure validity (checking all might be expensive, checking head is usually enough)
            for (const sid of settlementIds.slice(0, 10)) {
              // 1. Check allocations (Primary Truth)
              const allocSnap = await db
                .collection(`managements/${managementId}/dueAllocations`)
                .where("paymentEntryId", "==", sid)
                .get();

              // If allocations sum to <= 0, it means they were reversed.
              const allocSum = allocSnap.docs.reduce((sum, d) => sum + (d.data().amountMinor ?? 0), 0);
              if (allocSum <= 0) {
                stillValid = false;
                break;
              }

              // 2. Check ledger status (Backup Truth)
              const sDoc = await db.doc(`managements/${managementId}/ledger/${sid}`).get();
              if (!sDoc.exists || (sDoc.data() as LedgerDoc).status !== "posted") {
                stillValid = false;
                break;
              }
            }
          }

          return {
            closedDueCount: prev.closedDueCount as number,
            totalSettledMinor: prev.totalSettledMinor as number,
            remainingCreditMinor: prev.remainingCreditMinor as number,
            replay: true,
            stillValid,
          };
        }
        // Different unit/mgmt → conflict
        throw new HttpsError("already-exists", "CLIENT_REQUEST_ID_CONFLICT");
      }
    }

    const runId = db.collection("_").doc().id;
    const runTs = Date.now();
    const auditRef = db.doc(`managements/${managementId}/auditLogs/autoSettle_${unitId}_${runTs}`);
    const unitRef = db.doc(`managements/${managementId}/units/${unitId}`);

    const result = await db.runTransaction(async (tx) => {
      const unitSnap = await tx.get(unitRef);
      if (!unitSnap.exists) {
        throw new HttpsError("not-found", "UNIT_NOT_FOUND");
      }

      const dueCandidatesSnap = await tx.get(
        db.collection(`managements/${managementId}/ledger`)
          .where("unitId", "==", unitId)
      );
      const openDues = dueCandidatesSnap.docs
        .map((d) => ({ id: d.id, ref: d.ref, data: d.data() as LedgerDoc }))
        .filter((d) => d.data.status === "posted" && isDueLedgerEntry(d.data, d.id))
        .filter((d) => d.data.dueStatus === "open" || computeDueProgress(d.data).outstanding > 0)
        .sort((a, b) => {
          const wA = dueFifoWeight(a.data);
          const wB = dueFifoWeight(b.data);
          if (wA !== wB) return wA - wB;
          const tA = timestampToMillis(a.data.createdAt);
          const tB = timestampToMillis(b.data.createdAt);
          if (tA !== tB) return tA - tB;
          return a.id.localeCompare(b.id);
        });

      if (openDues.length === 0) {
        throw new HttpsError("failed-precondition", "NO_ELIGIBLE_DUES");
      }

      const creditCandidatesSnap = await tx.get(
        db.collection(`managements/${managementId}/ledger`)
          .where("unitId", "==", unitId)
      );
      const creditPayments = creditCandidatesSnap.docs
        .map((d) => ({ id: d.id, ref: d.ref, data: d.data() as LedgerDoc }))
        .filter((d) =>
          d.data.status === "posted" &&
          d.data.type === "CREDIT" &&
          isManualPaymentSource(d.data.source) &&
          safeMinor(d.data.unappliedMinor) > 0
        )
        .sort((a, b) => {
          const tA = timestampToMillis(a.data.createdAt);
          const tB = timestampToMillis(b.data.createdAt);
          if (tA !== tB) return tA - tB;
          return a.id.localeCompare(b.id);
        });

      let availableCreditMinor = creditPayments.reduce(
        (sum, p) => sum + safeMinor(p.data.unappliedMinor),
        0
      );
      if (availableCreditMinor <= 0) {
        throw new HttpsError("failed-precondition", "NO_ELIGIBLE_DUES");
      }

      const closableDues: Array<{
        dueId: string;
        dueRef: admin.firestore.DocumentReference;
        due: LedgerDoc;
        dueOutstandingMinor: number;
      }> = [];
      let consumeTargetMinor = 0;

      for (const due of openDues) {
        const dueProgress = computeDueProgress(due.data);
        if (dueProgress.outstanding <= 0) continue;
        if (availableCreditMinor >= dueProgress.outstanding) {
          closableDues.push({
            dueId: due.id,
            dueRef: due.ref,
            due: due.data,
            dueOutstandingMinor: dueProgress.outstanding
          });
          availableCreditMinor -= dueProgress.outstanding;
          consumeTargetMinor += dueProgress.outstanding;
        }
      }

      if (closableDues.length === 0 || consumeTargetMinor <= 0) {
        throw new HttpsError("failed-precondition", "NO_ELIGIBLE_DUES");
      }

      const sourceUpdates = new Map<string, { ref: admin.firestore.DocumentReference; nextAppliedMinor: number; nextUnappliedMinor: number; nextStatus: AllocationStatus }>();
      let remainingToConsume = consumeTargetMinor;
      for (const payment of creditPayments) {
        if (remainingToConsume <= 0) break;
        const unappliedMinor = safeMinor(payment.data.unappliedMinor);
        if (unappliedMinor <= 0) continue;
        const appliedMinor = safeMinor(payment.data.appliedMinor);
        const consume = Math.min(unappliedMinor, remainingToConsume);
        if (consume <= 0) continue;

        const nextAppliedMinor = appliedMinor + consume;
        const nextUnappliedMinor = unappliedMinor - consume;
        const nextStatus: AllocationStatus =
          nextUnappliedMinor === 0 ? "applied" : nextAppliedMinor > 0 ? "partial" : "unapplied";
        sourceUpdates.set(payment.id, {
          ref: payment.ref,
          nextAppliedMinor,
          nextUnappliedMinor,
          nextStatus
        });
        remainingToConsume -= consume;
      }

      if (remainingToConsume > 0) {
        throw new HttpsError("failed-precondition", "NO_ELIGIBLE_DUES");
      }

      let totalSettledMinor = 0;
      const settlementEntryIds: string[] = [];
      for (const due of closableDues) {
        const settlementEntryId = `autoSettle_${unitId}_${due.dueId}_${runId}`;
        settlementEntryIds.push(settlementEntryId);
        const settlementRef = db.doc(`managements/${managementId}/ledger/${settlementEntryId}`);
        const settlementDoc: LedgerDoc = {
          managementId,
          unitId,
          type: "CREDIT",
          amountMinor: due.dueOutstandingMinor,
          currency: "TRY",
          source: "auto_settlement",
          status: "posted",
          affectsBalance: false, // Explicitly internal
          description: `${String((due.due.periodMonth ?? 0) + 1).padStart(2, "0")}/${due.due.periodYear ?? "----"} Aidat Mahsup`,
          reference: "AUTO_CREDIT_SETTLEMENT",
          relatedDueId: due.dueId,
          appliedMinor: due.dueOutstandingMinor,
          unappliedMinor: 0,
          allocationStatus: "applied",
          idempotencyKey: settlementEntryId,
          createdBy: callerUid,
          metadata: {
            kind: "AUTO_CREDIT_SETTLEMENT",
            paymentMethod: "credit_balance",
            cashIn: false,
            unitId,
            dueId: due.dueId
          }
        };

        tx.set(settlementRef, {
          ...settlementDoc,
          createdAt: FieldValue.serverTimestamp()
        });

        const dueProgress = computeDueProgress(due.due);
        const nextDueAllocatedMinor = dueProgress.allocated + due.dueOutstandingMinor;
        const nextDueOutstandingMinor = 0;

        tx.update(due.dueRef, {
          dueTotalMinor: dueProgress.total,
          dueAllocatedMinor: nextDueAllocatedMinor,
          dueOutstandingMinor: nextDueOutstandingMinor,
          dueStatus: "paid",
          dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
          dueAggregateVersion: FieldValue.increment(1)
        });

        const dueAllocationId = `alloc_${settlementEntryId}_${due.dueId}`;
        const dueAllocationRef = db.doc(`managements/${managementId}/dueAllocations/${dueAllocationId}`);
        tx.set(dueAllocationRef, {
          managementId,
          unitId,
          dueId: due.dueId,
          paymentId: settlementEntryId,
          paymentEntryId: settlementEntryId,
          amountMinor: due.dueOutstandingMinor,
          status: "applied",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: callerUid,
          idempotencyKey: dueAllocationId
        } satisfies DueAllocationDoc);

        totalSettledMinor += due.dueOutstandingMinor;
      }

      for (const paymentUpdate of sourceUpdates.values()) {
        tx.update(paymentUpdate.ref, {
          appliedMinor: paymentUpdate.nextAppliedMinor,
          unappliedMinor: paymentUpdate.nextUnappliedMinor,
          allocationStatus: paymentUpdate.nextStatus
        });
      }

      const remainingCreditMinor = creditPayments.reduce((sum, p) => sum + safeMinor(p.data.unappliedMinor), 0) - totalSettledMinor;
      tx.set(auditRef, {
        action: "AUTO_CREDIT_SETTLEMENT",
        actorUid: callerUid,
        targetId: unitId,
        targetType: "unit",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          unitId,
          closedDueCount: closableDues.length,
          totalAmount: totalSettledMinor,
          remainingCreditMinor
        }
      });

      return {
        closedDueCount: closableDues.length,
        totalSettledMinor,
        remainingCreditMinor,
        settlementEntryIds
      };
    });

    // ── SaaS Idempotency: persist result for future replays ─────
    if (clientRequestId && result) {
      try {
        await db.doc(
          `managements/${managementId}/settleResults/${clientRequestId}`
        ).set({
          managementId,
          unitId,
          closedDueCount: result.closedDueCount,
          totalSettledMinor: result.totalSettledMinor,
          remainingCreditMinor: result.remainingCreditMinor,
          settlementEntryIds: result.settlementEntryIds ?? [],
          callerUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (persistErr) {
        // Fire-and-forget: transaction succeeded, result storage is best-effort
        console.error("⚠️ Failed to persist settleResult for idempotency:", persistErr);
      }
    }

    return result;
  }
);

/**
 * Allocates an existing posted payment to a due entry (server-side, transaction).
 * Deterministic relation: dueAllocations/alloc_{paymentEntryId}_{dueId}
 */
export const allocatePaymentToDue = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const paymentEntryId = request.data?.paymentEntryId;
    const dueId = request.data?.dueId;
    const amountMinorRaw = request.data?.amountMinor;

    if (!isValidId(managementId) || !isValidId(paymentEntryId) || !isValidId(dueId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }
    if (amountMinorRaw != null && !isPositiveInteger(amountMinorRaw)) {
      throw new HttpsError("invalid-argument", "INVALID_AMOUNT_MINOR");
    }

    const authz = await requireManagementPermission(request, managementId, "payment");
    const callerUid = authz.uid;

    const paymentRef = db.doc(`managements/${managementId}/ledger/${paymentEntryId}`);
    const dueRef = db.doc(`managements/${managementId}/ledger/${dueId}`);
    const auditRef = db.doc(`managements/${managementId}/auditLogs/alloc_${paymentEntryId}_${dueId}`);

    const result = await db.runTransaction(async (tx) => {
      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new HttpsError("not-found", "PAYMENT_NOT_FOUND");
      }
      const payment = paymentSnap.data() as LedgerDoc;
      if (payment.type !== "CREDIT" || payment.status !== "posted") {
        throw new HttpsError("failed-precondition", "PAYMENT_NOT_ALLOCATABLE");
      }
      if (payment.managementId !== managementId) {
        throw new HttpsError("permission-denied", "TENANT_BOUNDARY_VIOLATION");
      }
      if (!payment.unitId) {
        throw new HttpsError("failed-precondition", "PAYMENT_UNIT_REQUIRED");
      }

      const paymentProgressBefore = computePaymentProgress(payment);
      if (paymentProgressBefore.unapplied <= 0) {
        return {
          appliedMinor: 0,
          appliedTotalMinor: paymentProgressBefore.applied,
          unappliedMinor: paymentProgressBefore.unapplied,
          allocationStatus: paymentProgressBefore.status,
          noop: true as const
        };
      }

      const cap = amountMinorRaw != null
        ? Math.min(amountMinorRaw, paymentProgressBefore.unapplied)
        : paymentProgressBefore.unapplied;

      const appliedMinor = await allocateAmountToDue(tx, {
        managementId,
        unitId: payment.unitId,
        dueRef,
        dueId,
        paymentRef,
        paymentEntryId,
        paymentDoc: payment,
        actorUid: callerUid,
        amountToApplyMinor: cap
      });

      const paymentProgressAfter = computePaymentProgress(payment);

      tx.set(auditRef, {
        action: "PAYMENT_ALLOCATED",
        actorUid: callerUid,
        targetId: paymentEntryId,
        targetType: "ledgerEntry",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          dueId,
          appliedMinor,
          appliedTotalMinor: paymentProgressAfter.applied,
          unappliedMinor: paymentProgressAfter.unapplied,
          allocationStatus: paymentProgressAfter.status
        }
      });

      return {
        appliedMinor,
        appliedTotalMinor: paymentProgressAfter.applied,
        unappliedMinor: paymentProgressAfter.unapplied,
        allocationStatus: paymentProgressAfter.status,
        noop: appliedMinor <= 0
      };
    });

    return { ok: true, ...result, managementId, paymentEntryId, dueId };
  }
);

/**
 * Creates a DEBIT ledger entry (expense/adjustment/transfer style).
 * Doc ID is deterministic: expense_{idempotencyKey}
 */
export const createExpense = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const unitIdRaw = request.data?.unitId;
    const amountMinor = request.data?.amountMinor;
    const idempotencyKey = normalizeIdempotencyKey(request.data?.idempotencyKey);
    const source = normalizeOptionalString(request.data?.source, 64) ?? "manual";
    const reference = normalizeOptionalString(request.data?.reference, 512);
    const legacyDate = normalizeOptionalString(request.data?.legacyDate, 32);
    const legacyCategoryType = normalizeOptionalString(request.data?.legacyCategoryType, 32);
    const periodMonth = request.data?.periodMonth;
    const periodYear = request.data?.periodYear;

    if (!isValidId(managementId)) {
      throw new HttpsError("invalid-argument", "INVALID_MANAGEMENT_ID");
    }
    if (!isPositiveInteger(amountMinor)) {
      throw new HttpsError("invalid-argument", "INVALID_AMOUNT_MINOR");
    }
    if (!reference) {
      throw new HttpsError("invalid-argument", "REFERENCE_REQUIRED");
    }
    if (periodMonth != null && (!Number.isInteger(periodMonth) || periodMonth < 0 || periodMonth > 11)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_MONTH");
    }
    if (periodYear != null && (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 3000)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_YEAR");
    }

    let unitId: string | null = null;
    if (unitIdRaw != null && unitIdRaw !== "") {
      if (!isValidId(unitIdRaw)) {
        throw new HttpsError("invalid-argument", "INVALID_UNIT_ID");
      }
      unitId = unitIdRaw;
    }

    const authz = await requireManagementPermission(request, managementId, "expense");
    const callerUid = authz.uid;

    const entryId = `expense_${idempotencyKey}`;
    const entryRef = db.doc(`managements/${managementId}/ledger/${entryId}`);
    const unitRef = unitId ? db.doc(`managements/${managementId}/units/${unitId}`) : null;
    const auditRef = db.doc(`managements/${managementId}/auditLogs/expense_${idempotencyKey}`);

    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(entryRef);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as LedgerDoc;
        const existingAmount = Number(existing.amountMinor ?? 0);
        const existingUnitId = (existing.unitId as string | null) ?? null;
        if (existing.type !== "DEBIT" || existingAmount !== amountMinor || existingUnitId !== unitId) {
          throw new HttpsError("already-exists", "IDEMPOTENCY_KEY_CONFLICT");
        }
        return {
          created: false,
          entryId,
          managementId,
          unitId: existingUnitId,
          amountMinor: existingAmount,
          source: String(existing.source ?? source),
          reference: String(existing.reference ?? reference),
          status: String(existing.status ?? "posted")
        };
      }

      if (unitRef) {
        const unitSnap = await tx.get(unitRef);
        if (!unitSnap.exists) {
          throw new HttpsError("not-found", "UNIT_NOT_FOUND");
        }
      }

      tx.set(entryRef, {
        managementId,
        unitId,
        type: "DEBIT",
        source,
        status: "posted",
        affectsBalance: true,
        amountMinor,
        currency: "TRY",
        description: reference,
        reference,
        idempotencyKey,
        ...(legacyDate ? { legacyDate } : {}),
        ...(legacyCategoryType ? { legacyCategoryType } : {}),
        periodMonth: periodMonth ?? null,
        periodYear: periodYear ?? null,
        ...(source === "dues" && unitId
          ? {
            dueTotalMinor: amountMinor,
            dueAllocatedMinor: 0,
            dueOutstandingMinor: amountMinor,
            dueStatus: "open" as const,
            dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
            dueAggregateVersion: 1
          }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid
      });

      tx.set(auditRef, {
        action: "EXPENSE_CREATED",
        actorUid: callerUid,
        targetId: entryId,
        targetType: "ledgerEntry",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          unitId,
          amountMinor,
          source,
          reference,
          idempotencyKey,
          periodMonth: periodMonth ?? null,
          periodYear: periodYear ?? null
        }
      });

      return {
        created: true,
        entryId,
        managementId,
        unitId,
        amountMinor,
        source,
        reference,
        status: "posted"
      };
    });

    return { ok: true, ...result };
  }
);

/**
 * Creates an adjustment ledger entry for non-payment manual credits/debits.
 * Doc ID is deterministic: adjustment_{idempotencyKey}
 */
export const createAdjustment = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const entryType = request.data?.entryType;
    const unitIdRaw = request.data?.unitId;
    const amountMinor = request.data?.amountMinor;
    const idempotencyKey = normalizeIdempotencyKey(request.data?.idempotencyKey);
    const source = normalizeOptionalString(request.data?.source, 64) ?? "manual";
    const reference = normalizeOptionalString(request.data?.reference, 512);
    const legacyDate = normalizeOptionalString(request.data?.legacyDate, 32);
    const legacyCategoryType = normalizeOptionalString(request.data?.legacyCategoryType, 32);
    const periodMonth = request.data?.periodMonth;
    const periodYear = request.data?.periodYear;

    if (!isValidId(managementId)) {
      throw new HttpsError("invalid-argument", "INVALID_MANAGEMENT_ID");
    }
    if (entryType !== "CREDIT" && entryType !== "DEBIT") {
      throw new HttpsError("invalid-argument", "INVALID_ENTRY_TYPE");
    }
    if (!isPositiveInteger(amountMinor)) {
      throw new HttpsError("invalid-argument", "INVALID_AMOUNT_MINOR");
    }
    if (!reference) {
      throw new HttpsError("invalid-argument", "REFERENCE_REQUIRED");
    }
    if (periodMonth != null && (!Number.isInteger(periodMonth) || periodMonth < 0 || periodMonth > 11)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_MONTH");
    }
    if (periodYear != null && (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 3000)) {
      throw new HttpsError("invalid-argument", "INVALID_PERIOD_YEAR");
    }

    let unitId: string | null = null;
    if (unitIdRaw != null && unitIdRaw !== "") {
      if (!isValidId(unitIdRaw)) {
        throw new HttpsError("invalid-argument", "INVALID_UNIT_ID");
      }
      unitId = unitIdRaw;
    }

    const authz = await requireManagementPermission(request, managementId, "adjustment");
    const callerUid = authz.uid;

    const entryId = `adjustment_${idempotencyKey}`;
    const entryRef = db.doc(`managements/${managementId}/ledger/${entryId}`);
    const unitRef = unitId ? db.doc(`managements/${managementId}/units/${unitId}`) : null;
    const auditRef = db.doc(`managements/${managementId}/auditLogs/adjustment_${idempotencyKey}`);

    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(entryRef);
      if (existingSnap.exists) {
        const existing = existingSnap.data() as LedgerDoc;
        const existingAmount = Number(existing.amountMinor ?? 0);
        const existingUnitId = (existing.unitId as string | null) ?? null;
        if (existing.type !== entryType || existingAmount !== amountMinor || existingUnitId !== unitId) {
          throw new HttpsError("already-exists", "IDEMPOTENCY_KEY_CONFLICT");
        }
        return {
          created: false,
          entryId,
          managementId,
          unitId: existingUnitId,
          type: String(existing.type ?? entryType),
          amountMinor: existingAmount,
          source: String(existing.source ?? source),
          reference: String(existing.reference ?? reference),
          status: String(existing.status ?? "posted")
        };
      }

      if (unitRef) {
        const unitSnap = await tx.get(unitRef);
        if (!unitSnap.exists) {
          throw new HttpsError("not-found", "UNIT_NOT_FOUND");
        }
      }

      tx.set(entryRef, {
        managementId,
        unitId,
        type: entryType,
        source,
        status: "posted",
        amountMinor,
        currency: "TRY",
        description: reference,
        reference,
        idempotencyKey,
        ...(legacyDate ? { legacyDate } : {}),
        ...(legacyCategoryType ? { legacyCategoryType } : {}),
        periodMonth: periodMonth ?? null,
        periodYear: periodYear ?? null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid
      });

      tx.set(auditRef, {
        action: "ADJUSTMENT_CREATED",
        actorUid: callerUid,
        targetId: entryId,
        targetType: "ledgerEntry",
        managementId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          type: entryType,
          unitId,
          amountMinor,
          source,
          reference,
          idempotencyKey,
          periodMonth: periodMonth ?? null,
          periodYear: periodYear ?? null
        }
      });

      return {
        created: true,
        entryId,
        managementId,
        unitId,
        type: entryType,
        amountMinor,
        source,
        reference,
        status: "posted"
      };
    });

    return { ok: true, ...result };
  }
);

/**
 * Compatibility callable for non-payment legacy UI flows.
 * Client never writes ledger directly; all writes go through server transaction.
 */
export const createLegacyLedgerEntry = onCall(
  CALLABLE_OPTIONS,
  async () => {
    if (LEGACY_BRIDGE_DISABLED) {
      throw new HttpsError(
        "failed-precondition",
        "LEGACY_BRIDGE_DISABLED"
      );
    }
    throw new HttpsError("unimplemented", "LEGACY_BRIDGE_REMOVED");
  }
);

/**
 * Voids a posted ledger entry.
 * Callable: admin/owner only, App Check enforced.
 *
 * Client no longer mutates ledger status directly.
 * This function:
 *   1. Validates caller is admin/owner of the management
 *   2. Validates entry exists, is posted, and has no prior void/reverse
 *   3. Atomically sets status='voided' + voidReason/voidedAt/voidedBy
 *   4. Writes LEDGER_VOID audit log
 *
 * Input: { mgmtId, entryId, reason }
 */
export const voidLedgerEntry = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const entryId = request.data?.entryId;
    const reason = request.data?.reason;

    if (!isValidId(mgmtId) || !isValidId(entryId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new HttpsError("invalid-argument", "VOID_REASON_REQUIRED");
    }

    // Tenant boundary + role check
    const authz = await requireManagementPermission(request, mgmtId, "void");
    const callerUid = authz.uid;

    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);
    const auditRef = db.doc(`managements/${mgmtId}/auditLogs/void_${entryId}`);
    const trimmedReason = reason.trim();

    const result = await db.runTransaction(async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) {
        throw new HttpsError("not-found", "ENTRY_NOT_FOUND");
      }

      const entry = entrySnap.data() as LedgerDoc;

      // Idempotency: already voided → graceful no-op
      if (entry.status === "voided") {
        return { noop: true as const };
      }

      // Reversed entries cannot be voided — reverse is final
      if (entry.status === "reversed") {
        throw new HttpsError(
          "failed-precondition",
          "ENTRY_REVERSED: Cannot void a reversed entry. Reverse is a final state."
        );
      }

      // Only posted entries can be voided
      if (entry.status !== "posted") {
        throw new HttpsError(
          "failed-precondition",
          `ENTRY_NOT_POSTED: Current status is '${entry.status}'`
        );
      }
      if (isPaymentLedgerEntry(entry, entryId)) {
        throw new HttpsError("failed-precondition", "USE_REVERSE_PAYMENT_CALLABLE");
      }

      // Void the entry
      tx.update(entryRef, {
        status: "voided",
        voidReason: trimmedReason,
        voidedAt: FieldValue.serverTimestamp(),
        voidedBy: callerUid,
      });

      tx.set(auditRef, {
        action: "LEDGER_VOID",
        actorUid: callerUid,
        targetId: entryId,
        targetType: "ledgerEntry",
        managementId: mgmtId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          reason: trimmedReason
        }
      });

      return { noop: false as const };
    });

    // Idempotent: already voided, return success without re-logging
    if (result.noop) {
      console.log(
        `ℹ️ Entry already voided (no-op): mgmt=${mgmtId} entry=${entryId}`
      );
      return { ok: true, entryId, status: "voided", noop: true };
    }

    console.log(
      `🗑️ Voided ledger entry: mgmt=${mgmtId} entry=${entryId} by=${callerUid}`
    );

    return { ok: true, entryId, status: "voided" };
  }
);

/**
 * Reverses a posted ledger entry.
 * Callable: admin/owner only, App Check enforced.
 *
 * Client no longer mutates ledger status directly.
 * This function atomically:
 *   1. Validates caller is admin/owner of the management
 *   2. Validates entry exists, is posted, and has no prior void/reverse
 *   3. Creates a new reversal entry (opposite type, same amount, source='reversal')
 *   4. Sets original entry status='reversed' + reversedAt/reversedBy
 *   5. Writes LEDGER_REVERSE audit log
 *
 * The MANDATORY reversal invariant is enforced: reversed entry + reversal entry
 * are created atomically in the same transaction.
 *
 * Input: { mgmtId, entryId, reason? }
 */
export const reverseLedgerEntry = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const entryId = request.data?.entryId;
    const reason = normalizeOptionalString(request.data?.reason ?? "", 512) ?? "";

    if (!isValidId(mgmtId) || !isValidId(entryId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    // Tenant boundary + role check
    const authz = await requireManagementPermission(request, mgmtId, "reverse");
    const callerUid = authz.uid;

    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);
    const reversalEntryId = `reversal_${entryId}`;
    const reversalRef = db.doc(`managements/${mgmtId}/ledger/${reversalEntryId}`);
    const auditRef = db.doc(`managements/${mgmtId}/auditLogs/reverse_${entryId}`);

    const result = await db.runTransaction(async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) {
        throw new HttpsError("not-found", "ENTRY_NOT_FOUND");
      }

      const entry = entrySnap.data() as LedgerDoc;
      const reversalSnap = await tx.get(reversalRef);

      // Idempotency: already reversed → graceful no-op
      if (entry.status === "reversed") {
        const existingType = reversalSnap.exists
          ? ((reversalSnap.data() as LedgerDoc).type)
          : (entry.type === "DEBIT" ? "CREDIT" : "DEBIT");
        return {
          noop: true as const,
          reversalType: existingType
        };
      }

      // Voided entries cannot be reversed — void is a final state
      if (entry.status === "voided") {
        throw new HttpsError(
          "failed-precondition",
          "ENTRY_VOIDED: Cannot reverse a voided entry. Void is a final state."
        );
      }

      // Only posted entries can be reversed
      if (entry.status !== "posted") {
        throw new HttpsError(
          "failed-precondition",
          `ENTRY_NOT_POSTED: Current status is '${entry.status}'`
        );
      }
      if (isPaymentLedgerEntry(entry, entryId)) {
        throw new HttpsError("failed-precondition", "USE_REVERSE_PAYMENT_CALLABLE");
      }

      if (reversalSnap.exists) {
        throw new HttpsError("already-exists", "REVERSAL_ALREADY_EXISTS");
      }

      // Determine reversal type (opposite of original)
      const reversalType: LedgerType = entry.type === "DEBIT" ? "CREDIT" : "DEBIT";

      // 1. Mark original entry as reversed
      tx.update(entryRef, {
        status: "reversed",
        reversedAt: FieldValue.serverTimestamp(),
        reversedBy: callerUid,
      });

      // 2. Create reversal entry (MANDATORY reversal invariant)
      tx.set(reversalRef, {
        managementId: mgmtId,
        unitId: entry.unitId ?? null,
        type: reversalType,
        amountMinor: entry.amountMinor,
        currency: entry.currency ?? "TRY",
        source: "reversal",
        description: reason
          ? `Reversal: ${reason}`
          : `Reversal of ${entryId}`,
        status: "posted",
        reversalOf: entryId,
        idempotencyKey: `reversal_${entryId}`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });

      tx.set(auditRef, {
        action: "LEDGER_REVERSE",
        actorUid: callerUid,
        targetId: entryId,
        targetType: "ledgerEntry",
        managementId: mgmtId,
        at: FieldValue.serverTimestamp(),
        metadata: {
          reversalEntryId,
          reversalType,
          reason: reason || null
        }
      });

      return {
        noop: false as const,
        reversalType
      };
    });

    // Idempotent: already reversed, return success without re-logging
    if (result.noop) {
      console.log(
        `ℹ️ Entry already reversed (no-op): mgmt=${mgmtId} entry=${entryId}`
      );
      return {
        ok: true,
        originalEntryId: entryId,
        reversalEntryId,
        reversalType: result.reversalType,
        noop: true
      };
    }

    console.log(
      `🔄 Reversed ledger entry: mgmt=${mgmtId} original=${entryId} ` +
      `reversal=${reversalEntryId} type=${result.reversalType} by=${callerUid}`
    );

    return {
      ok: true,
      originalEntryId: entryId,
      reversalEntryId,
      reversalType: result.reversalType,
    };
  }
);

function timestampToMillis(value: unknown): number {
  if (value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

function dueAggregateHash(
  dueTotalMinor: number,
  allocatedMinor: number,
  outstandingMinor: number,
  status: DueStatus
): string {
  return `${dueTotalMinor}:${allocatedMinor}:${outstandingMinor}:${status}`;
}

async function checkDueDriftForManagement(managementId: string, sampleLimit: number) {
  let duesSnap: FirebaseFirestore.QuerySnapshot;
  try {
    duesSnap = await db
      .collection(`managements/${managementId}/ledger`)
      .where("source", "==", "dues")
      .orderBy("dueAggregationUpdatedAt", "desc")
      .limit(sampleLimit)
      .get();

    if (duesSnap.empty) {
      duesSnap = await db
        .collection(`managements/${managementId}/ledger`)
        .where("source", "==", "dues")
        .orderBy("createdAt", "desc")
        .limit(sampleLimit)
        .get();
    }
  } catch {
    const queryLimit = Math.max(sampleLimit * 8, 40);
    duesSnap = await db
      .collection(`managements/${managementId}/ledger`)
      .where("source", "==", "dues")
      .limit(queryLimit)
      .get();
  }

  if (duesSnap.empty) {
    return {
      managementId,
      checked: 0,
      drifted: 0,
      alertsWritten: 0,
      dueIds: [] as string[]
    };
  }

  const sampledDueDocs = duesSnap.docs
    .map((d) => {
      const raw = d.data() as Record<string, unknown>;
      const data = raw as unknown as LedgerDoc;
      const sortKey = Math.max(
        timestampToMillis(raw.dueAggregationUpdatedAt),
        timestampToMillis(raw.updatedAt),
        timestampToMillis(data.createdAt)
      );
      return { id: d.id, data, sortKey };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, sampleLimit);

  let drifted = 0;
  let alertsWritten = 0;
  const dueIds: string[] = [];

  for (const due of sampledDueDocs) {
    try {
      const canonical = await computeCanonicalDueAggregates(managementId, due.id);
      const cachedAllocatedMinor = toInt(due.data.dueAllocatedMinor, 0);
      const cachedOutstandingMinor = toInt(
        due.data.dueOutstandingMinor,
        canonical.dueTotalMinor - cachedAllocatedMinor
      );
      const cachedStatus: DueStatus =
        due.data.dueStatus === "paid" || due.data.dueStatus === "open"
          ? due.data.dueStatus
          : cachedOutstandingMinor > 0
            ? "open"
            : "paid";

      const isDrift =
        cachedAllocatedMinor !== canonical.allocatedMinor ||
        cachedOutstandingMinor !== canonical.outstandingMinor ||
        cachedStatus !== canonical.status;

      if (!isDrift) continue;

      drifted += 1;
      dueIds.push(due.id);

      const diffAllocatedMinor = canonical.allocatedMinor - cachedAllocatedMinor;
      const diffOutstandingMinor = canonical.outstandingMinor - cachedOutstandingMinor;
      const alertRef = db.doc(`managements/${managementId}/dueDriftAlerts/${due.id}`);
      const canonicalHash = dueAggregateHash(
        canonical.dueTotalMinor,
        canonical.allocatedMinor,
        canonical.outstandingMinor,
        canonical.status
      );
      const cachedHash = dueAggregateHash(
        canonical.dueTotalMinor,
        cachedAllocatedMinor,
        cachedOutstandingMinor,
        cachedStatus
      );
      const diffHash = `${diffAllocatedMinor}:${diffOutstandingMinor}`;

      await alertRef.set(
        {
          managementId,
          dueId: due.id,
          status: "open",
          severity: "critical",
          resolvedAt: null,
          resolvedBy: null,
          canonical: {
            dueTotalMinor: canonical.dueTotalMinor,
            allocatedMinor: canonical.allocatedMinor,
            outstandingMinor: canonical.outstandingMinor,
            status: canonical.status
          },
          cached: {
            dueTotalMinor: canonical.dueTotalMinor,
            allocatedMinor: cachedAllocatedMinor,
            outstandingMinor: cachedOutstandingMinor,
            status: cachedStatus
          },
          diff: {
            allocatedMinor: diffAllocatedMinor,
            outstandingMinor: diffOutstandingMinor
          },
          canonicalHash,
          cachedHash,
          diffHash,
          driftCount: FieldValue.increment(1),
          lastDetectedAt: FieldValue.serverTimestamp(),
          detectedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      alertsWritten += 1;

      console.error(
        `🚨 DUE_DRIFT_DETECTED mgmt=${managementId} due=${due.id} ` +
        `allocDiff=${diffAllocatedMinor} outDiff=${diffOutstandingMinor}`
      );
    } catch (err) {
      console.error(`❌ Due drift check failed: mgmt=${managementId} due=${due.id}`, err);
    }
  }

  return {
    managementId,
    checked: sampledDueDocs.length,
    drifted,
    alertsWritten,
    dueIds
  };
}

/**
 * Daily due aggregate drift check.
 * Compares materialized due fields with canonical allocation sum.
 */
export const checkDueAggregateDrift = onSchedule("every day 04:00", async () => {
  const mgmtsSnap = await db.collection("managements").get();
  let totalChecked = 0;
  let totalDrifted = 0;
  let totalAlerts = 0;

  for (const mgmtDoc of mgmtsSnap.docs) {
    const mgmtData = mgmtDoc.data();
    if (mgmtData?.status === "archived") continue;
    try {
      const result = await checkDueDriftForManagement(mgmtDoc.id, 5);
      totalChecked += result.checked;
      totalDrifted += result.drifted;
      totalAlerts += result.alertsWritten;
    } catch (err) {
      console.error(`❌ Due drift job failed for mgmt=${mgmtDoc.id}`, err);
    }
  }

  console.log(
    `🏁 checkDueAggregateDrift completed checked=${totalChecked} drifted=${totalDrifted} alerts=${totalAlerts}`
  );
});

/**
 * Manual due drift check for one management (admin/owner only).
 */
export const checkDueDrift = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const rawSampleLimit = Number(request.data?.sampleLimit ?? 5);
    const sampleLimit = Number.isInteger(rawSampleLimit)
      ? Math.max(1, Math.min(20, rawSampleLimit))
      : 5;

    if (!isValidId(managementId)) {
      throw new HttpsError("invalid-argument", "INVALID_MANAGEMENT_ID");
    }

    await requireManagementPermission(request, managementId, "admin_ops");
    const result = await checkDueDriftForManagement(managementId, sampleLimit);
    return { ok: true, ...result };
  }
);

/**
 * Rebuilds due aggregate fields from canonical dueAllocations sum.
 * Admin/owner only.
 */
export const rebuildDueAggregates = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const dueId = request.data?.dueId;
    if (!isValidId(managementId) || !isValidId(dueId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    const authz = await requireManagementPermission(request, managementId, "admin_ops");
    const callerUid = authz.uid;
    const alertRef = db.doc(`managements/${managementId}/dueDriftAlerts/${dueId}`);
    const auditRef = db.doc(`managements/${managementId}/auditLogs/dueRebuild_${dueId}`);

    const rebuilt = await db.runTransaction(async (tx) => {
      const canonical = await computeCanonicalDueAggregates(managementId, dueId, tx);
      const dueSnap = await tx.get(canonical.dueRef);
      if (!dueSnap.exists) {
        throw new HttpsError("not-found", "DUE_NOT_FOUND");
      }
      const due = dueSnap.data() as LedgerDoc;
      const cachedAllocatedMinor = toInt(due.dueAllocatedMinor, 0);
      const cachedOutstandingMinor = toInt(
        due.dueOutstandingMinor,
        canonical.dueTotalMinor - cachedAllocatedMinor
      );
      const cachedStatus: DueStatus =
        due.dueStatus === "paid" || due.dueStatus === "open"
          ? due.dueStatus
          : cachedOutstandingMinor > 0
            ? "open"
            : "paid";

      const isNoop =
        cachedAllocatedMinor === canonical.allocatedMinor &&
        cachedOutstandingMinor === canonical.outstandingMinor &&
        cachedStatus === canonical.status;

      const alertSnap = await tx.get(alertRef);
      const hasOpenAlert = alertSnap.exists && alertSnap.data()?.status === "open";
      if (hasOpenAlert) {
        tx.set(
          alertRef,
          {
            status: "resolved",
            resolvedAt: FieldValue.serverTimestamp(),
            resolvedBy: callerUid,
            resolution: "MANUAL_REBUILD",
            rebuiltNoop: isNoop,
            canonical: {
              dueTotalMinor: canonical.dueTotalMinor,
              allocatedMinor: canonical.allocatedMinor,
              outstandingMinor: canonical.outstandingMinor,
              status: canonical.status
            },
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      if (!isNoop) {
        tx.update(canonical.dueRef, {
          dueTotalMinor: canonical.dueTotalMinor,
          dueAllocatedMinor: canonical.allocatedMinor,
          dueOutstandingMinor: canonical.outstandingMinor,
          dueStatus: canonical.status,
          dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
          dueAggregateVersion: FieldValue.increment(1)
        });
      }

      if (!isNoop || hasOpenAlert) {
        tx.set(
          auditRef,
          {
            action: "DUE_AGGREGATES_REBUILT",
            actorUid: callerUid,
            targetId: dueId,
            targetType: "ledgerEntry",
            managementId,
            at: FieldValue.serverTimestamp(),
            metadata: {
              dueTotalMinor: canonical.dueTotalMinor,
              dueAllocatedMinor: canonical.allocatedMinor,
              dueOutstandingMinor: canonical.outstandingMinor,
              dueStatus: canonical.status,
              noop: isNoop,
              alertResolved: hasOpenAlert
            }
          },
          { merge: true }
        );
      }

      return {
        dueTotalMinor: canonical.dueTotalMinor,
        dueAllocatedMinor: canonical.allocatedMinor,
        dueOutstandingMinor: canonical.outstandingMinor,
        dueStatus: canonical.status,
        alertResolved: hasOpenAlert,
        noop: isNoop
      };
    });

    return {
      ok: true,
      managementId,
      dueId,
      ...rebuilt
    };
  }
);

/**
 * One-time legacy cleanup callable.
 * Migrates managements/{mgmtId}/transactions -> managements/{mgmtId}/ledger
 * and physically deletes legacy transactions docs.
 */
export const cleanupLegacyTransactions = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    if (!IS_FUNCTIONS_EMULATOR && !ENABLE_DESTRUCTIVE_CALLABLES) {
      throw new HttpsError("failed-precondition", "DESTRUCTIVE_CALLABLE_DISABLED");
    }

    const mgmtId = request.data?.mgmtId;
    const mode = request.data?.mode === "delete_only" ? "delete_only" : "migrate_and_delete";
    const requestedBatchSize = Number(request.data?.batchSize ?? 300);
    const batchSize = Number.isInteger(requestedBatchSize)
      ? Math.max(1, Math.min(400, requestedBatchSize))
      : 300;

    if (!isValidId(mgmtId)) {
      throw new HttpsError("invalid-argument", "INVALID_MGMT_ID");
    }

    const authz = await requireManagementPermission(request, mgmtId, "admin_ops");
    const actorUid = authz.uid;

    let migrated = 0;
    let deleted = 0;

    while (true) {
      const snap = await db
        .collection(`managements/${mgmtId}/transactions`)
        .limit(batchSize)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      for (const txDoc of snap.docs) {
        const txData = txDoc.data() as Record<string, unknown>;
        if (mode === "migrate_and_delete") {
          const direction = txData.direction === "CREDIT" || txData.type === "GELİR" ? "CREDIT" : "DEBIT";
          const amountMinorRaw = typeof txData.amountMinor === "number"
            ? txData.amountMinor
            : Math.round(Number(txData.amount ?? 0) * 100);
          const amountMinor = Number.isInteger(amountMinorRaw) && amountMinorRaw > 0 ? amountMinorRaw : 0;
          if (amountMinor > 0) {
            const ledgerEntryId = `legacytx_${txDoc.id}`;
            const ledgerRef = db.doc(`managements/${mgmtId}/ledger/${ledgerEntryId}`);
            const auditRef = db.doc(`managements/${mgmtId}/auditLogs/legacy_cleanup_${txDoc.id}`);
            batch.set(ledgerRef, {
              managementId: mgmtId,
              unitId: typeof txData.unitId === "string" ? txData.unitId : null,
              type: direction,
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
              createdBy: actorUid
            }, { merge: true });
            batch.set(auditRef, {
              action: "LEGACY_TX_MIGRATED",
              actorUid,
              targetId: ledgerEntryId,
              targetType: "ledgerEntry",
              managementId: mgmtId,
              at: FieldValue.serverTimestamp(),
              metadata: {
                legacyTransactionId: txDoc.id
              }
            }, { merge: true });
            migrated++;
          }
        }
        batch.delete(txDoc.ref);
        deleted++;
      }
      await batch.commit();
    }

    return { ok: true, mgmtId, mode, migrated, deleted };
  }
);

// ─── Dues Engine Types ──────────────────────────────────────────────

interface DuesSettings {
  enabled: boolean;
  monthlyFeeMinor: number;
  currency?: string;
  dueDay?: number;
  timezone?: string;
  exemptUnitIds?: string[];
}

// ─── Dues Engine Helpers ────────────────────────────────────────────



async function processManagementDues(
  mgmtId: string,
  yearMonth: string,
  dryRun: boolean,
  context: { uid?: string; isAuto?: boolean }
) {
  // 1. Read settings
  const settingsSnap = await db.doc(`managements/${mgmtId}/settings/dues`).get();
  if (!settingsSnap.exists) {
    return { error: "SETTINGS_NOT_FOUND", mgmtId };
  }
  const settings = settingsSnap.data() as DuesSettings;

  if (!settings.enabled && context.isAuto) {
    return { skipped: true, reason: "DISABLED", mgmtId };
  }

  const feeMinor = settings.monthlyFeeMinor;
  const currency = settings.currency || "TRY";
  const exempt = new Set(settings.exemptUnitIds || []);

  // 2. List all units
  const unitsSnap = await db.collection(`managements/${mgmtId}/units`).get();

  let processed = 0;
  let exempted = 0;
  let failed = 0;
  let alreadyDone = 0;
  // TODO: Remove failedDetails before production release
  const failedDetails: { unitId: string; error: string }[] = [];

  console.log(
    `🔄 Processing dues for mgmt=${mgmtId} ym=${yearMonth} units=${unitsSnap.size} dryRun=${dryRun}`
  );

  for (const unitDoc of unitsSnap.docs) {
    const unitId = unitDoc.id;

    // Check exemption
    if (exempt.has(unitId)) {
      exempted++;
      continue;
    }

    if (dryRun) {
      processed++;
      continue;
    }

    // Registry Key: duesRuns/{yearMonth}/units/{unitId}
    const runRef = db.doc(
      `managements/${mgmtId}/duesRuns/${yearMonth}/units/${unitId}`
    );

    try {
      await db.runTransaction(async (tx) => {
        const runSnap = await tx.get(runRef);
        if (runSnap.exists) {
          throw new Error("ALREADY_PROCESSED");
        }

        // Create Ledger Entry
        const entryRef = db.collection(`managements/${mgmtId}/ledger`).doc();
        const entryId = entryRef.id;
        const auditRef = db.doc(`managements/${mgmtId}/auditLogs/dues_${yearMonth}_${unitId}`);

        tx.set(entryRef, {
          managementId: mgmtId,
          unitId,
          type: "DEBIT",
          amountMinor: feeMinor,
          currency,
          source: "dues",
          description: `${yearMonth} Aidat Tahakkuku`,
          status: "posted",
          dueTotalMinor: feeMinor,
          dueAllocatedMinor: 0,
          dueOutstandingMinor: feeMinor,
          dueStatus: "open",
          dueAggregationUpdatedAt: FieldValue.serverTimestamp(),
          dueAggregateVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid || "system",
          metadata: {
            kind: "DUES",
            yearMonth,
          },
        });

        // Create Registry Record (Idempotency)
        tx.set(runRef, {
          status: "created",
          ledgerEntryId: entryId,
          createdAt: FieldValue.serverTimestamp(),
          feeMinor,
        });

        tx.set(auditRef, {
          action: "DUES_GENERATED",
          actorUid: context.uid || "system",
          targetId: entryId,
          targetType: "ledgerEntry",
          managementId: mgmtId,
          at: FieldValue.serverTimestamp(),
          metadata: {
            unitId,
            yearMonth,
            amountMinor: feeMinor,
            currency
          }
        });
      });

      processed++;
    } catch (err: any) {
      if (err.message === "ALREADY_PROCESSED") {
        alreadyDone++;
      } else {
        console.error(`❌ Dues processing failed for unit ${unitId}:`, err?.message, err?.stack);
        failed++;
        // TODO: Remove debug field before production release
        failedDetails.push({ unitId, error: err?.message ?? String(err) });
      }
    }
  }

  return { processed, exempted, failed, alreadyDone, feeMinor, currency, failedDetails };
}

// ─── Cloud Functions: Dues Engine ───────────────────────────────────

/**
 * Scheduled monthly job to generate dues.
 * Runs at 00:10 on the 1st day of every month (London time).
 */
export const generateMonthlyDues = onSchedule(
  {
    schedule: "1 of month 00:10",
    timeZone: "Europe/London",
    timeoutSeconds: 540, // 9 mins
  },
  async (event) => {
    // 1. Calculate target yearMonth (current month)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const yearMonth = `${year}-${month}`;

    console.log(`⏳ Starting global monthly dues generation for ${yearMonth}`);

    // 2. Scan all managements
    const mgmtsSnap = await db.collection("managements").get();

    for (const mgmtDoc of mgmtsSnap.docs) {
      const mgmtData = mgmtDoc.data();
      // Skip archived managements
      if (mgmtData.status === "archived") continue;

      try {
        const result = await processManagementDues(
          mgmtDoc.id,
          yearMonth,
          false,
          { isAuto: true }
        );
        console.log(`✅ Processed mgmt=${mgmtDoc.id}:`, result);
      } catch (err) {
        console.error(`💥 Failed to process mgmt=${mgmtDoc.id}`, err);
      }
    }

    console.log("🏁 Global dues generation completed.");
  }
);

/**
 * Manually trigger dues generation for a specific month (Backfill).
 * Admin/Owner only.
 */
export const runMonthlyDues = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const { mgmtId, yearMonth, dryRun } = request.data;

    if (!isValidId(mgmtId)) {
      throw new HttpsError("invalid-argument", "INVALID_MGMT_ID");
    }
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new HttpsError("invalid-argument", "INVALID_YEAR_MONTH (YYYY-MM)");
    }

    // Auth + role check (handles unauthenticated case internally)
    const authz = await requireManagementPermission(request, mgmtId, "dues_run");
    const callerUid = authz.uid;

    // Run logic
    const result = await processManagementDues(
      mgmtId,
      yearMonth,
      !!dryRun,
      { uid: callerUid, isAuto: false }
    );

    return result;
  }
);

// ─── Financial Reporting (Explicit cashIn Filter) ───────────────────

/**
 * Generates a financial report for a management unit or the entire tenant.
 * Uses EXPLICIT `metadata.cashIn === true` filter for actual cash receipts.
 *
 * The system marks every ledger entry with `metadata.cashIn`:
 *   - `true`  → real money entered the system (cash, bank, stripe)
 *   - `false` → internal accounting entry (credit_balance settlement)
 *
 * This is the ONLY reliable way to compute cash flow.
 * NEVER use `paymentMethod !== "credit_balance"` — that is a weak filter.
 *
 * Returns:
 *   - totalCashInMinor:  sum of entries where cashIn === true
 *   - totalDebitMinor:   sum of all posted DEBIT entries
 *   - totalCreditMinor:  sum of all posted CREDIT entries
 *   - netBalanceMinor:   totalCreditMinor - totalDebitMinor
 *   - settlementMinor:   sum of auto_settlement (internal, cashIn === false)
 *   - entryCount:        total posted entries
 *
 * Input: { managementId, unitId? }
 */
export const getFinancialReport = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const unitId = request.data?.unitId;

    if (!isValidId(managementId)) {
      throw new HttpsError("invalid-argument", "INVALID_MANAGEMENT_ID");
    }

    await requireManagementPermission(request, managementId, "payment");

    // Query ledger — optionally filtered by unit
    let query: admin.firestore.Query = db.collection(`managements/${managementId}/ledger`);
    if (unitId && isValidId(unitId)) {
      query = query.where("unitId", "==", unitId);
    }

    const snapshot = await query.get();

    let totalCashInMinor = 0;      // Actual money received (cashIn === true)
    let totalSettlementMinor = 0;  // Internal credit settlements (cashIn === false)
    let totalDebitMinor = 0;       // All posted debits
    let totalCreditMinor = 0;      // All posted credits
    let entryCount = 0;

    // Per-method breakdown for cash-in
    const cashInByMethod: Record<string, number> = {};

    for (const doc of snapshot.docs) {
      const entry = doc.data() as LedgerDoc;

      // Only posted entries matter
      if (entry.status !== "posted") continue;
      entryCount++;

      if (entry.type === "DEBIT") {
        totalDebitMinor += entry.amountMinor;
      } else if (entry.type === "CREDIT") {
        // EXPLICIT cashIn filter
        const meta = entry.metadata as Record<string, unknown> | undefined;
        if (meta?.cashIn === true) {
          totalCashInMinor += entry.amountMinor;
          const method = String(meta.paymentMethod ?? entry.source ?? "unknown");
          cashInByMethod[method] = (cashInByMethod[method] ?? 0) + entry.amountMinor;
        } else if (entry.source === "auto_settlement") {
          totalSettlementMinor += entry.amountMinor;
        }

        // Exclude internal settlements via affectsBalance flag
        const affectsBalance = entry.affectsBalance ?? (entry.source !== "auto_settlement");
        if (affectsBalance) {
          totalCreditMinor += entry.amountMinor;
        }
      }
    }

    const netBalanceMinor = totalCreditMinor - totalDebitMinor;

    return {
      managementId,
      unitId: unitId ?? null,
      totalCashInMinor,
      totalSettlementMinor,
      // UI: settlement is NOT income — it's an internal credit reallocation.
      // Display as "Dahili Mahsup" / "Internal Transfer" in reports.
      settlementLabel: "INTERNAL_TRANSFER" as const,
      totalDebitMinor,
      totalCreditMinor,
      netBalanceMinor,
      entryCount,
      cashInByMethod,
    };
  }
);

// ─── Audit Replay (Prod — Windowed + Full) ──────────────────────────

/**
 * Production-grade audit replay for a single unit.
 *
 * Recomputes aggregate convenience fields from immutable sources
 * (dueAllocations + ledger) and compares with stored values.
 *
 * Two modes:
 *   - mode="window" (default): checks only dues/payments updated in last windowDays
 *   - mode="full": checks ALL entries (admin only, higher cost)
 *
 * On mismatch: creates DUE_AGGREGATE_DRIFT alert.
 * Returns: list of drifts found + overall ok status.
 *
 * Input: { managementId, unitId, mode?, windowDays? }
 */
export const auditReplayUnit = onCall(
  CALLABLE_OPTIONS,
  async (request) => {
    const managementId = request.data?.managementId;
    const unitId = request.data?.unitId;
    const mode = request.data?.mode === "full" ? "full" : "window";
    const windowDays = Number(request.data?.windowDays ?? 7);

    if (!isValidId(managementId) || !isValidId(unitId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }
    if (windowDays < 1 || windowDays > 365) {
      throw new HttpsError("invalid-argument", "WINDOW_DAYS_OUT_OF_RANGE");
    }

    const authz = await requireManagementPermission(request, managementId, "payment");
    const callerUid = authz.uid;

    // ── Identify entries to scan ────────────────────────────────
    let entryIds = new Set<string>();

    if (mode === "window") {
      const windowStart = new Date(Date.now() - windowDays * 86400000);

      // 1. Recently created/updated ledger entries (matches new dues/payments)
      // Ideal: query "updatedAt" if available. Fallback: "createdAt" covers new items.
      const ledgerTimeSnap = await db
        .collection(`managements/${managementId}/ledger`)
        .where("unitId", "==", unitId)
        .where("createdAt", ">=", windowStart)
        .get();
      ledgerTimeSnap.docs.forEach((d) => entryIds.add(d.id));

      // 2. Entries affected by recent allocations (Fixes "blind spot" for updates)
      // Any payment allocation or due closure creates a dueAllocation doc.
      // We query these by time to find OLD entries that were RECENTLY updated.
      const allocSnap = await db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("createdAt", ">=", windowStart)
        .get();

      allocSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.dueId) entryIds.add(data.dueId);
        if (data.paymentEntryId) entryIds.add(data.paymentEntryId);
        if (data.paymentId) entryIds.add(data.paymentId); // legacy
      });
    }

    // ── Fetch actual data ──────────────────────────────────────
    let entries: Array<{ id: string; data: LedgerDoc }> = [];

    // Full mode OR scanning specific IDs from window analysis
    if (mode === "full") {
      const snap = await db
        .collection(`managements/${managementId}/ledger`)
        .where("unitId", "==", unitId)
        .get();
      entries = snap.docs.map((d) => ({ id: d.id, data: d.data() as LedgerDoc }));
    } else {
      // Fetch only the identified entries
      // (Note: In a massive scale system, perform batched gets. For unit-level audit, loop is fine)
      const ids = Array.from(entryIds);
      if (ids.length > 0) {
        const refs = ids.map(id => db.doc(`managements/${managementId}/ledger/${id}`));
        // Using getAll for efficiency (batch limit 10 usually works fine here, else chunk)
        // Safety: chunk it by 10 to be safe
        for (let i = 0; i < refs.length; i += 10) {
          const chunk = refs.slice(i, i + 10);
          const snaps = await db.getAll(...chunk);
          snaps.forEach(s => {
            if (s.exists) {
              const d = s.data() as LedgerDoc;
              // Strict security: ensure belongs to this unit (allocations might theoretically cross if expanded)
              if (d.unitId === unitId) {
                entries.push({ id: s.id, data: d });
              }
            }
          });
        }
      }
    }

    const drifts: Array<{
      entryId: string;
      type: "due" | "payment" | "balance";
      field: string;
      stored: number | string;
      canonical: number | string;
    }> = [];

    // ── Replay due aggregates ───────────────────────────────────
    const dueEntries = entries.filter(
      (e) =>
        e.data.type === "DEBIT" &&
        e.data.status === "posted" &&
        (e.data.source === "dues" || e.id.startsWith("expense_"))
    );

    for (const due of dueEntries) {
      const storedTotal = safeMinor(due.data.dueTotalMinor ?? due.data.amountMinor);
      const storedAllocated = safeMinor(due.data.dueAllocatedMinor);
      const storedOutstanding = safeMinor(due.data.dueOutstandingMinor ?? storedTotal);
      const storedStatus = due.data.dueStatus ?? "open";

      // Canonical: sum allocations from dueAllocations
      const allocSnap = await db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("dueId", "==", due.id)
        .get();

      let canonicalAllocated = 0;
      for (const allocDoc of allocSnap.docs) {
        canonicalAllocated += toInt(allocDoc.data().amountMinor, 0);
      }

      const canonicalOutstanding = Math.max(storedTotal - canonicalAllocated, 0);
      const canonicalStatus = canonicalOutstanding > 0 ? "open" : "paid";

      if (canonicalAllocated !== storedAllocated) {
        drifts.push({
          entryId: due.id,
          type: "due",
          field: "dueAllocatedMinor",
          stored: storedAllocated,
          canonical: canonicalAllocated,
        });
      }
      if (canonicalOutstanding !== storedOutstanding) {
        drifts.push({
          entryId: due.id,
          type: "due",
          field: "dueOutstandingMinor",
          stored: storedOutstanding,
          canonical: canonicalOutstanding,
        });
      }
      if (canonicalStatus !== storedStatus) {
        drifts.push({
          entryId: due.id,
          type: "due",
          field: "dueStatus",
          stored: storedStatus,
          canonical: canonicalStatus,
        });
      }
    }

    // ── Replay payment aggregates ───────────────────────────────
    const paymentEntries = entries.filter(
      (e) =>
        e.data.type === "CREDIT" &&
        e.data.status === "posted" &&
        e.id.startsWith("payment_")
    );

    for (const pay of paymentEntries) {
      const paymentTotal = safeMinor(pay.data.amountMinor);
      const storedApplied = safeMinor(pay.data.appliedMinor);
      const storedUnapplied = safeMinor(pay.data.unappliedMinor ?? paymentTotal);

      // Canonical: sum allocations where this payment is the source
      const allocSnap1 = await db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("paymentEntryId", "==", pay.id)
        .get();
      const allocSnap2 = await db
        .collection(`managements/${managementId}/dueAllocations`)
        .where("paymentId", "==", pay.id)
        .get();

      const seen = new Set<string>();
      let canonicalApplied = 0;
      for (const d of allocSnap1.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        canonicalApplied += toInt(d.data().amountMinor, 0);
      }
      for (const d of allocSnap2.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        canonicalApplied += toInt(d.data().amountMinor, 0);
      }

      const canonicalUnapplied = Math.max(paymentTotal - canonicalApplied, 0);

      if (canonicalApplied !== storedApplied) {
        drifts.push({
          entryId: pay.id,
          type: "payment",
          field: "appliedMinor",
          stored: storedApplied,
          canonical: canonicalApplied,
        });
      }
      if (canonicalUnapplied !== storedUnapplied) {
        drifts.push({
          entryId: pay.id,
          type: "payment",
          field: "unappliedMinor",
          stored: storedUnapplied,
          canonical: canonicalUnapplied,
        });
      }
    }

    // ── Replay balance cache (full mode only) ───────────────────
    if (mode === "full") {
      const canonical = await computeCanonicalBalance(managementId, unitId);
      const balSnap = await db
        .doc(`managements/${managementId}/unitBalances/${unitId}`)
        .get();

      if (balSnap.exists) {
        const cached = balSnap.data() as Record<string, unknown>;
        const cachedBalance = Number(cached?.balanceMinor ?? 0);
        if (canonical.balanceMinor !== cachedBalance) {
          drifts.push({
            entryId: unitId,
            type: "balance",
            field: "balanceMinor",
            stored: cachedBalance,
            canonical: canonical.balanceMinor,
          });
        }
      }
    }

    // ── Write alerts for detected drifts ────────────────────────
    if (drifts.length > 0) {
      const alertRef = db.collection(`managements/${managementId}/alerts`).doc();
      await alertRef.set({
        type: "AUDIT_REPLAY_DRIFT",
        managementId,
        unitId,
        mode,
        driftCount: drifts.length,
        drifts,
        status: "open",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });

      await writeAuditLog(managementId, "AUDIT_REPLAY_DRIFT", callerUid, unitId, "unit", {
        mode,
        driftCount: drifts.length,
        alertId: alertRef.id,
      });
    }

    return {
      ok: drifts.length === 0,
      managementId,
      unitId,
      mode,
      windowDays: mode === "window" ? windowDays : null,
      entriesScanned: entries.length,
      driftCount: drifts.length,
      drifts,
    };
  }
);

// ─── TTL Cleanup: settleResults (7-day retention) ───────────────────

/**
 * Cleans up settleResults older than SETTLE_RESULT_TTL_DAYS.
 * Runs daily at 05:00. Prevents unbounded growth of idempotency docs.
 */
const SETTLE_RESULT_TTL_DAYS = 7;

export const cleanupSettleResults = onSchedule("every day 05:00", async () => {
  const cutoff = new Date(Date.now() - SETTLE_RESULT_TTL_DAYS * 86400000);

  const mgmtSnap = await db.collection("managements").get();
  let totalDeleted = 0;

  for (const mgmtDoc of mgmtSnap.docs) {
    const mgmtId = mgmtDoc.id;
    const expiredSnap = await db
      .collection(`managements/${mgmtId}/settleResults`)
      .where("createdAt", "<", cutoff)
      .limit(500) // batch limit to avoid timeout
      .get();

    if (expiredSnap.empty) continue;

    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += expiredSnap.size;
  }

  console.log(`🧹 cleanupSettleResults: deleted ${totalDeleted} expired docs (TTL=${SETTLE_RESULT_TTL_DAYS}d)`);
});
