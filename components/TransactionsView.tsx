
import React, { useState, useMemo } from 'react';
import { ArrowLeft, Inbox, Calendar, Edit3, X, Check, ChevronDown } from 'lucide-react';
import { Transaction, Unit, FileEntry } from '../types.ts';

interface TransactionsViewProps {
  isAdmin: boolean;
  transactions: Transaction[];
  units: Unit[];
  onClose: () => void;
  onAddFile: (name: string, category: FileEntry['category']) => void;
  onDeleteTransaction: (id: string) => void;
  onUpdateTransaction: (tx: Transaction) => void;
}

const TransactionsView: React.FC<TransactionsViewProps> = ({ isAdmin, transactions, units, onClose, onAddFile, onDeleteTransaction, onUpdateTransaction }) => {
  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYearActual = now.getFullYear();

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>(currentMonthIdx);
  const [selectedYear, setSelectedYear] = useState<number>(currentYearActual);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Aralık", "Eylül", "Ekim", "Kasım", "Aralık"];
  const years = [2023, 2024, 2025, 2026];

  const getUnitNo = (unitId?: string) => units.find(u => u.id === unitId)?.no || 'GENEL';

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];
    if (selectedMonth !== 'all') {
      filtered = filtered.filter(tx => {
        const parts = tx.date.split('.');
        if (parts.length !== 3) return false;
        const txMonth = parseInt(parts[1], 10) - 1;
        const txYear = parseInt(parts[2], 10);
        return txMonth === selectedMonth && txYear === selectedYear;
      });
    }
    return filtered;
  }, [transactions, selectedMonth, selectedYear]);

  return (
    <div className="fixed inset-0 z-[200] bg-[#030712] flex flex-col animate-in slide-in-from-bottom duration-500 overflow-hidden">
      {/* Header */}
      <div className="bg-[#030712]/95 backdrop-blur-xl border-b border-white/5 px-4 pt-4 pb-3 flex flex-col items-center shadow-2xl relative z-[210]">
        <button onClick={onClose} className="absolute left-4 top-4 p-2 bg-white/5 rounded-xl text-zinc-400 active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={20} strokeWidth={2.5} />
        </button>
        <h3 className="text-[14px] font-black uppercase tracking-[0.2em] text-white leading-none">İŞLEM HAREKETLERİ</h3>
        
        {/* Dönem Seçici Buton */}
        <div className="mt-5 w-full flex justify-center px-4">
          <button 
            onClick={() => setIsDatePickerOpen(true)} 
            className="w-full max-w-[200px] bg-blue-600/10 border-2 border-blue-500/20 rounded-[20px] h-12 px-4 flex items-center justify-between active:bg-blue-600/20 transition-all shadow-lg"
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <Calendar size={18} className="text-blue-400 shrink-0" />
              <span className="text-[16px] font-black uppercase tracking-widest text-white leading-none truncate">
                {selectedMonth === 'all' ? 'HEPSİ' : `${months[selectedMonth].toUpperCase().slice(0,3)} ${selectedYear}`}
              </span>
            </div>
            <ChevronDown size={18} className="text-blue-400/50 shrink-0" />
          </button>
        </div>
      </div>

      {/* Tarih Seçici Modal */}
      {isDatePickerOpen && (
        <div className="fixed inset-0 z-[300] bg-black/85 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-300">
          <div className="bg-[#1e293b] w-full max-w-[210px] rounded-[36px] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-3.5 border-b border-white/5 flex justify-between items-center bg-[#0f172a]">
               <span className="text-[10px] font-black text-white/60 uppercase tracking-widest leading-none">DÖNEM</span>
               <button onClick={() => setIsDatePickerOpen(false)} className="text-white/40 p-1 hover:text-white transition-colors">
                 <X size={18} />
               </button>
            </div>
            
            <div className="flex flex-1 overflow-hidden h-[340px]">
              <div className="w-[75px] border-r border-white/10 bg-black/30 overflow-y-auto no-scrollbar">
                <button 
                  onClick={() => { setSelectedMonth('all'); setIsDatePickerOpen(false); }}
                  className={`w-full py-4 text-[11px] font-black border-b border-white/5 transition-colors ${selectedMonth === 'all' ? 'text-green-400 bg-green-400/10' : 'text-white/60 hover:text-white'}`}
                >
                  HEPSİ
                </button>
                {years.map(y => (
                  <button 
                    key={y} 
                    onClick={() => setSelectedYear(y)} 
                    className={`w-full py-5 text-[16px] font-black transition-colors ${selectedYear === y && selectedMonth !== 'all' ? 'text-blue-300 bg-blue-400/10' : 'text-white/30 hover:text-white'}`}
                  >
                    {y}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar bg-[#1e293b]">
                {months.map((m, i) => {
                  const isFutureMonth = selectedYear === currentYearActual && i > currentMonthIdx;
                  const isFutureYear = selectedYear > currentYearActual;
                  
                  if (isFutureMonth || isFutureYear) return null;

                  return (
                    <button 
                      key={m} 
                      onClick={() => { setSelectedMonth(i); setIsDatePickerOpen(false); }} 
                      className={`w-full py-4 px-4 text-left text-[13px] font-black uppercase border-b border-white/5 last:border-0 flex items-center justify-between transition-all ${selectedMonth === i ? 'text-green-300 bg-white/5' : 'text-white/80 hover:bg-white/[0.05]'}`}
                    >
                      <span className="truncate">{m}</span>
                      {selectedMonth === i && <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)] shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="p-3.5 bg-[#0f172a] border-t border-white/10">
              <button 
                onClick={() => setIsDatePickerOpen(false)}
                className="w-full py-3.5 rounded-[18px] bg-white/10 text-[12px] font-black text-white uppercase tracking-widest active:scale-95 transition-all hover:bg-white/15"
              >
                KAPAT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* İşlem Listesi */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
        {filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-20 mt-10">
            <div className="w-24 h-24 bg-white/5 rounded-3xl flex items-center justify-center mb-6">
              <Inbox size={48} strokeWidth={1} className="text-white/20" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-center px-10 leading-relaxed text-white/40">
              {selectedMonth === 'all' ? 'Henüz hiçbir işlem kaydı bulunmuyor' : `${months[selectedMonth as number].toUpperCase()} ${selectedYear} DÖNEMİNDE İŞLEM BULUNAMADI`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredTransactions.map((tx) => (
              <div key={tx.id} className="relative bg-[#030712] border-l-[4px] px-5 py-4 flex items-center justify-between active:bg-white/[0.02] transition-colors" style={{ borderLeftColor: tx.type === 'GELİR' ? '#22c55e' : tx.type === 'BORÇLANDIRMA' ? '#f97316' : '#ef4444' }}>
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center space-x-2 mb-1.5">
                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${tx.type === 'GELİR' ? 'bg-green-500/10 text-green-400' : tx.type === 'BORÇLANDIRMA' ? 'bg-orange-500/10 text-orange-400' : 'bg-red-500/10 text-red-400'}`}>
                      {tx.type}
                    </span>
                    <span className="text-[11px] font-black uppercase text-blue-400 tracking-tight">D.{getUnitNo(tx.unitId)}</span>
                    <span className="text-[11px] font-bold text-white/20 ml-auto">{tx.date}</span>
                  </div>
                  <p className="text-[14px] font-bold text-white uppercase truncate leading-tight mb-1">{tx.description.split('[')[0].trim()}</p>
                  
                  {isAdmin && (
                    <div className="flex items-center space-x-2 mt-2">
                      <button 
                        onClick={() => setEditingTx(tx)} 
                        className="flex items-center space-x-1 px-2 py-1 bg-white/5 border border-white/5 rounded-lg text-white/30 active:scale-95 transition-all"
                      >
                        <Edit3 size={10} />
                        <span className="text-[8px] font-black uppercase">Düzenle</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[17px] font-black tracking-tighter ${tx.type === 'GELİR' ? 'text-green-400' : 'text-red-400'}`}>
                    ₺{formatCurrency(tx.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Düzenleme Uyarı Modalı */}
      {editingTx && isAdmin && (
        <div className="fixed inset-0 z-[400] bg-black/95 backdrop-blur-md flex items-center justify-center px-8 animate-in fade-in duration-300">
          <div className="bg-[#1e293b] w-full max-sm rounded-[32px] p-8 border border-white/10 shadow-2xl text-center">
             <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
               <Edit3 className="text-blue-500" size={32} />
             </div>
             <h3 className="text-lg font-black text-white uppercase mb-2">İŞLEMİ DÜZENLE</h3>
             <p className="text-white/40 text-[10px] font-bold mb-8 uppercase tracking-widest leading-relaxed px-4">Bu özellik bir sonraki güncelleme ile aktif edilecektir.</p>
             <button 
               onClick={() => setEditingTx(null)}
               className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl font-black text-white uppercase tracking-widest active:scale-95 transition-all"
             >
               ANLADIM
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionsView;
