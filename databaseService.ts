import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  writeBatch,
  arrayUnion,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db as firestoreDb, auth, functions } from './firebaseConfig';
import { BuildingInfo, Unit, Transaction, BoardMember, FileEntry, ManagementMeta } from './types';

// Tenant-scoped collection helpers (managements/{mgmtId}/...)
const unitsCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'units');
const ledgerCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'ledger');
const boardMembersCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'boardMembers');
const filesCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'files');
const invitesCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'invites');
type PaymentMethod = 'cash' | 'bank' | 'stripe' | 'auto';

class DatabaseService {
  private activeMgmtId: string = '';

  private getActorUid(): string {
    return auth.currentUser?.uid ?? 'system';
  }

  setCurrentSession(mgmtId: string): void {
    this.activeMgmtId = mgmtId;
    console.log('📌 Aktif yönetim değiştirildi:', mgmtId);
  }

  getCurrentSession(): string {
    return this.activeMgmtId;
  }

  private mgmtRef(mgmtId?: string) {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    return doc(firestoreDb, 'managements', id);
  }

  // --- Management Lifecycle ---

  async createManagement(name: string): Promise<string> {
    const uid = auth.currentUser?.uid ?? null;
    const firestorePayload = { name, ownerUid: uid, createdAt: Date.now() };
    console.log("FIRESTORE createManagement PAYLOAD:", firestorePayload);
    const docRef = await addDoc(collection(firestoreDb, 'managements'), firestorePayload);
    if (uid) {
      await setDoc(doc(firestoreDb, 'managementMemberships', docRef.id, 'users', uid), {
        role: 'owner',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
      await updateDoc(doc(firestoreDb, 'users', uid), {
        managementIds: arrayUnion(docRef.id)
      });
    }
    console.log('✅ Yeni yönetim oluşturuldu:', docRef.id, name);
    return docRef.id;
  }

  async getUserManagements(): Promise<{ id: string; name: string; ownerUid?: string; createdAt?: number }[]> {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const q = query(
      collection(firestoreDb, 'managements'),
      where('ownerUid', '==', uid)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as { id: string; name: string; ownerUid?: string; createdAt?: number }[];
  }

  async createInvite(mgmtId: string, unitId: string): Promise<string> {
    const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ref = await addDoc(invitesCol(mgmtId), {
      unitId,
      status: 'active',
      createdAt: serverTimestamp(),
      expiresAt,
      usedAt: null,
      usedByUid: null
    });
    return ref.id;
  }

  switchManagement(mgmtId: string): void {
    this.activeMgmtId = mgmtId;
    console.log('🔀 Yönetim değiştirildi:', mgmtId);
  }

  async archiveManagement(mgmtId: string, reason: string = 'manual_archive'): Promise<void> {
    try {
      console.log('🗂️ Yönetim arşivleniyor:', mgmtId);
      await updateDoc(doc(firestoreDb, 'managements', mgmtId), {
        status: 'archived',
        archivedAt: Date.now(),
        archivedBy: this.getActorUid(),
        archiveReason: reason
      });
      if (this.activeMgmtId === mgmtId) this.activeMgmtId = '';
      console.log('✓ Yönetim arşivlendi:', mgmtId);
    } catch (error) {
      console.error('✗ Yönetim arşivleme hatası:', error);
      throw error;
    }
  }

  async getManagementMeta(mgmtId: string): Promise<ManagementMeta | null> {
    try {
      const snap = await getDoc(doc(firestoreDb, 'managements', mgmtId));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { name: d.name ?? '', ownerUid: d.ownerUid ?? '', createdAt: d.createdAt ?? 0 };
    } catch (error) {
      console.error('Meta okuma hatası:', error);
      return null;
    }
  }

  async updateManagementMeta(mgmtId: string, updates: Partial<ManagementMeta>): Promise<void> {
    await updateDoc(doc(firestoreDb, 'managements', mgmtId), updates as Record<string, unknown>);
  }

  // --- Building info (stored in management document) ---

  async saveBuildingInfo(info: BuildingInfo, mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    await updateDoc(this.mgmtRef(id), {
      name: info.name,
      address: info.address ?? '',
      role: info.role ?? '',
      taxNo: info.taxNo ?? '',
      managerName: info.managerName ?? '',
      duesAmount: info.duesAmount ?? 0,
      isManagerExempt: info.isManagerExempt ?? false,
      managerUnitId: info.managerUnitId ?? '',
      isAutoDuesEnabled: info.isAutoDuesEnabled ?? true
    });
  }

  async getBuildingInfo(): Promise<BuildingInfo | null> {
    const id = this.activeMgmtId;
    if (!id) return null;
    const snap = await getDoc(this.mgmtRef(id));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      name: d.name ?? 'BİNA ADI TANIMLANMADI',
      address: d.address ?? '',
      role: d.role ?? 'Yönetici',
      managerName: d.managerName ?? '',
      taxNo: d.taxNo ?? '',
      duesAmount: Number(d.duesAmount) ?? 0,
      isManagerExempt: Boolean(d.isManagerExempt),
      managerUnitId: d.managerUnitId ?? '',
      isAutoDuesEnabled: d.isAutoDuesEnabled !== false
    };
  }

  // --- Units (subcollection) ---

  async saveUnits(units: Unit[], mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const col = unitsCol(id);
    const batch = writeBatch(firestoreDb);
    const existing = await getDocs(col);
    existing.docs.forEach(d => batch.delete(d.ref));
    units.forEach(u => {
      const { credit, debt, ...rest } = u;
      batch.set(doc(col, u.id), rest);
    });
    await batch.commit();
  }

  async getUnits(): Promise<Unit[]> {
    const id = this.activeMgmtId;
    if (!id) return [];
    const snapshot = await getDocs(unitsCol(id));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data(), credit: 0, debt: 0 })) as Unit[];
  }

  // --- Ledger (immutable + soft-delete via void/reversal) ---

  private resolveLegacyDirection(tx: Transaction): 'DEBIT' | 'CREDIT' {
    return (tx.direction ?? (tx.type === 'GELİR' ? 'CREDIT' : 'DEBIT')) as 'DEBIT' | 'CREDIT';
  }

  private inferPaymentMethod(description: string): PaymentMethod {
    const normalized = description.toLowerCase();
    if (normalized.includes('[bank]') || normalized.includes('havale') || normalized.includes('eft')) return 'bank';
    if (normalized.includes('[stripe]') || normalized.includes('kart')) return 'stripe';
    if (normalized.includes('[auto]') || normalized.includes('otomatik')) return 'auto';
    return 'cash';
  }

  private toLegacyDateFromCreatedAt(value: any): string {
    if (!value) return '';
    try {
      if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleDateString('tr-TR');
      }
      if (typeof value === 'number') {
        return new Date(value).toLocaleDateString('tr-TR');
      }
      if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString('tr-TR');
      }
    } catch {
      return '';
    }
    return '';
  }

  private mapLedgerEntryToLegacyTransaction(id: string, data: Record<string, any>): Transaction {
    const amount = Number(data.amountMinor ?? 0) / 100;
    const direction = (data.type === 'DEBIT' || data.type === 'CREDIT'
      ? data.type
      : (data.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT')) as 'DEBIT' | 'CREDIT';
    const legacyDate = typeof data.legacyDate === 'string' && data.legacyDate.trim().length > 0
      ? data.legacyDate
      : this.toLegacyDateFromCreatedAt(data.createdAt);

    return {
      id,
      type: (data.legacyCategoryType ?? (direction === 'CREDIT' ? 'GELİR' : 'GİDER')) as Transaction['type'],
      direction,
      amount: Number.isFinite(amount) ? amount : 0,
      date: legacyDate,
      description: data.description ?? data.reference ?? '',
      unitId: data.unitId ?? undefined,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear
    };
  }

  async createPayment(
    payload: {
      unitId: string;
      amountMinor: number;
      method: PaymentMethod;
      reference: string;
      idempotencyKey: string;
      relatedDueId?: string;
      legacyDate?: string;
      legacyCategoryType?: Transaction['type'];
      periodMonth?: number;
      periodYear?: number;
    },
    mgmtId?: string
  ): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'createPayment');
    const result = await callable({
      managementId: id,
      unitId: payload.unitId,
      amountMinor: payload.amountMinor,
      method: payload.method,
      reference: payload.reference,
      idempotencyKey: payload.idempotencyKey,
      relatedDueId: payload.relatedDueId ?? null,
      legacyDate: payload.legacyDate ?? null,
      legacyCategoryType: payload.legacyCategoryType ?? null,
      periodMonth: payload.periodMonth ?? null,
      periodYear: payload.periodYear ?? null
    });
    const data = result.data as { entryId?: string };
    if (!data?.entryId) throw new Error('createPayment: entryId not returned');
    return data.entryId;
  }

  async autoSettleFromCredit(
    payload: { unitId: string },
    mgmtId?: string
  ): Promise<{
    closedDueCount: number;
    totalSettledMinor: number;
    remainingCreditMinor: number;
  }> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'autoSettleFromCredit');
    const result = await callable({
      managementId: id,
      unitId: payload.unitId
    });
    const data = result.data as {
      closedDueCount?: number;
      totalSettledMinor?: number;
      remainingCreditMinor?: number;
    };
    return {
      closedDueCount: Number(data.closedDueCount ?? 0),
      totalSettledMinor: Number(data.totalSettledMinor ?? 0),
      remainingCreditMinor: Number(data.remainingCreditMinor ?? 0)
    };
  }

  async allocatePaymentToDue(
    payload: {
      paymentEntryId: string;
      dueId: string;
      amountMinor?: number;
    },
    mgmtId?: string
  ): Promise<{
    appliedMinor: number;
    appliedTotalMinor: number;
    unappliedMinor: number;
    allocationStatus: 'unapplied' | 'partial' | 'applied';
    noop: boolean;
  }> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'allocatePaymentToDue');
    const result = await callable({
      managementId: id,
      paymentEntryId: payload.paymentEntryId,
      dueId: payload.dueId,
      amountMinor: payload.amountMinor ?? null
    });
    const data = result.data as {
      appliedMinor?: number;
      appliedTotalMinor?: number;
      unappliedMinor?: number;
      allocationStatus?: 'unapplied' | 'partial' | 'applied';
      noop?: boolean;
    };
    return {
      appliedMinor: Number(data.appliedMinor ?? 0),
      appliedTotalMinor: Number(data.appliedTotalMinor ?? 0),
      unappliedMinor: Number(data.unappliedMinor ?? 0),
      allocationStatus: (data.allocationStatus ?? 'unapplied'),
      noop: Boolean(data.noop)
    };
  }

  async createExpense(
    payload: {
      unitId?: string;
      amountMinor: number;
      source?: string;
      reference: string;
      idempotencyKey: string;
      legacyDate?: string;
      legacyCategoryType?: Transaction['type'];
      periodMonth?: number;
      periodYear?: number;
    },
    mgmtId?: string
  ): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'createExpense');
    const result = await callable({
      managementId: id,
      unitId: payload.unitId ?? null,
      amountMinor: payload.amountMinor,
      source: payload.source ?? 'manual',
      reference: payload.reference,
      idempotencyKey: payload.idempotencyKey,
      legacyDate: payload.legacyDate ?? null,
      legacyCategoryType: payload.legacyCategoryType ?? null,
      periodMonth: payload.periodMonth ?? null,
      periodYear: payload.periodYear ?? null
    });
    const data = result.data as { entryId?: string };
    if (!data?.entryId) throw new Error('createExpense: entryId not returned');
    return data.entryId;
  }

  async createAdjustment(
    payload: {
      entryType: 'DEBIT' | 'CREDIT';
      unitId?: string;
      amountMinor: number;
      source?: string;
      reference: string;
      idempotencyKey: string;
      legacyDate?: string;
      legacyCategoryType?: Transaction['type'];
      periodMonth?: number;
      periodYear?: number;
    },
    mgmtId?: string
  ): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'createAdjustment');
    const result = await callable({
      managementId: id,
      entryType: payload.entryType,
      unitId: payload.unitId ?? null,
      amountMinor: payload.amountMinor,
      source: payload.source ?? 'manual',
      reference: payload.reference,
      idempotencyKey: payload.idempotencyKey,
      legacyDate: payload.legacyDate ?? null,
      legacyCategoryType: payload.legacyCategoryType ?? null,
      periodMonth: payload.periodMonth ?? null,
      periodYear: payload.periodYear ?? null
    });
    const data = result.data as { entryId?: string };
    if (!data?.entryId) throw new Error('createAdjustment: entryId not returned');
    return data.entryId;
  }

  async voidLedgerEntry(entryId: string, reason: string, mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !entryId) return;
    const callable = httpsCallable(functions, 'voidLedgerEntry');
    await callable({ mgmtId: id, entryId, reason });
  }

  async reverseLedgerEntry(entryId: string, reason: string, mgmtId?: string): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !entryId) throw new Error('activeMgmtId or entryId is not set');

    const snap = await getDoc(doc(firestoreDb, 'managements', id, 'ledger', entryId));
    const entry = snap.exists() ? snap.data() as Record<string, any> : null;
    const source = typeof entry?.source === 'string' ? entry.source : '';
    const isPaymentSource = source === 'cash' || source === 'bank' || source === 'stripe' || source === 'auto';
    const isPaymentEntry = entryId.startsWith('payment_') || (entry?.type === 'CREDIT' && isPaymentSource);
    if (isPaymentEntry) {
      return this.reversePayment(entryId, reason, id);
    }
    const callable = httpsCallable(functions, 'reverseLedgerEntry');
    const result = await callable({ mgmtId: id, entryId, reason });
    const data = result.data as { reversalEntryId?: string };
    if (!data?.reversalEntryId) throw new Error('reverseLedgerEntry: reversalEntryId not returned');
    return data.reversalEntryId;
  }

  async reversePayment(paymentEntryId: string, reason: string, mgmtId?: string): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !paymentEntryId) throw new Error('activeMgmtId or paymentEntryId is not set');
    const callable = httpsCallable(functions, 'reversePayment');
    const result = await callable({ managementId: id, paymentEntryId, reason });
    const data = result.data as { reversalEntryId?: string };
    if (!data?.reversalEntryId) throw new Error('reversePayment: reversalEntryId not returned');
    return data.reversalEntryId;
  }

  async checkDueDrift(
    payload: { sampleLimit?: number } = {},
    mgmtId?: string
  ): Promise<{ checked: number; drifted: number; alertsWritten: number; dueIds: string[] }> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const callable = httpsCallable(functions, 'checkDueDrift');
    const result = await callable({
      managementId: id,
      sampleLimit: payload.sampleLimit ?? 5
    });
    const data = result.data as {
      checked?: number;
      drifted?: number;
      alertsWritten?: number;
      dueIds?: string[];
    };
    return {
      checked: Number(data.checked ?? 0),
      drifted: Number(data.drifted ?? 0),
      alertsWritten: Number(data.alertsWritten ?? 0),
      dueIds: Array.isArray(data.dueIds) ? data.dueIds : []
    };
  }

  async rebuildDueAggregates(
    dueId: string,
    mgmtId?: string
  ): Promise<{
    dueAllocatedMinor: number;
    dueOutstandingMinor: number;
    dueStatus: 'open' | 'paid';
    noop: boolean;
  }> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !dueId) throw new Error('activeMgmtId or dueId is not set');
    const callable = httpsCallable(functions, 'rebuildDueAggregates');
    const result = await callable({ managementId: id, dueId });
    const data = result.data as {
      dueAllocatedMinor?: number;
      dueOutstandingMinor?: number;
      dueStatus?: 'open' | 'paid';
      noop?: boolean;
    };
    return {
      dueAllocatedMinor: Number(data.dueAllocatedMinor ?? 0),
      dueOutstandingMinor: Number(data.dueOutstandingMinor ?? 0),
      dueStatus: data.dueStatus === 'paid' ? 'paid' : 'open',
      noop: Boolean(data.noop)
    };
  }

  async archiveAllLedgerEntries(mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) return;
    const snapshot = await getDocs(ledgerCol(id));
    for (const d of snapshot.docs) {
      const data = d.data();
      if (data.status === 'posted') {
        await this.voidLedgerEntry(d.id, 'bulk_archive', id);
      }
    }
  }

  subscribeLedgerEntries(mgmtId: string, callback: (txs: Transaction[]) => void): () => void {
    if (!mgmtId) return () => {};
    return onSnapshot(ledgerCol(mgmtId), (snapshot) => {
      const list = snapshot.docs
        .filter((d) => d.data().status !== 'voided')
        .map((d) => this.mapLedgerEntryToLegacyTransaction(d.id, d.data() as Record<string, any>));
      list.sort((a, b) => {
        const dateA = a.date ? a.date.split('.').reverse().join('') : '0';
        const dateB = b.date ? b.date.split('.').reverse().join('') : '0';
        return dateB.localeCompare(dateA);
      });
      callback(list);
    });
  }

  async getLedgerEntries(mgmtId?: string): Promise<Transaction[]> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) return [];
    const snapshot = await getDocs(ledgerCol(id));
    const list = snapshot.docs
      .filter((d) => d.data().status !== 'voided')
      .map((d) => this.mapLedgerEntryToLegacyTransaction(d.id, d.data() as Record<string, any>));
    return list.sort((a, b) => {
      const dateA = a.date ? a.date.split('.').reverse().join('') : '0';
      const dateB = b.date ? b.date.split('.').reverse().join('') : '0';
      return dateB.localeCompare(dateA);
    });
  }

  async createTransaction(tx: Transaction, mgmtId?: string): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const direction = this.resolveLegacyDirection(tx);
    const amountMinor = Math.round(Number(tx.amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new Error('createTransaction: invalid amount');
    }

    if (tx.type === 'GELİR' && direction === 'CREDIT' && tx.unitId) {
      return this.createPayment({
        unitId: tx.unitId,
        amountMinor,
        method: this.inferPaymentMethod(tx.description ?? ''),
        reference: tx.description ?? 'TAHSILAT',
        idempotencyKey: tx.id,
        legacyDate: tx.date ?? '',
        legacyCategoryType: tx.type,
        periodMonth: tx.periodMonth,
        periodYear: tx.periodYear
      }, id);
    }

    if (direction === 'CREDIT') {
      return this.createAdjustment({
        entryType: 'CREDIT',
        unitId: tx.unitId,
        amountMinor,
        source: 'manual',
        reference: tx.description ?? '',
        idempotencyKey: tx.id,
        legacyDate: tx.date ?? '',
        legacyCategoryType: tx.type,
        periodMonth: tx.periodMonth,
        periodYear: tx.periodYear
      }, id);
    }

    return this.createExpense({
      unitId: tx.unitId,
      amountMinor,
      source: 'manual',
      reference: tx.description ?? '',
      idempotencyKey: tx.id,
      legacyDate: tx.date ?? '',
      legacyCategoryType: tx.type,
      periodMonth: tx.periodMonth,
      periodYear: tx.periodYear
    }, id);
  }

  // --- Board members (subcollection) ---

  async saveBoardMembers(members: BoardMember[], mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const col = boardMembersCol(id);
    const batch = writeBatch(firestoreDb);
    const existing = await getDocs(col);
    existing.docs.forEach(d => batch.delete(d.ref));
    members.forEach(m => {
      const { id: _id, ...rest } = m;
      batch.set(doc(col, m.id), rest);
    });
    await batch.commit();
  }

  async getBoardMembers(): Promise<BoardMember[]> {
    const id = this.activeMgmtId;
    if (!id) return [];
    const snapshot = await getDocs(boardMembersCol(id));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BoardMember[];
  }

  // --- Files (subcollection) ---

  async saveFiles(files: FileEntry[], mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const col = filesCol(id);
    const batch = writeBatch(firestoreDb);
    const existing = await getDocs(col);
    existing.docs.forEach(d => batch.delete(d.ref));
    files.forEach(f => {
      const { id: _id, ...rest } = f;
      batch.set(doc(col, f.id), rest);
    });
    await batch.commit();
  }

  async getFiles(): Promise<FileEntry[]> {
    const id = this.activeMgmtId;
    if (!id) return [];
    const snapshot = await getDocs(filesCol(id));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as FileEntry[];
  }

  // --- Realtime subscription (Firestore onSnapshot) ---

  subscribeToData(key: string, callback: (data: any) => void): () => void {
    const id = this.activeMgmtId;
    if (!id) return () => {};
    if (key === 'building_info') {
      const unsub = onSnapshot(this.mgmtRef(id), snapshot => {
        const d = snapshot.data();
        if (!d) return callback(null);
        callback({
          name: d.name ?? '',
          address: d.address ?? '',
          role: d.role ?? '',
          managerName: d.managerName ?? '',
          taxNo: d.taxNo ?? '',
          duesAmount: Number(d.duesAmount) ?? 0,
          isManagerExempt: Boolean(d.isManagerExempt),
          managerUnitId: d.managerUnitId ?? '',
          isAutoDuesEnabled: d.isAutoDuesEnabled !== false
        });
      });
      return unsub;
    }
    const colMap: Record<string, ReturnType<typeof collection>> = {
      units: unitsCol(id),
      transactions: ledgerCol(id),
      board_members: boardMembersCol(id),
      files: filesCol(id)
    };
    const col = colMap[key];
    if (!col) return () => {};
    const unsub = onSnapshot(col, snapshot => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(key === 'units' ? list.map((u: any) => ({ ...u, credit: 0, debt: 0 })) : list);
    });
    return unsub;
  }

  async testConnection(): Promise<boolean> {
    try {
      const q = query(collection(firestoreDb, 'managements'), where('ownerUid', '==', auth.currentUser?.uid ?? ''));
      await getDocs(q);
      return true;
    } catch (error) {
      console.error('Firestore test hatası:', error);
      return false;
    }
  }

  async archiveSession(sessionId: string, reason: string = 'session_archive'): Promise<void> {
    await this.archiveManagement(sessionId, reason);
  }

  // TODO(soft-delete-migration): Replace with archive APIs for each collection.
  async clearAllData(): Promise<void> {
    const id = this.activeMgmtId;
    if (!id) return;
    const batch = writeBatch(firestoreDb);
    const collections = [unitsCol(id), boardMembersCol(id), filesCol(id)];
    for (const col of collections) {
      const snap = await getDocs(col);
      snap.docs.forEach(d => batch.delete(d.ref));
    }
    await batch.commit();
    await this.archiveAllLedgerEntries(id);
  }
}

export const db = new DatabaseService();
