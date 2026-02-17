
export interface BalanceSummary {
  mevcutBakiye: number;
  alacakBakiyesi: number;
  demirbasKasasi: number;
  toplam: number;
}

export type EntityStatus = 'active' | 'archived';
export type InviteStatus = 'active' | 'reserved' | 'used' | 'revoked';
export type LedgerStatus = 'posted' | 'voided' | 'reversed';

export interface Archivable {
  status?: EntityStatus;
  archivedAt?: number;
  archivedBy?: string;
  archiveReason?: string;
}

export interface BuildingInfo {
  name: string;
  address: string;
  role: string;
  taxNo?: string;
  managerName?: string;
  duesAmount: number;
  managerUnitId?: string;
  isManagerExempt: boolean;
  isAutoDuesEnabled: boolean;
}

export interface OwnerHistory {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  phone: string;
  isCurrent: boolean;
}

export interface TenantHistory {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  phone: string;
  isCurrent: boolean;
}

export interface Unit {
  id: string;
  no: string;
  ownerName: string;
  tenantName?: string;
  phone: string; // Malik Telefonu
  tenantPhone?: string; // Kiracı Telefonu
  credit: number;
  debt: number;
  type?: string; // e.g., "3+1"
  m2?: number; // e.g., 100
  huzurHakki?: string; // e.g., "YOK" or "VAR"
  status?: string; // "Malik" or "Kiracı"
  lifecycleStatus?: EntityStatus;
  archivedAt?: number;
  archivedBy?: string;
  archiveReason?: string;
  ownerHistory?: OwnerHistory[];
  tenantHistory?: TenantHistory[];
}

export interface Transaction {
  id: string;
  type: 'GELİR' | 'GİDER' | 'BORÇLANDIRMA' | 'TRANSFER';
  direction?: 'DEBIT' | 'CREDIT';
  amount: number;
  date: string;
  description: string;
  unitId?: string;
  periodMonth?: number; // 0-11
  periodYear?: number;
}

export interface LedgerEntry {
  id: string;
  managementId: string;
  unitId?: string | null;
  type: 'DEBIT' | 'CREDIT';
  amountMinor: number; // Integer minor unit: kurus/pence
  currency: string;
  source: 'manual' | 'auto' | 'invite' | 'adjustment' | 'reversal' | 'void' | 'dues';
  description: string;
  status: LedgerStatus;
  createdAt: number;
  createdBy: string;
  reversalOf?: string | null;
  voidReason?: string | null;
  voidedAt?: number | null;
  voidedBy?: string | null;
  reversedAt?: number | null;
  reversedBy?: string | null;
  legacyDate?: string; // TODO(ledger-migration): Remove after UI is ledger-native.
  legacyCategoryType?: Transaction['type']; // TODO(ledger-migration): Remove after UI is ledger-native.
  periodMonth?: number;
  periodYear?: number;
  relatedDueId?: string | null;
  dueTotalMinor?: number | null;
  dueAllocatedMinor?: number | null;
  dueOutstandingMinor?: number | null;
  dueStatus?: 'open' | 'paid' | null;
  dueAggregationUpdatedAt?: number | null;
  dueAggregateVersion?: number | null;
  appliedMinor?: number | null;
  unappliedMinor?: number | null;
  allocationStatus?: 'unapplied' | 'partial' | 'applied' | null;
  metadata?: Record<string, unknown>;
  // Technical processing fields (mutable, NOT domain-immutable)
  balanceAppliedAt?: number | null;
  balanceAppliedVersion?: number | null;
  balanceRevertedAt?: number | null;
  balanceRevertedVersion?: number | null;
}

export interface DueAllocation {
  id: string;
  managementId: string;
  unitId: string;
  dueId: string;
  paymentId: string;
  paymentEntryId: string;
  amountMinor: number; // original allocation: >0, reversal allocation: <0
  status: 'applied';
  createdAt: number;
  createdBy: string;
  idempotencyKey: string;
  originalAllocationId?: string;
}

