
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
import RegisterView from './components/RegisterView.tsx';
import FilesView from './components/FilesView.tsx';
import MenuView from './components/MenuView.tsx';
import MemberRegistrationView from './components/MemberRegistrationView.tsx';
import ExitView from './components/ExitView.tsx';
import { BuildingInfo, ActiveTab, Transaction, Unit, BoardMember, FileEntry, BalanceSummary, AppUser } from './types.ts';
import { calculateUnitBalance } from './services/ledgerService.ts';
import type { LedgerTransaction } from './services/ledgerService.ts';
import { db } from './databaseService.ts';
import { auth, db as firestoreDb, onAuthStateChanged, logoutUser } from './firebaseConfig.ts';
import { doc, getDoc } from 'firebase/firestore';
import { useBackButton } from './useBackButton.ts';

const STORAGE_KEYS = {
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

const App: React.FC = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [mgmtLoading, setMgmtLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showRegister, setShowRegister] = useState(() => window.location.pathname === '/register');

  const [isExited, setIsExited] = useState(() => sessionStorage.getItem(STORAGE_KEYS.EXITED) === 'true');
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [activeSubView, setActiveSubView] = useState<string | null>(null);
  useBackButton(activeTab, activeSubView, setActiveTab, setActiveSubView);

  const [managements, setManagements] = useState<{ id: string; name: string }[]>([]);
  const [activeMgmtId, setActiveMgmtId] = useState<string | null>(null);

  const loadedIdRef = useRef<string>('');

  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo>(DEFAULT_BUILDING_INFO);
  const [units, setUnits] = useState<Unit[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // Firebase Auth global listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const docRef = doc(firestoreDb, 'users', user.uid);
          const docSnap = await getDoc(docRef);

          console.log("AUTH USER UID:", user?.uid);
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("FIRESTORE DATA:", data);
            console.log("ROLE:", data?.role);
            setCurrentUser({
              uid: user.uid,
              email: data.email,
              role: data.role,
              managementIds: data.managementIds || [],
              managementId: data.managementId ?? null,
              unitId: data.unitId ?? null
            });
            setIsAdmin(data.role === 'admin');
            setIsExited(false);
            sessionStorage.removeItem(STORAGE_KEYS.EXITED);
          } else {
            console.error('User doc bulunamadı:', user.uid);
            setCurrentUser(null);
            setIsAdmin(false);
          }
        } catch (err) {
          console.error('User doc okunamadı:', err);
          setCurrentUser(null);
          setIsAdmin(false);
        }
      } else {
        setCurrentUser(null);
        setIsAdmin(false);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore: Kullanıcıya ait yönetim listesini yükle
  useEffect(() => {
    if (!currentUser) {
      setMgmtLoading(false);
      return;
    }
    if (currentUser.role === 'resident' && currentUser.managementId) {
      setActiveMgmtId(currentUser.managementId);
      setMgmtLoading(false);
      return;
    }
    const storageKey = `galata_active_mgmt_${currentUser.uid}`;
    const savedId = localStorage.getItem(storageKey);

    setMgmtLoading(true);
    db.getUserManagements()
      .then((list) => {
        setManagements(list.map((m) => ({ id: m.id, name: m.name ?? '' })));
        const ids = list.map((m) => m.id);
        let nextId: string | null;
        if (list.length === 0) {
          nextId = null;
        } else if (savedId && ids.includes(savedId)) {
          nextId = savedId;
        } else {
          nextId = list[0].id;
        }
        setActiveMgmtId(nextId);
      })
      .finally(() => setMgmtLoading(false));
  }, [currentUser]);

  // activeMgmtId değişince Firestore'dan verileri yükle
  useEffect(() => {
    if (activeMgmtId === null) {
      setBuildingInfo(DEFAULT_BUILDING_INFO);
      setUnits([]);
      setTransactions([]);
      setBoardMembers([]);
      setFiles([]);
      loadedIdRef.current = '';
      return;
    }

    setBuildingInfo(DEFAULT_BUILDING_INFO);
    setUnits([]);
    setTransactions([]);
    setBoardMembers([]);
    setFiles([]);

    db.setCurrentSession(activeMgmtId);

    Promise.all([
      db.getBuildingInfo(),
      db.getUnits(),
      db.getBoardMembers(),
      db.getFiles()
    ]).then(([info, u, board, fs]) => {
      setBuildingInfo(info ?? DEFAULT_BUILDING_INFO);
      setUnits(u ?? []);
      setBoardMembers(board ?? []);
      setFiles(fs ?? []);
      loadedIdRef.current = activeMgmtId;
    });

    // Transactions: realtime onSnapshot listener
    const unsub = db.subscribeLedgerEntries(activeMgmtId, (txs) => {
      setTransactions(txs);
    });
    return () => unsub();
  }, [activeMgmtId]);

  // Firestore'a kaydet
  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) return;
    if (activeMgmtId === null) return;
    if (activeMgmtId !== loadedIdRef.current) return;

    db.saveBuildingInfo(buildingInfo, activeMgmtId).catch((e) => console.error('saveBuildingInfo', e));
    db.saveUnits(units, activeMgmtId).catch((e) => console.error('saveUnits', e));
    db.saveBoardMembers(boardMembers, activeMgmtId).catch((e) => console.error('saveBoardMembers', e));
    db.saveFiles(files, activeMgmtId).catch((e) => console.error('saveFiles', e));

    if (buildingInfo.name !== DEFAULT_BUILDING_INFO.name) {
      setManagements((prev) => prev.map((m) => (m.id === activeMgmtId ? { ...m, name: buildingInfo.name } : m)));
    }
  }, [authLoading, currentUser, buildingInfo, units, boardMembers, files, activeMgmtId]);

  // activeMgmtId değişince uid-bazlı localStorage'a yaz
  useEffect(() => {
    if (currentUser?.uid && activeMgmtId !== null) {
      localStorage.setItem(`galata_active_mgmt_${currentUser.uid}`, activeMgmtId);
    }
  }, [activeMgmtId, currentUser]);

  // --- Management Lifecycle Handlers ---

  const handleSwitchMgmt = (id: string) => {
    loadedIdRef.current = 'switching';
    db.switchManagement(id);
    setActiveMgmtId(id);
    setActiveTab('home');
    setActiveSubView(null);
  };

  const handleCreateMgmt = async (data: any) => {
    try {
      const newId = await db.createManagement(data.name);
      const newMgmt = { id: newId, name: data.name };

      db.setCurrentSession(newId);
      const buildingData: BuildingInfo = { ...DEFAULT_BUILDING_INFO, ...data };
      await db.saveBuildingInfo(buildingData);

      setManagements((prev) => [...prev, newMgmt]);
      setBuildingInfo(buildingData);
      setActiveMgmtId(newId);
      loadedIdRef.current = newId;
    } catch (error) {
      console.error('Yönetim oluşturma hatası:', error);
    }
  };

  const handleCreateInvite = async (unitId: string) => {
    if (!activeMgmtId) throw new Error('activeMgmtId is not set');
    const inviteId = await db.createInvite(activeMgmtId, unitId);
    return `${window.location.origin}/register?mgmtId=${encodeURIComponent(activeMgmtId)}&inviteId=${encodeURIComponent(inviteId)}`;
  };

  const handleDeleteMgmt = async (id: string) => {
    await db.archiveManagement(id, 'ui_archive_request');
    setManagements((prev) => prev.filter((m) => m.id !== id));
    if (activeMgmtId === id) {
      loadedIdRef.current = '';
      setActiveMgmtId(null);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    sessionStorage.setItem(STORAGE_KEYS.EXITED, 'true');
    setIsExited(true);
  };

  const exemptUnitId = (buildingInfo?.isManagerExempt && buildingInfo?.managerUnitId) ? buildingInfo.managerUnitId : undefined;

  const unitsWithBalances = useMemo(() => {
    // Map Transaction[] → LedgerTransaction[]
    // Use persisted direction when available (ledger-generated txs),
    // fall back to type-based mapping for legacy/UI-created txs.
    const ledgerTxs: LedgerTransaction[] = transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      direction: (tx.direction ?? (tx.type === 'GELİR' ? 'CREDIT' : 'DEBIT')) as 'DEBIT' | 'CREDIT',
      amount: Number(tx.amount),
      unitId: tx.unitId,
      periodMonth: tx.periodMonth,
      periodYear: tx.periodYear
    }));

    return units.map(unit => {
      if (unit.id === exemptUnitId) return { ...unit, credit: 0, debt: 0 };

      const balance = calculateUnitBalance(unit.id, ledgerTxs);
      return { ...unit, credit: Math.max(0, -balance), debt: Math.max(0, balance) };
    });
  }, [units, transactions, exemptUnitId]);

  const balance: BalanceSummary = useMemo(() => {
    const isDemirbas = (tx: Transaction) => tx.description.includes('[demirbas]');
    const isCredit = (tx: Transaction) => tx.direction === 'CREDIT' || (!tx.direction && tx.type === 'GELİR');

    let genCredit = 0, genDebit = 0, demCredit = 0, demDebit = 0;
    for (const tx of transactions) {
      const amt = Number(tx.amount);
      if (isDemirbas(tx)) {
        if (isCredit(tx)) demCredit += amt; else demDebit += amt;
      } else {
        if (isCredit(tx)) genCredit += amt; else genDebit += amt;
      }
    }

    const mevcutBakiye = genCredit - genDebit;
    const alacakBakiyesi = unitsWithBalances.reduce((s, u) => s + u.debt, 0);
    return { mevcutBakiye, alacakBakiyesi, toplam: mevcutBakiye + alacakBakiyesi, demirbasKasasi: demCredit - demDebit };
  }, [unitsWithBalances, transactions]);

  const handleAddTx = (amt: number, desc: string, type: Transaction['type'], vault: string, date?: string, unitId?: string, m?: number, y?: number) => {
    const formattedDate = date ? (date.includes('-') ? date.split('-').reverse().join('.') : date) : new Date().toLocaleDateString('tr-TR');
    const newTx: Transaction = { id: Math.random().toString(36).slice(2), type, amount: Number(amt), description: `${desc} [${vault}]`, unitId, date: formattedDate, periodMonth: m, periodYear: y };
    // TODO(ledger-migration): Remove legacy transaction adapter and send ledger-native payload.
    db.createTransactionFromLegacy(newTx, activeMgmtId ?? undefined).catch((e) => console.error('createTransactionFromLegacy', e));
    setActiveSubView('history');
  };

  const handleEditTx = async (tx: Transaction) => {
    const mgmtId = activeMgmtId ?? undefined;
    if (!mgmtId) return;
    // TODO(ledger-migration): Replace with dedicated UI for reversal + corrected entry creation.
    await db.reverseLedgerEntry(tx.id, 'legacy_edit_adapter', mgmtId);
    const replacement: Transaction = { ...tx, id: `${tx.id}_edit_${Date.now().toString(36)}` };
    await db.createTransactionFromLegacy(replacement, mgmtId);
  };

  console.log("RENDER STATE:", { authLoading, currentUser, isAdmin, activeMgmtId });

  if (authLoading || mgmtLoading) {
    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-zinc-500 text-xs uppercase tracking-widest">Yükleniyor...</span>
      </div>
    );
  }

  if (isExited) {
    return <ExitView onRestart={() => { setIsExited(false); sessionStorage.removeItem(STORAGE_KEYS.EXITED); }} />;
  }

  if (!currentUser) {
    if (showRegister) {
      return <RegisterView onBackToLogin={() => setShowRegister(false)} />;
    }
    return <LoginView buildingName={buildingInfo?.name} onShowRegister={() => setShowRegister(true)} />;
  }

  if (currentUser.role === 'resident' && !currentUser.unitId) {
    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col items-center justify-center gap-4 px-8">
        <span className="text-white font-black text-lg uppercase tracking-widest text-center">Hesap Eşleştirme Bekleniyor</span>
        <span className="text-zinc-500 text-xs text-center">Yönetici daveti ile daire eşleştirmesi tamamlandığında giriş yapabilirsiniz.</span>
        <button onClick={handleLogout} className="text-zinc-600 text-xs underline mt-2">Çıkış Yap</button>
      </div>
    );
  }

  if (isAdmin && activeMgmtId === null) {
    return (
      <div className="fixed inset-0 bg-[#020617] flex flex-col items-center justify-center gap-4 px-8">
        <span className="text-white font-black text-lg uppercase tracking-widest text-center">Henüz Yönetim Tanımlanmadı</span>
        <span className="text-zinc-500 text-xs text-center">Yeni bir yönetim oluşturmak için aşağıdaki butona tıklayın.</span>
        <button
          onClick={() => setActiveTab('sessions')}
          className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest"
        >
          Yönetim Oluştur
        </button>
        <button onClick={handleLogout} className="text-zinc-600 text-xs underline mt-2">Çıkış Yap</button>
      </div>
    );
  }

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
          activeSubView === 'units' ? <UnitsView isAdmin={isAdmin} units={unitsWithBalances} transactions={transactions} info={buildingInfo} onClose={() => setActiveSubView(null)} onAddUnit={u => setUnits(p => [...p, { ...u, id: Math.random().toString(36).slice(2), credit: 0, debt: 0 }])} onEditUnit={u => setUnits(p => p.map(x => x.id === u.id ? u : x))} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} onCreateInvite={handleCreateInvite} /> :
          activeSubView === 'history' ? <TransactionsView isAdmin={isAdmin} transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} onAddFile={() => {}} onDeleteTransaction={id => { db.voidLedgerEntry(id, 'legacy_delete_adapter', activeMgmtId ?? undefined).catch(e => console.error('voidLedgerEntry', e)); }} onUpdateTransaction={tx => { handleEditTx(tx).catch(e => console.error('handleEditTx', e)); }} /> :
          activeSubView === 'receivables' ? <ReceivablesView units={unitsWithBalances} onClose={() => setActiveSubView(null)} /> :
          activeSubView === 'aidat-cizelge' ? <AidatCizelgeView units={unitsWithBalances} transactions={transactions} info={buildingInfo} onClose={() => setActiveSubView(null)} onAddDues={() => {}} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'monthly-report' ? <MonthlyReportView transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'yearly-report' ? <YearlyReportView transactions={transactions} units={unitsWithBalances} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddFile={(n, c, d) => setFiles(p => [...p, { id: Math.random().toString(36).slice(2), name: n, category: c, date: new Date().toLocaleDateString('tr-TR'), size: '1 MB', extension: 'pdf', data: d }])} /> :
          activeSubView === 'board' ? <BoardView members={boardMembers} onClose={() => setActiveSubView(null)} buildingName={buildingInfo.name} onAddMember={m => setBoardMembers(p => [...p, { ...m, id: Math.random().toString(36).slice(2) }])} onDeleteMember={id => setBoardMembers(p => p.filter(x => x.id !== id))} onClearAll={() => setBoardMembers([])} /> :
          activeSubView === 'member-registration' ? <MemberRegistrationView onClose={() => setActiveSubView(null)} onSave={u => setUnits(p => [...p, { ...u, id: Math.random().toString(36).slice(2), credit: 0, debt: 0 }])} /> : null
        ) : (
          activeTab === 'menu' ? <MenuView isAdmin={isAdmin} onActionClick={(sv, tab) => { if(tab) setActiveTab(tab); else setActiveSubView(sv); }} /> :
          activeTab === 'settings' ? <SettingsView buildingInfo={buildingInfo} onUpdateBuildingInfo={setBuildingInfo} units={unitsWithBalances} onResetMoney={() => { db.archiveAllLedgerEntries(activeMgmtId ?? undefined).catch(e => console.error('archiveAllLedgerEntries', e)); }} onClearFiles={() => setFiles([])} onDeleteSession={activeMgmtId ? () => handleDeleteMgmt(activeMgmtId) : undefined} mgmtId={activeMgmtId ?? undefined} /> :
          activeTab === 'home' ? (
            <div className="space-y-2 pt-1 pb-2">
              <SummaryCard balance={balance} />
              <ActionGrid isAdmin={isAdmin} onActionClick={a => { const m: any = { 'TAHSİLAT': 'tahsilat', 'BORÇLANDIR': 'borclandir', 'İADE': 'iade', 'GELİR': 'gelir', 'GİDER': 'gider', 'TRANSFER': 'transfer', 'BAĞIMSIZ BÖLÜMLER': 'units', 'İŞLEM HAREKETLERİ': 'history', 'ALACAK LİSTESİ': 'receivables', 'ÜYE KAYDI': 'member-registration' }; if (m[a]) setActiveSubView(m[a]); }} />
              <SecondaryWidgets onActionClick={a => { const m: any = { 'AİDAT ÇİZELGE': 'aidat-cizelge', 'AYLIK BİLANÇO': 'monthly-report', 'YILLIK BİLANÇO': 'yearly-report' }; if (m[a]) setActiveSubView(m[a]); }} />
              <LastTransaction transaction={transactions[0] || null} />
            </div>
          ) :
          activeTab === 'sessions' ? <SessionsView buildingInfo={buildingInfo} onUpdateInfo={setBuildingInfo} managements={managements} activeId={activeMgmtId ?? ''} onClose={() => setActiveTab('home')} onSwitch={handleSwitchMgmt} onCreate={handleCreateMgmt} onDelete={handleDeleteMgmt} /> :
          activeTab === 'files' ? <FilesView files={files} onAddFile={f => setFiles(p => [...p, { ...f, id: Math.random().toString(36).slice(2) }])} onDeleteFile={id => setFiles(p => p.filter(x => x.id !== id))} /> : null
        )}
      </main>
      <BottomNav activeTab={activeTab} isAdmin={isAdmin} onTabChange={t => { setActiveTab(t); setActiveSubView(null); }} />
    </div>
  );
};

export default App;
