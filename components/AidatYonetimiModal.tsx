
import React, { useState, useEffect } from 'react';
import { X, Plus, Loader2, Check, Calendar, AlertTriangle } from 'lucide-react';
import { collection, getDocs, getDoc, addDoc, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db as firestoreDb } from '../firebaseConfig.ts';
import { generateMonthlyDuesAndCommit, getDuesForPeriod } from '../services/ledgerService.ts';
import type { AidatRate } from '../services/ledgerService.ts';

interface AidatYonetimiModalProps {
  mgmtId: string;
  currentDuesAmount: number;
  onClose: () => void;
}

interface FirestoreRate {
  id: string;
  amount: number;
  startDate: string; // ISO string stored in Firestore
  archived?: boolean;
}

const AidatYonetimiModal: React.FC<AidatYonetimiModalProps> = ({ mgmtId, currentDuesAmount, onClose }) => {
  // --- Rate list state (realtime) ---
  const [rates, setRates] = useState<FirestoreRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);

  // --- Add form state ---
  const [newAmount, setNewAmount] = useState('');
  const [newStartDate, setNewStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [addLoading, setAddLoading] = useState(false);

  // --- Generate state ---
  const [generatePhase, setGeneratePhase] = useState<'idle' | 'previewing' | 'committing' | 'done'>('idle');
  const [previewCount, setPreviewCount] = useState(0);
  const [commitResult, setCommitResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- onSnapshot for aidatRates ---
  useEffect(() => {
    if (!mgmtId) return;
    const col = collection(firestoreDb, 'managements', mgmtId, 'aidatRates');
    const unsub = onSnapshot(col, (snapshot) => {
      const all: FirestoreRate[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          amount: Number(data.amount) || 0,
          startDate: data.startDate ?? '',
          archived: Boolean(data.archived)
        };
      });
      // Only show active (non-archived) rates, sorted date desc
      const active = all.filter(r => !r.archived);
      active.sort((a, b) => b.startDate.localeCompare(a.startDate));
      setRates(active);
      setRatesLoading(false);
    });
    return () => unsub();
  }, [mgmtId]);

  // --- Add new rate ---
  const handleAddRate = async () => {
    if (!newAmount || parseFloat(newAmount) <= 0) return;
    setAddLoading(true);
    setError(null);
    try {
      const col = collection(firestoreDb, 'managements', mgmtId, 'aidatRates');
      await addDoc(col, {
        amount: parseFloat(newAmount),
        startDate: newStartDate
      });
      setNewAmount('');
    } catch (e: any) {
      setError(e.message || 'Rate eklenirken hata oluştu');
    } finally {
      setAddLoading(false);
    }
  };

  // --- Archive rate (immutable ledger — no delete) ---
  const handleArchiveRate = async (rateId: string) => {
    if (!window.confirm('Bu tarife arşivlenecek ve hesaplamalardan çıkarılacak. Emin misiniz?')) return;
    try {
      await updateDoc(doc(firestoreDb, 'managements', mgmtId, 'aidatRates', rateId), { archived: true });
    } catch (e: any) {
      setError(e.message || 'Rate arşivlenirken hata oluştu');
    }
  };

  // --- Dry run preview ---
  const handleDryRun = async () => {
    setGeneratePhase('previewing');
    setError(null);
    setCommitResult(null);
    try {
      const { generateMonthlyDuesDryRun } = await import('../services/ledgerService.ts');

      // Read management doc for exempt info
      const mgmtSnap = await getDoc(doc(firestoreDb, 'managements', mgmtId));
      const mgmtData = mgmtSnap.data() ?? {};

      // Read units
      const unitsSnap = await getDocs(collection(firestoreDb, 'managements', mgmtId, 'units'));
      const managerUnitId = mgmtData.managerUnitId ?? '';
      const isManagerExempt = Boolean(mgmtData.isManagerExempt);

      const units: { id: string; accountingStartDate: Date; isManagerExempt: boolean }[] = [];
      for (const d of unitsSnap.docs) {
        const data = d.data();
        const raw = data.accountingStartDate;
        if (!raw) {
          console.warn(`handleDryRun: unit ${d.id} has no accountingStartDate — skipped`);
          continue;
        }
        units.push({
          id: d.id,
          accountingStartDate: raw.toDate?.() ?? new Date(raw),
          isManagerExempt: isManagerExempt && d.id === managerUnitId
        });
      }

      // Read transactions
      const txSnap = await getDocs(collection(firestoreDb, 'managements', mgmtId, 'transactions'));
      const transactions = txSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          type: data.type ?? '',
          direction: (data.direction ?? (data.type === 'GELİR' ? 'CREDIT' : 'DEBIT')) as 'DEBIT' | 'CREDIT',
          amount: Number(data.amount) || 0,
          unitId: data.unitId,
          periodMonth: data.periodMonth,
          periodYear: data.periodYear,
          createdAt: data.createdAt?.toDate?.() ?? undefined
        };
      });

      // Build rates
      let aidatRates: AidatRate[];
      if (rates.length === 0) {
        if (currentDuesAmount <= 0) {
          throw new Error('Aidat tarifesi bulunamadı ve duesAmount 0');
        }
        aidatRates = [{ id: 'default', amount: currentDuesAmount, startDate: new Date(2000, 0, 1) }];
      } else {
        aidatRates = rates.map(r => ({
          id: r.id,
          amount: r.amount,
          startDate: new Date(r.startDate)
        }));
      }

      const newTxs = generateMonthlyDuesDryRun(units, transactions, aidatRates, new Date());
      setPreviewCount(newTxs.length);
      setGeneratePhase(newTxs.length > 0 ? 'previewing' : 'idle');

      if (newTxs.length === 0) {
        setError('Üretilecek yeni aidat kaydı bulunamadı. Tüm aidatlar zaten mevcut.');
      }
    } catch (e: any) {
      setError(e.message || 'Dry run hatası');
      setGeneratePhase('idle');
    }
  };

  // --- Commit ---
  const handleCommit = async () => {
    setGeneratePhase('committing');
    setError(null);
    try {
      const result = await generateMonthlyDuesAndCommit(mgmtId, firestoreDb);
      setCommitResult(result.created);
      setGeneratePhase('done');
      // Auto-reset to idle after 3 seconds
      setTimeout(() => {
        setGeneratePhase('idle');
        setCommitResult(null);
        setPreviewCount(0);
      }, 3000);
    } catch (e: any) {
      setError(e.message || 'Commit hatası');
      setGeneratePhase('idle');
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '-';
    const [y, m] = iso.split('-');
    const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    return `${months[parseInt(m) - 1] ?? m} ${y}`;
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex items-center justify-center px-4 animate-in fade-in duration-300">
      <div className="bg-[#1e293b] w-full max-w-sm rounded-[32px] border border-white/10 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex justify-between items-center p-5 pb-3 border-b border-white/5">
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">AİDAT YÖNETİMİ</h3>
            <p className="text-[8px] font-bold text-zinc-500 uppercase mt-0.5 tracking-tight">Tarife geçmişi ve otomatik üretim</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">

          {/* Active Rate */}
          <div className="bg-blue-600/10 rounded-2xl p-4 border border-blue-500/20">
            <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest mb-1">AKTİF AİDAT TUTARI</p>
            <p className="text-3xl font-black text-white leading-none">
              ₺{(() => {
                if (rates.length === 0) return currentDuesAmount.toLocaleString('tr-TR');
                try {
                  const aidatRates: AidatRate[] = rates.map(r => ({ id: r.id, amount: r.amount, startDate: new Date(r.startDate) }));
                  return getDuesForPeriod(new Date(), aidatRates).toLocaleString('tr-TR');
                } catch {
                  return currentDuesAmount.toLocaleString('tr-TR');
                }
              })()}
              <span className="text-[10px] text-zinc-500 font-bold ml-2">/ AY</span>
            </p>
            {rates.length > 0 && (
              <p className="text-[8px] text-zinc-500 font-bold mt-1 uppercase">
                Hesap motoruyla senkron
              </p>
            )}
          </div>

          {/* Rate History */}
          <div className="space-y-2">
            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest px-1">TARİFE GEÇMİŞİ</p>
            {ratesLoading ? (
              <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-zinc-600" /></div>
            ) : rates.length === 0 ? (
              <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                <p className="text-[9px] text-zinc-500 font-bold text-center uppercase">Henüz tarife eklenmemiş. Ayarlardaki aidat tutarı kullanılacak.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {rates.map((r, i) => (
                  <div key={r.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${i === 0 ? 'bg-blue-900/20 border-blue-500/20' : 'bg-black/20 border-white/5'}`}>
                    <div className="flex items-center space-x-3">
                      <Calendar size={14} className={i === 0 ? 'text-blue-400' : 'text-zinc-600'} />
                      <div>
                        <p className={`text-[11px] font-black ${i === 0 ? 'text-white' : 'text-zinc-400'}`}>₺{r.amount.toLocaleString('tr-TR')}</p>
                        <p className="text-[8px] text-zinc-500 font-bold uppercase">{formatDate(r.startDate)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleArchiveRate(r.id)}
                      className="text-zinc-700 hover:text-amber-400 transition-colors p-1"
                      title="Arşivle"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Rate Form */}
          <div className="bg-black/30 rounded-2xl p-4 border border-white/5 space-y-3">
            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">YENİ TARİFE EKLE</p>
            <div className="flex space-x-2">
              <div className="flex-1">
                <label className="text-[7px] font-bold text-zinc-600 uppercase block mb-1 ml-1">TUTAR (₺)</label>
                <input
                  type="number"
                  value={newAmount}
                  onChange={e => setNewAmount(e.target.value)}
                  placeholder="750"
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-sm font-black text-white outline-none focus:border-blue-500/40 transition-all"
                />
              </div>
              <div className="flex-1">
                <label className="text-[7px] font-bold text-zinc-600 uppercase block mb-1 ml-1">BAŞLANGIÇ AYI</label>
                <input
                  type="month"
                  value={newStartDate.slice(0, 7)}
                  onChange={e => setNewStartDate(e.target.value + '-01')}
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-sm font-black text-white outline-none focus:border-blue-500/40 transition-all"
                />
              </div>
            </div>
            <button
              onClick={handleAddRate}
              disabled={addLoading || !newAmount || parseFloat(newAmount) <= 0}
              className="w-full h-10 bg-blue-600/80 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600/80 rounded-xl flex items-center justify-center space-x-2 active:scale-95 transition-all"
            >
              {addLoading ? (
                <Loader2 size={16} className="animate-spin text-white" />
              ) : (
                <>
                  <Plus size={16} className="text-white" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">TARİFE EKLE</span>
                </>
              )}
            </button>
          </div>

          {/* Separator */}
          <div className="h-px bg-white/5" />

          {/* Generate Section */}
          <div className="bg-emerald-900/10 rounded-2xl p-4 border border-emerald-500/15 space-y-3">
            <div>
              <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">OTOMATİK AİDAT ÜRETİMİ</p>
              <p className="text-[8px] text-zinc-500 font-bold mt-0.5 uppercase tracking-tight">
                Eksik aylar için AIDAT_AUTO ve CREDIT_APPLY işlemleri üretir.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-rose-900/20 rounded-xl p-3 border border-rose-500/20 flex items-start space-x-2">
                <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-rose-300 font-bold leading-relaxed">{error}</p>
              </div>
            )}

            {/* Phase: idle */}
            {generatePhase === 'idle' && (
              <button
                onClick={handleDryRun}
                className="w-full h-11 bg-emerald-600/80 hover:bg-emerald-500 rounded-xl flex items-center justify-center space-x-2 active:scale-95 transition-all"
              >
                <span className="text-[10px] font-black text-white uppercase tracking-widest">EKSİK AİDATLARI HESAPLA</span>
              </button>
            )}

            {/* Phase: previewing */}
            {generatePhase === 'previewing' && previewCount > 0 && (
              <div className="space-y-3">
                <div className="bg-emerald-900/30 rounded-xl p-3 border border-emerald-500/20 text-center">
                  <p className="text-2xl font-black text-emerald-300">{previewCount}</p>
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mt-0.5">YENİ İŞLEM ÜRETİLECEK</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => { setGeneratePhase('idle'); setPreviewCount(0); }}
                    className="flex-1 h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center active:scale-95 transition-all"
                  >
                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">İPTAL</span>
                  </button>
                  <button
                    onClick={handleCommit}
                    className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-500 rounded-xl flex items-center justify-center space-x-2 active:scale-95 transition-all"
                  >
                    <Check size={14} className="text-white" />
                    <span className="text-[9px] font-black text-white uppercase tracking-widest">ONAYLA</span>
                  </button>
                </div>
              </div>
            )}

            {/* Phase: committing */}
            {generatePhase === 'committing' && (
              <div className="flex flex-col items-center py-4 space-y-2">
                <Loader2 size={24} className="animate-spin text-emerald-400" />
                <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Firestore'a yazılıyor...</p>
              </div>
            )}

            {/* Phase: done */}
            {generatePhase === 'done' && commitResult !== null && (
              <div className="space-y-3">
                <div className="bg-emerald-900/30 rounded-xl p-4 border border-emerald-500/20 text-center">
                  <Check size={24} className="text-emerald-400 mx-auto mb-1" />
                  <p className="text-xl font-black text-emerald-300">{commitResult}</p>
                  <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mt-0.5">İŞLEM BAŞARIYLA YAZILDI</p>
                </div>
                <button
                  onClick={() => { setGeneratePhase('idle'); setCommitResult(null); setPreviewCount(0); }}
                  className="w-full h-10 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-center active:scale-95 transition-all"
                >
                  <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">TAMAM</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AidatYonetimiModal;
