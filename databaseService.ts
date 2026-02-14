import { ref, set, get, update, remove, onValue, off } from 'firebase/database';
import { database } from './firebaseConfig';
import { BuildingInfo, Unit, Transaction, BoardMember, FileEntry } from './types';

class DatabaseService {
  private currentSessionId: string = 'galata_v16';

  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    console.log('📌 Aktif oturum değiştirildi:', sessionId);
  }

  getCurrentSession(): string {
    return this.currentSessionId;
  }

  async saveData(key: string, data: any): Promise<void> {
    try {
      const dataRef = ref(database, `${this.currentSessionId}/${key}`);
      await set(dataRef, data);
    } catch (error) {
      console.error('Database save error:', error);
      throw error;
    }
  }

  async getData(key: string): Promise<any> {
    try {
      const dataRef = ref(database, `${this.currentSessionId}/${key}`);
      const snapshot = await get(dataRef);
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error('Database get error:', error);
      throw error;
    }
  }

  async updateData(key: string, updates: any): Promise<void> {
    try {
      const dataRef = ref(database, `${this.currentSessionId}/${key}`);
      await update(dataRef, updates);
    } catch (error) {
      console.error('Database update error:', error);
      throw error;
    }
  }

  async deleteData(key: string): Promise<void> {
    try {
      const dataRef = ref(database, `${this.currentSessionId}/${key}`);
      await remove(dataRef);
    } catch (error) {
      console.error('Database delete error:', error);
      throw error;
    }
  }

  subscribeToData(key: string, callback: (data: any) => void): () => void {
    const dataRef = ref(database, `${this.currentSessionId}/${key}`);
    
    onValue(dataRef, (snapshot) => {
      const data = snapshot.exists() ? snapshot.val() : null;
      callback(data);
    });

    return () => off(dataRef);
  }

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
      const testRef = ref(database, '_test');
      await set(testRef, { message: 'Test başarılı', timestamp: Date.now() });
      const result = await get(testRef);
      return result.exists();
    } catch (error) {
      console.error('Firebase test hatası:', error);
      return false;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      console.log('🗑️ Oturum siliniyor:', sessionId);
      const sessionRef = ref(database, sessionId);
      await remove(sessionRef);
      console.log('✓ Oturum Firebase\'den silindi:', sessionId);
    } catch (error) {
      console.error('✗ Oturum silme hatası:', error);
      throw error;
    }
  }

  async clearAllData(): Promise<void> {
    await this.deleteData('');
  }
}

export const db = new DatabaseService();
