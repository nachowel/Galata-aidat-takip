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
import { db as firestoreDb, auth } from './firebaseConfig';
import { BuildingInfo, Unit, Transaction, LedgerEntry, BoardMember, FileEntry, ManagementMeta } from './types';

// Tenant-scoped collection helpers (managements/{mgmtId}/...)
const unitsCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'units');
const ledgerCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'ledger');
const boardMembersCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'boardMembers');
const filesCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'files');
const invitesCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'invites');

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

  private mapLegacyTransactionToLedgerEntry(tx: Transaction, mgmtId: string): LedgerEntry {
    const type = (tx.direction ?? (tx.type === 'GELİR' ? 'CREDIT' : 'DEBIT')) as 'DEBIT' | 'CREDIT';
    const amountMinor = Math.round(Number(tx.amount) * 100);

    return {
      id: tx.id,
      managementId: mgmtId,
      unitId: tx.unitId ?? null,
      type,
      amountMinor,
      currency: 'TRY',
      source: 'manual',
      description: tx.description ?? '',
      status: 'posted',
      createdAt: Date.now(),
      createdBy: this.getActorUid(),
      legacyDate: tx.date ?? '',
      legacyCategoryType: tx.type,
      periodMonth: tx.periodMonth,
      periodYear: tx.periodYear
    };
  }

  private mapLedgerEntryToLegacyTransaction(id: string, data: Record<string, any>): Transaction {
    const amount = Number(data.amountMinor ?? 0) / 100;
    const direction = data.type as 'DEBIT' | 'CREDIT';

    return {
      id,
      type: (data.legacyCategoryType ?? (direction === 'CREDIT' ? 'GELİR' : 'GİDER')) as Transaction['type'],
      direction,
      amount: Number.isFinite(amount) ? amount : 0,
      date: data.legacyDate ?? '',
      description: data.description ?? '',
      unitId: data.unitId ?? undefined,
      periodMonth: data.periodMonth,
      periodYear: data.periodYear
    };
  }

  async createLedgerEntry(
    entry: Omit<LedgerEntry, 'id' | 'managementId' | 'createdAt' | 'createdBy' | 'status'> & {
      id?: string;
      managementId?: string;
      status?: LedgerEntry['status'];
    },
    mgmtId?: string
  ): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');

    const entryId = entry.id || doc(ledgerCol(id)).id;
    await setDoc(doc(ledgerCol(id), entryId), {
      ...entry,
      managementId: id,
      status: entry.status ?? 'posted',
      createdAt: Date.now(),
      createdBy: this.getActorUid()
    });
    return entryId;
  }

  async voidLedgerEntry(entryId: string, reason: string, mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !entryId) return;
    await updateDoc(doc(ledgerCol(id), entryId), {
      status: 'voided',
      voidReason: reason,
      voidedAt: Date.now(),
      voidedBy: this.getActorUid()
    });
  }

  async reverseLedgerEntry(entryId: string, reason: string, mgmtId?: string): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id || !entryId) throw new Error('activeMgmtId or entryId is not set');

    const originalSnap = await getDoc(doc(ledgerCol(id), entryId));
    if (!originalSnap.exists()) throw new Error('ledger entry not found');
    const original = originalSnap.data() as LedgerEntry;
    if (original.status === 'voided') throw new Error('voided ledger entry cannot be reversed');
    if (original.status === 'reversed') throw new Error('ledger entry already reversed');

    const reverseId = doc(ledgerCol(id)).id;
    await setDoc(doc(ledgerCol(id), reverseId), {
      managementId: id,
      unitId: original.unitId ?? null,
      type: original.type === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amountMinor: Number(original.amountMinor),
      currency: original.currency ?? 'TRY',
      source: 'reversal',
      description: `REVERSAL: ${reason}`,
      reversalOf: entryId,
      status: 'posted',
      createdAt: Date.now(),
      createdBy: this.getActorUid(),
      legacyDate: original.legacyDate ?? '',
      legacyCategoryType: original.legacyCategoryType ?? undefined,
      periodMonth: original.periodMonth,
      periodYear: original.periodYear
    } satisfies Omit<LedgerEntry, 'id'>);

    await updateDoc(doc(ledgerCol(id), entryId), {
      status: 'reversed',
      reversedAt: Date.now(),
      reversedBy: this.getActorUid()
    });

    return reverseId;
  }

  async archiveAllLedgerEntries(mgmtId?: string): Promise<void> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) return;
    const snapshot = await getDocs(ledgerCol(id));
    const batch = writeBatch(firestoreDb);
    const now = Date.now();
    const actor = this.getActorUid();
    snapshot.docs.forEach((d) => {
      const data = d.data();
      if (data.status !== 'voided') {
        batch.update(d.ref, {
          status: 'voided',
          voidReason: 'bulk_archive',
          voidedAt: now,
          voidedBy: actor
        });
      }
    });
    await batch.commit();
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

  // TODO(ledger-migration): Remove after UI is migrated to ledger-native payloads.
  async createTransactionFromLegacy(tx: Transaction, mgmtId?: string): Promise<string> {
    const id = mgmtId ?? this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const entry = this.mapLegacyTransactionToLedgerEntry(tx, id);
    return this.createLedgerEntry(entry, id);
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
    const collections = [unitsCol(id), ledgerCol(id), boardMembersCol(id), filesCol(id)];
    for (const col of collections) {
      const snap = await getDocs(col);
      snap.docs.forEach(d => batch.delete(d.ref));
    }
    await batch.commit();
  }
}

export const db = new DatabaseService();