export interface UnitBalance {
  unitId: string;
  /** Net balance in minor units. Positive = unit has credit (overpaid), Negative = unit owes (debt). */
  balanceMinor: number;
  /** Total posted debit amount (always >= 0) */
  postedDebitMinor: number;
  /** Total posted credit amount (always >= 0) */
  postedCreditMinor: number;
  /** Server timestamp of last applied ledger event */
  lastLedgerEventAt: number;
  /** ID of last applied ledger entry (informational) */
  lastAppliedEntryId?: string;
  /** Server timestamp of last cache update */
  updatedAt: number;
  /** Schema version for future migration (starts at 1) */
  version: number;
  /** Set by rebuildUnitBalance — timestamp of last rebuild */
  rebuiltAt?: number | null;
  /** Set by rebuildUnitBalance — uid of caller */
  rebuiltBy?: string | null;
  /** Set by rebuildUnitBalance — number of posted entries used in rebuild */
  rebuiltFromEntryCount?: number | null;
  /** Monotonic counter: incremented by 1 on every trigger-applied cache mutation.
   *  Used by rebuildUnitBalance to detect concurrent trigger activity. */
  appliedCount?: number;
}

export type BalanceDriftAlertStatus = 'open' | 'resolved';

export interface BalanceDriftAlert {
  type: 'BALANCE_DRIFT';
  unitId: string;
  /** Canonical balance computed from ledger */
  canonicalBalance: number;
  /** Cached balance found in unitBalances doc */
  cachedBalance: number;
  /** canonicalBalance - cachedBalance */
  diff: number;
  /** Server timestamp of detection */
  detectedAt: number;
  /** Alert status */
  status: BalanceDriftAlertStatus;
  /** Set when alert is resolved — server timestamp */
  resolvedAt?: number | null;
  /** UID of resolver (system for auto-resolve, admin uid for manual) */
  resolvedBy?: string | null;
  /** Reason for resolution */
  resolvedReason?: string | null;
}

// ─── Dues Engine ─────────────────────────────────────────────────────

export interface DuesSettings {
  enabled: boolean;
  /** Monthly fee in minor units (e.g. 10000 = 100.00 TL) */
  monthlyFeeMinor: number;
  currency: string;
  /** Day of month to generate dues (default: 1) */
  dueDay: number;
  timezone: string;
  /** Unit IDs exempt from dues (e.g. concierge, management office) */
  exemptUnitIds: string[];
  updatedAt?: number;
  updatedBy?: string;
}

export interface DuesRunUnit {
  status: 'created';
  ledgerEntryId: string;
  createdAt: number;
  feeMinor: number;
}

// ─── Audit Trail ─────────────────────────────────────────────────────

export type AuditAction =
  | 'REBUILD_BALANCE'
  | 'LEDGER_REVERSE'
  | 'LEDGER_VOID'
  | 'DRIFT_DETECTED'
  | 'ALERT_AUTO_RESOLVED'
  | 'AUDIT_WRITE_FAILED'
  | 'DUES_GENERATED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_REVERSED'
  | 'PAYMENT_ALLOCATED'
  | 'EXPENSE_CREATED'
  | 'ADJUSTMENT_CREATED'
  | 'DUE_DRIFT_DETECTED'
  | 'DUE_AGGREGATES_REBUILT'
  | 'AUTO_CREDIT_SETTLEMENT';

/**
 * Immutable audit log entry for tracking critical system operations.
 * Path: managements/{mgmtId}/auditLogs/{logId}
 * Writer: Cloud Function (Admin SDK) only — client write kapalı.
 */
export interface AuditLogEntry {
  /** The action that was performed */
  action: AuditAction;
  /** UID of the actor (user or 'system' for scheduled jobs) */
  actorUid: string;
  /** Target entity ID (unitId, entryId, alertId etc.) */
  targetId: string;
  /** Target entity type for disambiguation */
  targetType: 'unit' | 'ledgerEntry' | 'alert';
  /** Management ID (denormalized for query convenience) */
  managementId: string;
  /** Server timestamp of log creation */
  at: number;
  /** Action-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface BoardMember {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export interface FileEntry extends Archivable {
  id: string;
  name: string;
  category: 'Fatura' | 'Sözleşme' | 'Tutanak' | 'Karar' | 'Diğer';
  date: string;
  size: string;
  extension: string;
  uri?: string; // Dosya yolu (mobil cihazlarda)
  fileName?: string; // Gerçek dosya adı (Documents klasöründe)
  data?: string; // Dosya içeriği (base64/dataURL)
}

export interface ManagementMeta {
  name: string;
  ownerUid: string;
  createdAt: number;
  status?: EntityStatus;
  archivedAt?: number;
  archivedBy?: string;
}

export type ActiveTab = 'home' | 'menu' | 'sessions' | 'settings' | 'files';

export interface AppUser {
  uid: string;
  email: string;
  role: 'admin' | 'resident';
  managementIds: string[];
  managementId?: string | null;
  unitId?: string | null;
}
