import { ref, set, get, update, remove, onValue, off } from 'firebase/database';
import { database, auth } from './firebaseConfig';
import { BuildingInfo, Unit, Transaction, BoardMember, FileEntry, ManagementMeta } from './types';

class DatabaseService {
  private activeMgmtId: string = '';

  // --- Tenant Path Builder ---
  private mgmtPath(subPath?: string): string {
    if (!this.activeMgmtId) throw new Error('activeMgmtId is not set');
    const base = `managements/${this.activeMgmtId}`;
    return subPath ? `${base}/${subPath}` : base;
  }

  setCurrentSession(mgmtId: string): void {
    this.activeMgmtId = mgmtId;
    console.log('📌 Aktif yönetim değiştirildi:', mgmtId);
  }

  getCurrentSession(): string {
    return this.activeMgmtId;
  }

  // --- Generic CRUD (all scoped under managements/{mgmtId}) ---

  async saveData(key: string, data: any): Promise<void> {
    try {
      const dataRef = ref(database, this.mgmtPath(key));
      await set(dataRef, data);
    } catch (error) {
      console.error('Database save error:', error);
      throw error;
    }
  }

  async getData(key: string): Promise<any> {
    try {
      const dataRef = ref(database, this.mgmtPath(key));
      const snapshot = await get(dataRef);
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error('Database get error:', error);
      throw error;
    }
  }

  async updateData(key: string, updates: any): Promise<void> {
    try {
      const dataRef = ref(database, this.mgmtPath(key));
      await update(dataRef, updates);
    } catch (error) {
      console.error('Database update error:', error);
      throw error;
    }
  }

  async deleteData(key: string): Promise<void> {
    try {
      const dataRef = ref(database, this.mgmtPath(key));
      await remove(dataRef);
    } catch (error) {
      console.error('Database delete error:', error);
      throw error;
    }
  }

  subscribeToData(key: string, callback: (data: any) => void): () => void {
    const dataRef = ref(database, this.mgmtPath(key));

    onValue(dataRef, (snapshot) => {
      const data = snapshot.exists() ? snapshot.val() : null;
      callback(data);
    });

    return () => off(dataRef);
  }

  // --- Management Lifecycle ---

  async createManagement(name: string): Promise<string> {
    const mgmtId = `mgmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const uid = auth.currentUser?.uid || 'anonymous';

    const meta: ManagementMeta = {
      name,
      ownerUid: uid,
      createdAt: Date.now()
    };

    const metaRef = ref(database, `managements/${mgmtId}/meta`);
    await set(metaRef, meta);

    console.log('✅ Yeni yönetim oluşturuldu:', mgmtId, name);
    return mgmtId;
  }

  switchManagement(mgmtId: string): void {
    this.activeMgmtId = mgmtId;
    console.log('🔀 Yönetim değiştirildi:', mgmtId);
  }

  async deleteManagement(mgmtId: string): Promise<void> {
    try {
      console.log('🗑️ Yönetim siliniyor:', mgmtId);
      const mgmtRef = ref(database, `managements/${mgmtId}`);
      await remove(mgmtRef);

      if (this.activeMgmtId === mgmtId) {
        this.activeMgmtId = '';
      }
      console.log('✓ Yönetim Firebase\'den silindi:', mgmtId);
    } catch (error) {
      console.error('✗ Yönetim silme hatası:', error);
      throw error;
    }
  }

  async getManagementMeta(mgmtId: string): Promise<ManagementMeta | null> {
    try {
      const metaRef = ref(database, `managements/${mgmtId}/meta`);
      const snapshot = await get(metaRef);
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error('Meta okuma hatası:', error);
      return null;
    }
  }

  async updateManagementMeta(mgmtId: string, updates: Partial<ManagementMeta>): Promise<void> {
    const metaRef = ref(database, `managements/${mgmtId}/meta`);
    await update(metaRef, updates);
  }

  // --- Domain Methods (all scoped to active management) ---

  async saveBuildingInfo(info: BuildingInfo): Promise<void> {
    await this.saveData('building_info', info);
  }

  async getBuildingInfo(): Promise<BuildingInfo | null> {
    return await this.getData('building_info');
  }

  async saveUnits(units: Unit[]): Promise<void> {
    await this.saveData('units', units);
  }

  async getUnits(): Promise<Unit[]> {
    const data = await this.getData('units');
    if (!data) return [];

    if (Array.isArray(data)) {
      return data.filter((item): item is Unit => item !== null && item !== undefined);
    }

    return Object.values(data).filter((item): item is Unit => item !== null && item !== undefined);
  }

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    const transactionsObj: Record<string, any> = {};
    transactions.forEach(tx => {
      if (tx && tx.id) {
        const cleanTx: any = {
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          date: tx.date
        };

        if (tx.unitId !== undefined) cleanTx.unitId = tx.unitId;
        if (tx.periodMonth !== undefined) cleanTx.periodMonth = tx.periodMonth;
        if (tx.periodYear !== undefined) cleanTx.periodYear = tx.periodYear;

        transactionsObj[tx.id] = cleanTx;
      }
    });

    await this.saveData('transactions', transactionsObj);
  }

  async deleteTransaction(id: string): Promise<void> {
    if (!id) return;
    try {
      await this.deleteData('transactions/' + id);
    } catch (error) {
      console.error('✗ Transaction silme hatası:', error);
      throw error;
    }
  }

  async getTransactions(): Promise<Transaction[]> {
    const data = await this.getData('transactions');

    if (!data) return [];

    const transactions = Object.values(data).filter((item): item is Transaction => item !== null && item !== undefined);

    return transactions.sort((a, b) => {
      const dateA = a.date ? a.date.split('.').reverse().join('') : '0';
      const dateB = b.date ? b.date.split('.').reverse().join('') : '0';
      return dateB.localeCompare(dateA);
    });
  }

  async saveBoardMembers(members: BoardMember[]): Promise<void> {
    await this.saveData('board_members', members);
  }

  async getBoardMembers(): Promise<BoardMember[]> {
    const data = await this.getData('board_members');
    return data || [];
  }

  async saveFiles(files: FileEntry[]): Promise<void> {
    await this.saveData('files', files);
  }

  async getFiles(): Promise<FileEntry[]> {
    const data = await this.getData('files');
    return data || [];
  }

  async testConnection(): Promise<boolean> {
    try {
      const testRef = ref(database, 'managements/_test');
      await set(testRef, { message: 'Test başarılı', timestamp: Date.now() });
      const result = await get(testRef);
      await remove(testRef);
      return result.exists();
    } catch (error) {
      console.error('Firebase test hatası:', error);
      return false;
    }
  }

  // Legacy alias - routes to deleteManagement
  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteManagement(sessionId);
  }

  async clearAllData(): Promise<void> {
    await this.deleteData('');
  }
}

export const db = new DatabaseService();
