import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  writeBatch
} from 'firebase/firestore';
import { db as firestoreDb, auth } from './firebaseConfig';
import { BuildingInfo, Unit, Transaction, BoardMember, FileEntry, ManagementMeta } from './types';

// Tenant-scoped collection helpers (managements/{mgmtId}/...)
const unitsCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'units');
const transactionsCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'transactions');
const boardMembersCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'boardMembers');
const filesCol = (mgmtId: string) => collection(firestoreDb, 'managements', mgmtId, 'files');

class DatabaseService {
  private activeMgmtId: string = '';

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
    const docRef = await addDoc(collection(firestoreDb, 'managements'), {
      name,
      ownerUid: auth.currentUser?.uid ?? null,
      createdAt: Date.now()
    });
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

  switchManagement(mgmtId: string): void {
    this.activeMgmtId = mgmtId;
    console.log('🔀 Yönetim değiştirildi:', mgmtId);
  }

  async deleteManagement(mgmtId: string): Promise<void> {
    try {
      console.log('🗑️ Yönetim siliniyor:', mgmtId);
      await deleteDoc(doc(firestoreDb, 'managements', mgmtId));
      if (this.activeMgmtId === mgmtId) this.activeMgmtId = '';
      console.log('✓ Yönetim Firestore\'dan silindi:', mgmtId);
    } catch (error) {
      console.error('✗ Yönetim silme hatası:', error);
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

  async saveBuildingInfo(info: BuildingInfo): Promise<void> {
    const id = this.activeMgmtId;
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

  async saveUnits(units: Unit[]): Promise<void> {
    const id = this.activeMgmtId;
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

  // --- Transactions (subcollection) ---

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    const id = this.activeMgmtId;
    if (!id) throw new Error('activeMgmtId is not set');
    const col = transactionsCol(id);
    const batch = writeBatch(firestoreDb);
    const existing = await getDocs(col);
    existing.docs.forEach(d => batch.delete(d.ref));
    transactions.forEach(tx => {
      if (tx?.id) {
        const { id: txId, ...rest } = tx;
        batch.set(doc(col, txId), rest);
      }
    });
    await batch.commit();
  }

  async getTransactions(): Promise<Transaction[]> {
    const id = this.activeMgmtId;
    if (!id) return [];
    const snapshot = await getDocs(transactionsCol(id));
    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
    return list.sort((a, b) => {
      const dateA = a.date ? a.date.split('.').reverse().join('') : '0';
      const dateB = b.date ? b.date.split('.').reverse().join('') : '0';
      return dateB.localeCompare(dateA);
    });
  }

  async deleteTransaction(txId: string): Promise<void> {
    if (!txId || !this.activeMgmtId) return;
    await deleteDoc(doc(firestoreDb, 'managements', this.activeMgmtId, 'transactions', txId));
  }

  // --- Board members (subcollection) ---

  async saveBoardMembers(members: BoardMember[]): Promise<void> {
    const id = this.activeMgmtId;
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

  async saveFiles(files: FileEntry[]): Promise<void> {
    const id = this.activeMgmtId;
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
      transactions: transactionsCol(id),
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

  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteManagement(sessionId);
  }

  async clearAllData(): Promise<void> {
    const id = this.activeMgmtId;
    if (!id) return;
    const batch = writeBatch(firestoreDb);
    const collections = [unitsCol(id), transactionsCol(id), boardMembersCol(id), filesCol(id)];
    for (const col of collections) {
      const snap = await getDocs(col);
      snap.docs.forEach(d => batch.delete(d.ref));
    }
    await batch.commit();
  }
}

export const db = new DatabaseService();
