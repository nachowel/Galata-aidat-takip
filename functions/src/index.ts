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

type InviteStatus = "active" | "used" | "revoked";

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
  { enforceAppCheck: true },
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
  { enforceAppCheck: true },
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

interface LedgerDoc {
  unitId?: string | null;
  type: LedgerType;
  amountMinor: number;
  currency?: string;
  source?: string;
  description?: string;
  status: LedgerStatusValue;
  createdAt?: Timestamp | number | null;
  createdBy?: string;
  reversalOf?: string | null;
  voidReason?: string | null;
  voidedAt?: Timestamp | null;
  voidedBy?: string | null;
  reversedAt?: Timestamp | null;
  reversedBy?: string | null;
  balanceAppliedAt?: Timestamp | null;
  balanceAppliedVersion?: number | null;
  balanceRevertedAt?: Timestamp | null;
  balanceRevertedVersion?: number | null;
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
        const delta = isDebit ? -entry.amountMinor : entry.amountMinor;

        if (balSnap.exists) {
          tx.update(balRef, {
            balanceMinor: FieldValue.increment(delta),
            postedDebitMinor: FieldValue.increment(isDebit ? entry.amountMinor : 0),
            postedCreditMinor: FieldValue.increment(isDebit ? 0 : entry.amountMinor),
            lastLedgerEventAt: now,
            lastAppliedEntryId: entryId,
            updatedAt: now,
          });
        } else {
          tx.set(balRef, {
            unitId: entry.unitId,
            balanceMinor: delta,
            postedDebitMinor: isDebit ? entry.amountMinor : 0,
            postedCreditMinor: isDebit ? 0 : entry.amountMinor,
            lastLedgerEventAt: now,
            lastAppliedEntryId: entryId,
            updatedAt: now,
            version: 1,
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
        // Reverse the original delta
        const reverseDelta = isDebit ? beforeData.amountMinor : -beforeData.amountMinor;

        tx.update(balRef, {
          balanceMinor: FieldValue.increment(reverseDelta),
          postedDebitMinor: FieldValue.increment(isDebit ? -beforeData.amountMinor : 0),
          postedCreditMinor: FieldValue.increment(isDebit ? 0 : -beforeData.amountMinor),
          lastLedgerEventAt: now,
          lastAppliedEntryId: entryId,
          updatedAt: now,
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

/**
 * Verifies caller is admin/owner of the given management.
 * Reusable across rebuild, void, reverse, runMonthlyDues functions.
 *
 * Admin is granted if ANY of the following is true:
 *   1. request.auth.token.admin === true   (custom claim)
 *   2. request.auth.token.role === "admin"  (custom claim)
 *   3. request.auth.uid === management.ownerUid
 *   4. Firestore users/{uid} role === "admin" AND member of management
 *
 * Throws HttpsError("unauthenticated") when request.auth is missing.
 * Throws HttpsError("permission-denied") when none of the conditions match.
 */
async function verifyAdminOrOwner(
  request: { auth?: { uid: string; token: Record<string, unknown> } },
  mgmtId: string
): Promise<void> {
  // ── Auth presence guard ──────────────────────────────────
  if (!request.auth) {
    console.error("verifyAdminOrOwner: request.auth is null/undefined");
    throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
  }

  // TODO: Remove debug log before production release
  console.log("AUTH DEBUG:", JSON.stringify(request.auth));

  const callerUid = request.auth.uid;
  const token = request.auth.token ?? {};

  // ── Token-based admin (custom claims) ────────────────────
  if (token.admin === true || token.role === "admin") {
    return; // Admin via custom claim — skip Firestore lookups
  }

  // ── Management lookup ────────────────────────────────────
  const mgmtSnap = await db.doc(`managements/${mgmtId}`).get();
  if (!mgmtSnap.exists) {
    throw new HttpsError("not-found", "MANAGEMENT_NOT_FOUND");
  }
  const mgmtData = mgmtSnap.data();

  // ── Owner check ──────────────────────────────────────────
  if (mgmtData?.ownerUid === callerUid) {
    return;
  }

  // ── Firestore-based admin + membership check (fallback) ──
  const userSnap = await db.doc(`users/${callerUid}`).get();
  const userData = userSnap.data();
  const isAdmin = userData?.role === "admin";
  const isMember =
    userData?.managementId === mgmtId ||
    (Array.isArray(userData?.managementIds) && userData.managementIds.includes(mgmtId));

  if (!isAdmin || !isMember) {
    throw new HttpsError("permission-denied", "Admin privileges required");
  }
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
      postedCreditMinor += entry.amountMinor;
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
  { enforceAppCheck: false },
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const unitId = request.data?.unitId;
    const force = request.data?.force === true;

    if (!isValidId(mgmtId) || !isValidId(unitId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    // ── Tenant boundary + admin/owner check ──────────────────────
    await verifyAdminOrOwner(request, mgmtId);
    const callerUid = request.auth!.uid;

    // ── Rebuild throttle guard ───────────────────────────────────
    // Prevents accidental cost spikes from repeated rebuilds.
    // Admin can override with force: true.
    const balRef = unitBalanceRef(mgmtId, unitId);
    const currentSnap = await balRef.get();
    const currentVersion = currentSnap.exists ? (currentSnap.data()?.version ?? 0) : 0;

    if (!force && currentSnap.exists) {
      const rebuiltAt = currentSnap.data()?.rebuiltAt;
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

    // Compute canonical balance
    const canonical = await computeCanonicalBalance(mgmtId, unitId);

    // Set (NEVER increment) — overwrite with canonical truth
    await balRef.set({
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
    });

    console.log(
      `✅ Rebuilt unitBalance: mgmt=${mgmtId} unit=${unitId} ` +
      `balance=${canonical.balanceMinor} debit=${canonical.postedDebitMinor} ` +
      `credit=${canonical.postedCreditMinor} entries=${canonical.entryCount}`
    );

    // ── Alert auto-resolve ───────────────────────────────────────
    // After successful rebuild, resolve all open BALANCE_DRIFT alerts
    // for this unit. Only resolve alerts detected BEFORE the rebuild.
    // The cutoff uses the rebuiltAt we just set; since it's serverTimestamp,
    // we use Timestamp.now() as a close approximation.
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
      console.warn(
        `⚠️ DRIFT DETECTED: mgmt=${mgmtId} unit=${unitId} ` +
        `canonical=${canonical.balanceMinor} cached=${cachedBalance} diff=${diff}`
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
  { enforceAppCheck: false },
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
    await verifyAdminOrOwner(request, mgmtId);
    const callerUid = request.auth!.uid;

    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);

    let alreadyVoided = false;

    await db.runTransaction(async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) {
        throw new HttpsError("not-found", "ENTRY_NOT_FOUND");
      }

      const entry = entrySnap.data() as LedgerDoc;

      // Idempotency: already voided → graceful no-op
      if (entry.status === "voided") {
        alreadyVoided = true;
        return;
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

      // Void the entry
      tx.update(entryRef, {
        status: "voided",
        voidReason: reason.trim(),
        voidedAt: FieldValue.serverTimestamp(),
        voidedBy: callerUid,
      });
    });

    // Idempotent: already voided, return success without re-logging
    if (alreadyVoided) {
      console.log(
        `ℹ️ Entry already voided (no-op): mgmt=${mgmtId} entry=${entryId}`
      );
      return { ok: true, entryId, status: "voided", noop: true };
    }

    console.log(
      `🗑️ Voided ledger entry: mgmt=${mgmtId} entry=${entryId} by=${callerUid}`
    );

    // Audit log (fire-and-forget)
    await writeAuditLog(mgmtId, "LEDGER_VOID", callerUid, entryId, "ledgerEntry", {
      reason: reason.trim(),
    });

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
  { enforceAppCheck: false },
  async (request) => {
    const mgmtId = request.data?.mgmtId;
    const entryId = request.data?.entryId;
    const reason = request.data?.reason ?? "";

    if (!isValidId(mgmtId) || !isValidId(entryId)) {
      throw new HttpsError("invalid-argument", "INVALID_INPUT");
    }

    // Tenant boundary + role check
    await verifyAdminOrOwner(request, mgmtId);
    const callerUid = request.auth!.uid;

    const entryRef = db.doc(`managements/${mgmtId}/ledger/${entryId}`);
    // Pre-generate reversal entry ID
    const reversalRef = db.collection(`managements/${mgmtId}/ledger`).doc();
    const reversalEntryId = reversalRef.id;

    let reversalType: LedgerType = "CREDIT";
    let alreadyReversed = false;

    await db.runTransaction(async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) {
        throw new HttpsError("not-found", "ENTRY_NOT_FOUND");
      }

      const entry = entrySnap.data() as LedgerDoc;

      // Idempotency: already reversed → graceful no-op
      if (entry.status === "reversed") {
        alreadyReversed = true;
        return;
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

      // Determine reversal type (opposite of original)
      reversalType = entry.type === "DEBIT" ? "CREDIT" : "DEBIT";

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
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });
    });

    // Idempotent: already reversed, return success without re-logging
    if (alreadyReversed) {
      console.log(
        `ℹ️ Entry already reversed (no-op): mgmt=${mgmtId} entry=${entryId}`
      );
      return { ok: true, originalEntryId: entryId, noop: true };
    }

    console.log(
      `🔄 Reversed ledger entry: mgmt=${mgmtId} original=${entryId} ` +
      `reversal=${reversalEntryId} type=${reversalType} by=${callerUid}`
    );

    // Audit log (fire-and-forget)
    await writeAuditLog(mgmtId, "LEDGER_REVERSE", callerUid, entryId, "ledgerEntry", {
      reversalEntryId,
      reversalType,
      reason: reason || null,
    });

    return {
      ok: true,
      originalEntryId: entryId,
      reversalEntryId,
      reversalType,
    };
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

        tx.set(entryRef, {
          managementId: mgmtId,
          unitId,
          type: "DEBIT",
          amountMinor: feeMinor,
          currency,
          source: "dues",
          description: `${yearMonth} Aidat Tahakkuku`,
          status: "posted",
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
      });

      processed++;

      // Audit Log (Fire-and-forget)
      await writeAuditLog(
        mgmtId,
        "DUES_GENERATED",
        context.uid || "system",
        unitId,
        "unit",
        {
          yearMonth,
          amountMinor: feeMinor,
          currency,
        }
      );
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
  { enforceAppCheck: false },
  async (request) => {
    const { mgmtId, yearMonth, dryRun } = request.data;

    if (!isValidId(mgmtId)) {
      throw new HttpsError("invalid-argument", "INVALID_MGMT_ID");
    }
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new HttpsError("invalid-argument", "INVALID_YEAR_MONTH (YYYY-MM)");
    }

    // Auth + role check (handles unauthenticated case internally)
    await verifyAdminOrOwner(request, mgmtId);

    const callerUid = request.auth!.uid;

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
