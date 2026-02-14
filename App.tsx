
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Header from './components/Header.tsx';
import SummaryCard from './components/SummaryCard.tsx';
import ActionGrid from './components/ActionGrid.tsx';
import BottomNav from './components/BottomNav.tsx';
import SecondaryWidgets from './components/SecondaryWidgets.tsx';
import LastTransaction from './components/LastTransaction.tsx';
import SettingsView from './components/SettingsView.tsx';
import TahsilatView from './components/TahsilatView.tsx';
import GiderView from './components/GiderView.tsx';
import BorclandirView from './components/BorclandirView.tsx';
import IadeView from './components/IadeView.tsx';
import GelirView from './components/GelirView.tsx';
import TransferView from './components/TransferView.tsx';
import UnitsView from './components/UnitsView.tsx';
import TransactionsView from './components/TransactionsView.tsx';
import ReceivablesView from './components/ReceivablesView.tsx';
import AidatCizelgeView from './components/AidatCizelgeView.tsx';
import MonthlyReportView from './components/MonthlyReportView.tsx';
import YearlyReportView from './components/YearlyReportView.tsx';
import BoardView from './components/BoardView.tsx';
import SessionsView from './components/SessionsView.tsx';
import LoginView from './components/LoginView.tsx';
import FilesView from './components/FilesView.tsx';
import MenuView from './components/MenuView.tsx';
import MemberRegistrationView from './components/MemberRegistrationView.tsx';
import ExitView from './components/ExitView.tsx';
import { BuildingInfo, ActiveTab, Transaction, Unit, BoardMember, FileEntry, BalanceSummary } from './types.ts';

const REGISTRY_KEY = 'galata_v16_mgmt_registry';
const ACTIVE_MGMT_ID_KEY = 'galata_v16_active_mgmt_id';

const STORAGE_KEYS = {
  AUTH: 'galata_v16_auth',
  ROLE: 'galata_v16_role',
  EXITED: 'galata_v16_is_exited'
};

const DEFAULT_BUILDING_INFO: BuildingInfo = { 
  name: "BİNA ADI TANIMLANMADI", 
  address: "", 
  role: "Yönetici", 
  managerName: "",
  taxNo: "",
  duesAmount: 0,
  isManagerExempt: false, 
  managerUnitId: '', 
  isAutoDuesEnabled: true
};

const loadFromStorage = (key: string, defaultValue: any) => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored || stored === 'null' || stored === 'undefined') return defaultValue;
    return JSON.parse(stored);
  } catch (e) { 
    return defaultValue; 
  }
};

