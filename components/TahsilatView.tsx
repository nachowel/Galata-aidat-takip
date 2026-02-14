
import React, { useState, useMemo } from 'react';
import { ArrowLeft, ChevronDown, CheckCircle2, Save, Home, Loader2, User, UserCheck, Calendar } from 'lucide-react';
import { Unit, BuildingInfo, Transaction } from '../types.ts';

interface TahsilatViewProps {
  units: Unit[];
  info: BuildingInfo;
  transactions: Transaction[];
  onClose: () => void;
  onSave: (amount: number, description: string, vault: 'genel' | 'demirbas', date: string, unitId: string, month: number, year: number) => void;
}

const TahsilatView: React.FC<TahsilatViewProps> = ({ units, info, transactions, onClose, onSave }) => {
  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYearActual = now.getFullYear();

  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(now.toISOString().split('T')[0]);
  const [selectedPayerType, setSelectedPayerType] = useState<'Malik' | 'Kiracı'>('Kiracı');
  const [showUnitGrid, setShowUnitGrid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedUnit = useMemo(() => units.find(u => u.id === selectedUnitId), [units, selectedUnitId]);
  
  const selectableUnits = useMemo(() => 
    units.filter(u => !(info.isManagerExempt && u.id === info.managerUnitId))
         .sort((a, b) => parseInt(a.no) - parseInt(b.no)),
    [units, info]
  );

  const months = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0 }).format(val);
  };

  const handleUnitSelect = (unit: Unit) => {
    setSelectedUnitId(unit.id);
    setShowUnitGrid(false);
    setAmount('');
    if (unit.tenantName && unit.tenantName.trim() !== '') {
      setSelectedPayerType('Kiracı');
    } else {
      setSelectedPayerType('Malik');
    }
  };

  const handleProcess = async (debtItem?: any) => {
    let finalAmount = debtItem ? debtItem.amount : parseFloat(amount);
    const dateObj = new Date(selectedDate);
    let finalMonth = debtItem ? debtItem.month : dateObj.getMonth();
    let finalYear = debtItem ? debtItem.year : dateObj.getFullYear();
    const payerLabel = selectedPayerType === 'Kiracı' ? 'KİRACI' : 'MALİK';
    
    if (!selectedUnitId || isNaN(finalAmount) || finalAmount <= 0) return;
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 600));

    const description = debtItem 
      ? `${months[debtItem.month]} AYI AİDAT TAHSİLAT (${payerLabel})` 
      : `TAHSİLAT (${payerLabel})`;

    onSave(finalAmount, description, 'genel', selectedDate, selectedUnitId, finalMonth, finalYear);
    setIsSaving(false);
    setIsSuccess(true);
  };

  const getPendingDebts = (unit: Unit) => {
    const pendingList = [];
    const duesValue = info.duesAmount || 750;
    for (let i = 0; i < 12; i++) {
        const hasPayment = transactions.some(tx => 
            tx.unitId === unit.id && tx.type === 'GELİR' && tx.periodMonth === i && tx.periodYear === currentYearActual
        );
        if (!hasPayment) {
            if (i <= currentMonthIdx && !(unit.id === info.managerUnitId && info.isManagerExempt)) {
                pendingList.push({ 
                  month: i, 
                  year: currentYearActual, 
                  amount: duesValue, 
                  title: `${months[i]} ${currentYearActual} AİDAT BORCU`, 
                  id: Math.random().toString() 
                });
            }
        }
    }
    return pendingList;
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 z-[400] bg-[#030712] flex flex-col items-center justify-center p-8 text-center animate-in zoom-in duration-300">
        <CheckCircle2 size={64} className="text-green-500 mb-4" />
        <h3 className="text-xl font-black text-white uppercase tracking-widest">İŞLEM TAMAMLANDI</h3>
        <p className="text-zinc-400 text-xs mt-2 uppercase font-bold">Ödeme başarıyla kaydedildi.</p>
        <button onClick={onClose} className="mt-8 px-10 py-4 bg-blue-600 rounded-2xl font-black text-white active:scale-95 transition-all">GERİ DÖN</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#030712] flex flex-col animate-in slide-in-from-bottom duration-500 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5 bg-[#030712]/90 backdrop-blur-xl shrink-0 shadow-xl">
        <button onClick={onClose} className="p-2 bg-white/5 rounded-xl text-zinc-400 active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
           <h3 className="text-[17px] font-black uppercase tracking-[0.2em] text-green-500">BORÇ TAHSİLAT</h3>
        </div>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        <section>
          <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-2 block ml-1 text-center">1. DAİRE SEÇİMİ</label>
          <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl transition-all bg-[#111827]">
            <button onClick={() => setShowUnitGrid(!showUnitGrid)} className="w-full h-11 flex items-center justify-between px-4 active:scale-[0.98] transition-all">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-7 h-7 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shadow-xl shrink-0">
                  <Home size={14} className="text-green-500" />
                </div>
                <div className="flex flex-col text-left min-w-0">
                  <span className={`text-[15px] font-black uppercase tracking-tighter leading-none truncate ${selectedUnit ? 'text-zinc-100' : 'text-green-500'}`}>
                    {selectedUnit ? (selectedUnit.tenantName || selectedUnit.ownerName || '').toUpperCase() : 'DAİRE SEÇİNİZ...'}
                  </span>
                </div>
              </div>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${showUnitGrid ? 'rotate-180' : ''}`} />
            </button>
            {showUnitGrid && (
              <div className="flex flex-col space-y-1 p-1 bg-[#0b101b] max-h-[220px] overflow-y-auto no-scrollbar border-t border-white/10">
                {selectableUnits.map((unit) => (
                  <button key={unit.id} onClick={() => handleUnitSelect(unit)} className={`w-full py-2 px-4 flex items-center transition-all ${selectedUnitId === unit.id ? 'bg-white/5' : 'hover:bg-white/5'}`}>
                    <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-[10px] font-black text-white shadow-xl shrink-0 mr-3">
                      {unit.no}
                    </div>
                    <div className="flex flex-col text-left min-w-0">
                      <span className="text-[12px] font-black text-zinc-300 uppercase tracking-tight truncate leading-tight">
                        {unit.tenantName || unit.ownerName || `${unit.no}. DAİRE`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {selectedUnit && selectedUnit.tenantName && selectedUnit.tenantName.trim() !== '' && (
          <section className="animate-in fade-in zoom-in-95 duration-300">
            <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-1.5 block ml-1 text-center">2. ÖDEMEYİ YAPAN</label>
            <div className="grid grid-cols-2 gap-3 w-full">
              <button 
                onClick={() => setSelectedPayerType('Kiracı')} 
                className={`flex items-center justify-center space-x-2 h-11 rounded-xl border transition-all ${selectedPayerType === 'Kiracı' ? 'bg-orange-600 border-orange-400 text-white shadow-lg' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'}`}
              >
                <UserCheck size={14} />
                <span className="text-[11px] font-black uppercase tracking-widest">KİRACI</span>
              </button>
              <button 
                onClick={() => setSelectedPayerType('Malik')} 
                className={`flex items-center justify-center space-x-2 h-11 rounded-xl border transition-all ${selectedPayerType === 'Malik' ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'}`}
              >
                <User size={14} />
                <span className="text-[11px] font-black uppercase tracking-widest">MALİK</span>
              </button>
            </div>
          </section>
        )}

        {selectedUnit && (
          <div className="animate-in fade-in zoom-in-95 duration-500 space-y-4">
            <section className="bg-[#111827] rounded-[24px] p-4 border border-white/10 shadow-2xl space-y-4">
              <div className="grid grid-cols-2 gap-3 w-full">
                <div className="flex flex-col w-full">
                   <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] mb-1.5 block text-center">TARİH</label>
                   <input 
                      type="date" 
                      value={selectedDate} 
                      onChange={(e) => setSelectedDate(e.target.value)} 
                      className="w-full h-16 bg-black/60 border border-white/10 rounded-xl px-2 text-[15px] font-black text-zinc-300 outline-none transition-all shadow-2xl text-center" 
                   />
                </div>
                <div className="flex flex-col w-full">
                   <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] mb-1.5 block text-center">TUTAR (₺)</label>
                   <input 
                      type="number" 
                      placeholder="0.00" 
                      value={amount} 
                      onChange={(e) => setAmount(e.target.value)} 
                      className="w-full h-16 bg-black/60 border border-white/10 rounded-xl px-2 text-[26px] font-black text-green-500 text-center outline-none transition-all shadow-2xl" 
                   />
                </div>
              </div>
              
              <button 
                onClick={() => handleProcess()} 
                disabled={!amount || parseFloat(amount) <= 0 || isSaving} 
                className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-[20px] flex items-center justify-center space-x-3 active:scale-95 transition-all shadow-xl disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="animate-spin" size={20} /> : <><Save size={20} /><span className="text-[13px] font-black uppercase tracking-[0.2em]">TAHSİLATI KAYDET</span></>}
              </button>
            </section>

            <section className="space-y-2">
              <span className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">BEKLEYEN BORÇLAR</span>
              {getPendingDebts(selectedUnit).map((debt) => (
                <button key={debt.id} onClick={() => handleProcess(debt)} className="w-full h-11 bg-slate-800/40 rounded-xl px-4 border border-white/5 text-left active:scale-[0.98] transition-all flex items-center justify-between">
                  <span className="text-[11px] font-black text-zinc-300 uppercase truncate flex-1">{debt.title}</span>
                  <span className="text-[10px] font-black text-red-500 italic">₺{debt.amount}</span>
                </button>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default TahsilatView;