const App: React.FC = () => {
  const [isExited, setIsExited] = useState(() => sessionStorage.getItem(STORAGE_KEYS.EXITED) === 'true');
  const [isAuthenticated, setIsAuthenticated] = useState(() => 
    localStorage.getItem(STORAGE_KEYS.AUTH) === 'true' || sessionStorage.getItem(STORAGE_KEYS.AUTH) === 'true'
  );
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem(STORAGE_KEYS.ROLE) === 'admin');
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [activeSubView, setActiveSubView] = useState<string | null>(null);
  // Geri tu�u handler
  useBackButton(activeTab, activeSubView, setActiveTab, setActiveSubView);


  const [managements, setManagements] = useState<{id: string, name: string}[]>(() => loadFromStorage(REGISTRY_KEY, []));
  const [activeMgmtId, setActiveMgmtId] = useState<string>(() => localStorage.getItem(ACTIVE_MGMT_ID_KEY) || '');

  // VERİLERİN YÜKLENME DURUMUNU TAKİP EDEN KİLİT
  const loadedIdRef = useRef<string>(activeMgmtId);

  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo>(DEFAULT_BUILDING_INFO);
  const [units, setUnits] = useState<Unit[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // 1. ADIM: VERİLERİ YÜKLEME
  useEffect(() => {
    if (!activeMgmtId) {
      setBuildingInfo(DEFAULT_BUILDING_INFO);
      setUnits([]);
      setTransactions([]);
      setBoardMembers([]);
      setFiles([]);
      loadedIdRef.current = '';
      return;
    }

    const prefix = `galata_v16_${activeMgmtId}_`;
    const loadedInfo = loadFromStorage(`${prefix}info`, DEFAULT_BUILDING_INFO);
    const loadedUnits = loadFromStorage(`${prefix}units`, []);
    const loadedTxs = loadFromStorage(`${prefix}transactions`, []);
    const loadedBoard = loadFromStorage(`${prefix}board`, []);
    const loadedFiles = loadFromStorage(`${prefix}files`, []);

    setBuildingInfo(loadedInfo);
    setUnits(loadedUnits);
    setTransactions(loadedTxs);
    setBoardMembers(loadedBoard);
    setFiles(loadedFiles);
    
    // ÖNEMLİ: Veriler yüklendi, artık bu ID için kaydetme yapılabilir
    loadedIdRef.current = activeMgmtId;
  }, [activeMgmtId]);

  // 2. ADIM: VERİLERİ KAYDETME
  useEffect(() => {
    // KRİTİK KONTROL: Sadece state'deki veriler o anki aktif ID'ye aitse kaydet
    // Bu sayede eski ID'nin verileri yeni ID üzerine yazılmaz
    if (!activeMgmtId || activeMgmtId !== loadedIdRef.current) return;

    const prefix = `galata_v16_${activeMgmtId}_`;
    localStorage.setItem(`${prefix}info`, JSON.stringify(buildingInfo));
    localStorage.setItem(`${prefix}units`, JSON.stringify(units));
    localStorage.setItem(`${prefix}transactions`, JSON.stringify(transactions));
    localStorage.setItem(`${prefix}board`, JSON.stringify(boardMembers));
    localStorage.setItem(`${prefix}files`, JSON.stringify(files));
    
    // Registry ismini güncelle
    if (buildingInfo.name !== DEFAULT_BUILDING_INFO.name) {
      setManagements(prev => prev.map(m => m.id === activeMgmtId ? { ...m, name: buildingInfo.name } : m));
    }
  }, [buildingInfo, units, transactions, boardMembers, files, activeMgmtId]);

  useEffect(() => {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(managements));
  }, [managements]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_MGMT_ID_KEY, activeMgmtId);
  }, [activeMgmtId]);

  const handleSwitchMgmt = (id: string) => {
    // Geçiş anında kaydetmeyi durdurmak için ref'i hemen sıfırla
    loadedIdRef.current = 'switching';
    db.setCurrentSession(id);
    console.log('?? Oturum de�i�tirildi:', id); 
    setActiveMgmtId(id);
    setActiveTab('home');
    setActiveSubView(null);
  };

    const handleCreateMgmt = (data: any) => {
    const newId = `mgmt_${Date.now()}`;
    const newMgmt = { id: newId, name: data.name };

    // Yeni oturum ID'sini ayarla
    db.setCurrentSession(newId);
    console.log('?? Yeni y�netim olu�turuldu:', newId, data.name);

    // Yeni y�netim bilgilerini Firebase'e kaydet
    db.saveBuildingInfo(data).then(() => {
      console.log('? Yeni y�netim Firebase\'e kaydedildi');
    });

    setManagements(prev => [...prev, newMgmt]);
    setBuildingInfo(data);
    setActiveMgmtId(newId);
  };

  const handleDeleteMgmt = async (id: string) => {
    // Firebase'den sil
    await db.deleteSession(id);
    
    // localStorage'dan sil
    const prefix = `galata_v16_${id}_`;
    localStorage.removeItem(`${prefix}info`);
    localStorage.removeItem(`${prefix}units`);
    localStorage.removeItem(`${prefix}transactions`);
    localStorage.removeItem(`${prefix}board`);
    localStorage.removeItem(`${prefix}files`);

    setManagements(prev => prev.filter(m => m.id !== id));
    if (activeMgmtId === id) {
      loadedIdRef.current = '';
      setActiveMgmtId('');
    }
  };

  const unitsWithBalances = useMemo(() => {
    const now = new Date();
    const currentMonthIdx = now.getMonth();
    const currentYear = now.getFullYear();
    const duesValue = Number(buildingInfo?.duesAmount) || 0;

    return units.map(unit => {
      const isExempt = buildingInfo?.isManagerExempt && unit.id === buildingInfo?.managerUnitId;
      if (isExempt) return { ...unit, credit: 0, debt: 0 };
      const totalIncome = transactions.filter(tx => tx.unitId === unit.id && tx.type === 'GELİR').reduce((s, tx) => s + Number(tx.amount), 0);
      const totalManualDebt = transactions.filter(tx => tx.unitId === unit.id && tx.type === 'BORÇLANDIRMA').reduce((s, tx) => s + Number(tx.amount), 0);
      let runningCredit = totalIncome - totalManualDebt;
      let totalDebtAccrued = 0;
      if (buildingInfo?.isAutoDuesEnabled && duesValue > 0) {
        for (let m = 0; m <= currentMonthIdx; m++) {
          const hasManual = transactions.some(tx => tx.unitId === unit.id && tx.type === 'BORÇLANDIRMA' && tx.periodMonth === m && tx.periodYear === currentYear);
          if (!hasManual) { if (runningCredit >= duesValue) runningCredit -= duesValue; else totalDebtAccrued += duesValue; }
        }
      }
      return { ...unit, credit: Math.max(0, runningCredit), debt: Math.max(0, totalDebtAccrued) };
    });
  }, [units, transactions, buildingInfo]);

  const balance: BalanceSummary = useMemo(() => {
    const income = transactions.filter(tx => tx.type === 'GELİR' && !tx.description.includes('[demirbas]')).reduce((s, t) => s + Number(t.amount), 0);
    const expense = transactions.filter(tx => tx.type === 'GİDER' && !tx.description.includes('[demirbas]')).reduce((s, t) => s + Number(t.amount), 0);
    const demIncome = transactions.filter(tx => tx.type === 'GELİR' && tx.description.includes('[demirbas]')).reduce((s, t) => s + Number(t.amount), 0);
    const demExpense = transactions.filter(tx => tx.type === 'GİDER' && tx.description.includes('[demirbas]')).reduce((s, t) => s + Number(t.amount), 0);
    return { mevcutBakiye: income - expense, alacakBakiyesi: unitsWithBalances.reduce((s, u) => s + u.debt, 0), toplam: (income - expense) + unitsWithBalances.reduce((s, u) => s + u.debt, 0), demirbasKasasi: demIncome - demExpense };
  }, [unitsWithBalances, transactions]);

  const handleAddTx = (amt: number, desc: string, type: Transaction['type'], vault: string, date?: string, unitId?: string, m?: number, y?: number) => {
    const formattedDate = date ? (date.includes('-') ? date.split('-').reverse().join('.') : date) : new Date().toLocaleDateString('tr-TR');
    const newTx: Transaction = { id: Math.random().toString(36).slice(2), type, amount: Number(amt), description: `${desc} [${vault}]`, unitId, date: formattedDate, periodMonth: m, periodYear: y };
    setTransactions(p => [newTx, ...p]);
    setActiveSubView('history');
  };

  const handleLogin = (role: 'admin' | 'resident', remember: boolean) => {
    const s = remember ? localStorage : sessionStorage;
    s.setItem(STORAGE_KEYS.AUTH, 'true');
    localStorage.setItem(STORAGE_KEYS.ROLE, role);
    setIsAdmin(role === 'admin'); setIsAuthenticated(true); setIsExited(false);
    sessionStorage.removeItem(STORAGE_KEYS.EXITED);
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEYS.AUTH); sessionStorage.removeItem(STORAGE_KEYS.AUTH);
    setIsAuthenticated(false); setIsExited(true); sessionStorage.setItem(STORAGE_KEYS.EXITED, 'true');
  };

  if (isExited) return <ExitView onRestart={() => { setIsExited(false); sessionStorage.removeItem(STORAGE_KEYS.EXITED); }} />;
  if (!isAuthenticated) return <LoginView onLogin={handleLogin} buildingName={buildingInfo?.name} />;

  return (
    <div className="app-gradient text-white pb-24 max-w-md mx-auto shadow-2xl relative min-h-screen">
      {!activeSubView && activeTab === 'home' && <Header info={buildingInfo} onLogout={handleLogout} isAdmin={isAdmin} />}
      <main className="px-4">
        {activeSubView ? (
          activeSubView === 'tahsilat' ? <TahsilatView units={unitsWithBalances} info={buildingInfo} transactions={transactions} onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt,uid,m,y) => handleAddTx(a,d,'GELİR',v,dt,uid,m,y)} /> :
          activeSubView === 'gider' ? <GiderView onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt) => handleAddTx(a,d,'GİDER',v,dt)} /> :
          activeSubView === 'borclandir' ? <BorclandirView units={unitsWithBalances} info={buildingInfo} onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt,uid,m,y) => handleAddTx(a,d,'BORÇLANDIRMA',v,dt,uid,m,y)} /> :
          activeSubView === 'gelir' ? <GelirView onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt) => handleAddTx(a,d,'GELİR',v,dt)} /> :
          activeSubView === 'iade' ? <IadeView units={unitsWithBalances} info={buildingInfo} onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt,uid) => handleAddTx(a,d,'GİDER',v,dt,uid)} /> :
          activeSubView === 'transfer' ? <TransferView onClose={() => setActiveSubView(null)} onSave={(a,d,v,dt) => handleAddTx(a,d,'TRANSFER',v,dt)} /> :
          activeSubView === 'units' ? <UnitsView isAdmin={isAdmin} units={unitsWithBalances} transactions={transactions} info={buildingInfo} onClose={() => setActiveSubView(null)} onAddUnit={u => setUnits(p => [...p, { ...u, id: Math.random().toString(36).slice(2), credit: 0, debt: 0 }])} onEditUnit={u => setUnits(p => p.map(x => x.id === u.id ? u : x))} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'history' ? <TransactionsView isAdmin={isAdmin} transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} onAddFile={() => {}} onDeleteTransaction={id => setTransactions(p => p.filter(x => x.id !== id))} onUpdateTransaction={tx => setTransactions(p => p.map(x => x.id === tx.id ? tx : x))} /> :
          activeSubView === 'receivables' ? <ReceivablesView units={unitsWithBalances} onClose={() => setActiveSubView(null)} /> :
          activeSubView === 'aidat-cizelge' ? <AidatCizelgeView units={unitsWithBalances} transactions={transactions} info={buildingInfo} onClose={() => setActiveSubView(null)} onAddDues={() => {}} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'monthly-report' ? <MonthlyReportView transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'yearly-report' ? <YearlyReportView transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'board' ? <BoardView members={boardMembers} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddMember={m => setBoardMembers(p => [...p, { ...m, id: Math.random().toString(36).slice(2) }])} onDeleteMember={id => setBoardMembers(p => p.filter(x => x.id !== id))} onClearAll={() => setBoardMembers([])} /> : 
          activeSubView === 'member-registration' ? <MemberRegistrationView onClose={() => setActiveSubView(null)} onSave={u => setUnits(p => [...p, { ...u, id: Math.random().toString(36).slice(2), credit: 0, debt: 0 }])} /> : null
        ) : (
          activeTab === 'menu' ? <MenuView isAdmin={isAdmin} onActionClick={(sv, tab) => { if(tab) setActiveTab(tab); else setActiveSubView(sv); }} /> :
          activeTab === 'settings' ? <SettingsView buildingInfo={buildingInfo} onUpdateBuildingInfo={setBuildingInfo} units={unitsWithBalances} onResetMoney={() => setTransactions([])} onClearFiles={() => setFiles([])} onDeleteSession={activeMgmtId ? () => handleDeleteMgmt(activeMgmtId) : undefined} /> :
          activeTab === 'home' ? (
            <div className="space-y-2 pt-1 pb-2">
              <SummaryCard balance={balance} />
              <ActionGrid isAdmin={isAdmin} onActionClick={a => { const m: any = { 'TAHSİLAT': 'tahsilat', 'BORÇLANDIR': 'borclandir', 'İADE': 'iade', 'GELİR': 'gelir', 'GİDER': 'gider', 'TRANSFER': 'transfer', 'BAĞIMSIZ BÖLÜMLER': 'units', 'İŞLEM HAREKETLERİ': 'history', 'ALACAK LİSTESİ': 'receivables', 'ÜYE KAYDI': 'member-registration' }; if (m[a]) setActiveSubView(m[a]); }} />
              <SecondaryWidgets onActionClick={a => { const m: any = { 'AİDAT ÇİZELGE': 'aidat-cizelge', 'AYLIK BİLANÇO': 'monthly-report', 'YILLIK BİLANÇO': 'yearly-report' }; if (m[a]) setActiveSubView(m[a]); }} />
              <LastTransaction transaction={transactions[0] || null} />
            </div>
          ) :
          activeTab === 'sessions' ? <SessionsView buildingInfo={buildingInfo} onUpdateInfo={setBuildingInfo} managements={managements} activeId={activeMgmtId} onClose={() => setActiveTab('home')} onSwitch={handleSwitchMgmt} onCreate={handleCreateMgmt} onDelete={handleDeleteMgmt} /> : 
          activeTab === 'files' ? <FilesView files={files} onAddFile={f => setFiles(p => [...p, { ...f, id: Math.random().toString(36).slice(2) }])} onDeleteFile={id => setFiles(p => p.filter(x => x.id !== id))} /> : null
        )}
      </main>
      <BottomNav activeTab={activeTab} isAdmin={isAdmin} onTabChange={t => { setActiveTab(t); setActiveSubView(null); }} />
    </div>
  );
};

export default App;












