
import React, { useState, useMemo, useRef } from 'react';
import { ChevronDown, ArrowLeft, Check, Wallet, Calendar, MessageCircle, Building2 } from 'lucide-react';
import { Transaction, Unit, FileEntry } from '../types.ts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface YearlyReportViewProps {
  transactions: Transaction[];
  units: Unit[];
  onClose: () => void;
  buildingName: string;
  onAddFile: (name: string, category: FileEntry['category'], data?: string) => void;
}

const YearlyReportView: React.FC<YearlyReportViewProps> = ({ transactions, units, onClose, buildingName, onAddFile }) => {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedVault, setSelectedVault] = useState<'genel' | 'demirbas'>('genel');
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPdfMode, setIsPdfMode] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);
  const years = [2024, 2025, 2026];

  const previousDevir = useMemo(() => {
    return transactions.reduce((sum, tx) => {
      const parts = tx.date.split('.');
      if (parts.length !== 3) return sum;
      const txYear = parseInt(parts[2]);

      if (txYear < selectedYear) {
        const isDemirbasTx = tx.description.toLowerCase().includes('demirbaş');
        const txVaultType = isDemirbasTx ? 'demirbas' : 'genel';
        
        if (txVaultType === selectedVault) {
          if (tx.type === 'GELİR') return sum + tx.amount;
          if (tx.type === 'GİDER') return sum - tx.amount;
        }
      }
      return sum;
    }, 0);
  }, [transactions, selectedYear, selectedVault]);

  const yearlyTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const parts = tx.date.split('.');
      if (parts.length !== 3) return false;
      const txYear = parseInt(parts[2]);
      
      const isDemirbasTx = tx.description.toLowerCase().includes('demirbaş');
      const txVaultType = isDemirbasTx ? 'demirbas' : 'genel';
      
      return txYear === selectedYear && txVaultType === selectedVault;
    });
  }, [transactions, selectedYear, selectedVault]);

  const reportData = useMemo(() => {
    const incomeGroups: Record<string, number> = {};
    const expenseGroups: Record<string, number> = {};

    yearlyTransactions.forEach(tx => {
      let label = tx.description.split('[')[0].trim().toUpperCase();
      
      if (label.includes('AİDAT')) {
        label = "TOPLAM YILLIK AİDAT";
      }
      
      if (tx.type === 'GELİR') {
        incomeGroups[label] = (incomeGroups[label] || 0) + tx.amount;
      } else if (tx.type === 'GİDER') {
        expenseGroups[label] = (expenseGroups[label] || 0) + tx.amount;
      }
    });

    const incomes = Object.entries(incomeGroups).map(([label, total]) => ({
      label, total
    })).sort((a, b) => b.total - a.total);

    if (previousDevir !== 0) {
      incomes.unshift({ label: "ÖNCEKİ YILLAN DEVİR", total: previousDevir });
    }

    return {
      incomes,
      expenses: Object.entries(expenseGroups).map(([label, total]) => ({
        label, total
      })).sort((a, b) => b.total - a.total)
    };
  }, [yearlyTransactions, previousDevir]);

  const totalIncome = reportData.incomes.reduce((s, i) => s + i.total, 0);
  const totalExpense = reportData.expenses.reduce((s, i) => s + i.total, 0);
  const cashTotal = totalIncome - totalExpense;

  const formatCurrency = (val: number) => {
    return "₺" + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    setIsProcessing(true);
    setIsPdfMode(true);
    await new Promise(r => setTimeout(r, 200));
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 3, useCORS: true, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a5' });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pdfWidth, imgHeight);
      const fileName = `${buildingName.replace(/\s+/g, '_')}_Yillik_Bilanco_${selectedYear}.pdf`;
      onAddFile(fileName, 'Karar', pdf.output('datauristring'));
      const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Yıllık Bilanço' });
      } else {
        pdf.save(fileName);
      }
    } catch (e) { alert("Hata oluştu."); } finally { setIsPdfMode(false); setIsProcessing(false); }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-0 pb-32">
      <div className="sticky top-0 z-[100] -mx-4 px-3 pt-3 pb-3 bg-[#030712]/95 backdrop-blur-3xl border-b border-white/5 shadow-2xl">
        <div className="flex items-center space-x-1.5 w-full">
          <button onClick={onClose} className="p-2.5 bg-white/5 rounded-xl border border-white/5 active:scale-90 transition-all shrink-0"><ArrowLeft size={20} className="text-zinc-400" /></button>
          
          <div className="flex-1 min-w-0 grid grid-cols-2 gap-1.5">
            <button onClick={() => setShowVaultPicker(!showVaultPicker)} className="bg-[#1e293b] rounded-2xl h-12 flex items-center justify-between px-3.5 border border-white/10 shadow-lg">
              <span className="text-[14px] font-black text-white uppercase truncate">{selectedVault === 'genel' ? 'GENEL' : 'DEMİRBAŞ'}</span>
              <ChevronDown size={14} className="text-zinc-400 shrink-0" />
            </button>
            <button onClick={() => setIsYearPickerOpen(!isYearPickerOpen)} className="bg-[#1e293b] rounded-2xl h-12 flex items-center justify-between px-3.5 border border-white/10 shadow-lg">
              <span className="text-[17px] font-black text-white uppercase truncate leading-none">{selectedYear} YILI</span>
              <ChevronDown size={14} className="text-zinc-400 shrink-0" />
            </button>
          </div>

          <button onClick={handleExportPdf} disabled={isProcessing} className="bg-green-600/20 border border-green-500/30 rounded-2xl h-12 px-3.5 flex items-center space-x-1.5 text-green-500 shadow-lg active:scale-95 transition-all shrink-0">
            <MessageCircle size={20} />
          </button>
        </div>

        {showVaultPicker && (
          <div className="absolute top-full left-12 z-[150] mt-1 w-36 bg-[#1e293b] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            {['genel', 'demirbas'].map(v => (
              <button key={v} onClick={() => { setSelectedVault(v as any); setShowVaultPicker(false); }} className={`w-full py-3.5 px-4 text-left text-[13px] font-black uppercase border-b border-white/5 last:border-0 ${selectedVault === v ? 'text-green-400 bg-white/5' : 'text-white/60'}`}>{v === 'genel' ? 'GENEL' : 'DEMİRBAŞ'}</button>
            ))}
          </div>
        )}
        {isYearPickerOpen && (
          <div className="absolute top-full right-16 z-[150] mt-1 w-32 bg-[#1e293b] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            {years.map(y => (
              <button key={y} onClick={() => { setSelectedYear(y); setIsYearPickerOpen(false); }} className={`w-full py-3.5 text-[13px] font-black border-b border-white/5 last:border-0 ${selectedYear === y ? 'text-green-400 bg-white/5' : 'text-white/40'}`}>{y}</button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 px-1" ref={reportRef}>
        <div className={`rounded-[32px] border overflow-hidden shadow-2xl ${isPdfMode ? 'bg-white border-slate-200 p-2' : 'bg-[#1e293b]/20 backdrop-blur-md border-white/10'}`}>
          <div className={`grid grid-cols-2 border-b ${isPdfMode ? 'border-slate-300' : 'border-white/10'}`}>
            <div className={`py-5 border-r flex items-center justify-center ${isPdfMode ? 'border-slate-300' : 'border-white/10'}`}>
              <h4 className="text-[18px] font-black text-rose-500 uppercase tracking-[0.1em]">GİDERLER</h4>
            </div>
            <div className="py-5 flex items-center justify-center">
              <h4 className="text-[18px] font-black text-green-500 uppercase tracking-[0.1em]">GELİRLER</h4>
            </div>
          </div>
          
          <div className="grid grid-cols-2 min-h-[480px] relative">
            <div className={`absolute left-1/2 top-0 bottom-0 w-[1px] ${isPdfMode ? 'bg-slate-300' : 'bg-white/5'}`} />
            
            {/* Gider Tarafı */}
            <div className="p-4 flex flex-col space-y-3.5">
              {reportData.expenses.length === 0 ? (
                <div className="flex-1 flex items-center justify-center opacity-20 italic text-[11px]">Kayıt Yok</div>
              ) : (
                reportData.expenses.map((item, i) => (
                  <div key={i} className="flex justify-between items-center w-full min-w-0">
                    <span className={`text-[12px] font-bold uppercase truncate pr-1 flex-1 ${isPdfMode ? 'text-slate-600' : 'text-white/60'}`}>{item.label}</span>
                    <span className={`text-[14px] font-black shrink-0 ${isPdfMode ? 'text-slate-900' : 'text-white'}`}>{formatCurrency(item.total)}</span>
                  </div>
                ))
              )}
              <div className={`mt-auto pt-6 text-right border-t ${isPdfMode ? 'border-slate-300' : 'border-white/10'}`}>
                <p className={`text-[11px] font-black opacity-40 uppercase mb-1 ${isPdfMode ? 'text-slate-400' : ''}`}>TOPLAM GİDER</p>
                <span className="text-[18px] font-black text-rose-500">{formatCurrency(totalExpense)}</span>
              </div>
            </div>

            {/* Gelir Tarafı */}
            <div className="p-4 flex flex-col space-y-3.5">
              {reportData.incomes.length === 0 ? (
                <div className="flex-1 flex items-center justify-center opacity-20 italic text-[11px]">Kayıt Yok</div>
              ) : (
                reportData.incomes.map((item, i) => (
                  <div key={i} className="flex justify-between items-center w-full min-w-0">
                    <span className={`text-[12px] font-bold uppercase truncate pr-1 flex-1 ${item.label.includes('DEVİR') ? 'text-blue-500' : (isPdfMode ? 'text-slate-600' : 'text-white/60')}`}>{item.label}</span>
                    <span className={`text-[14px] font-black shrink-0 ${item.label.includes('DEVİR') ? 'text-blue-500' : (isPdfMode ? 'text-slate-900' : 'text-white')}`}>{formatCurrency(item.total)}</span>
                  </div>
                ))
              )}
              <div className={`mt-auto pt-6 text-right border-t ${isPdfMode ? 'border-slate-300' : 'border-white/10'}`}>
                <p className={`text-[11px] font-black opacity-40 uppercase mb-1 ${isPdfMode ? 'text-slate-400' : ''}`}>TOPLAM GELİR</p>
                <span className="text-[18px] font-black text-green-500">{formatCurrency(totalIncome)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={`mt-5 flex justify-between items-center py-6 px-8 rounded-[32px] border shadow-2xl ${isPdfMode ? 'bg-slate-50 border-slate-300' : 'bg-[#111827] border-white/10'}`}>
          <div className="flex flex-col">
            <span className={`text-[16px] font-black uppercase tracking-tight ${isPdfMode ? 'text-slate-900' : 'text-white'}`}>NET KASA DURUMU</span>
            <span className={`text-[10px] font-bold uppercase opacity-40 ${isPdfMode ? 'text-slate-500' : ''}`}>{selectedYear} SONU BAKİYE</span>
          </div>
          <span className={`text-[26px] font-black tracking-tighter ${cashTotal >= 0 ? 'text-green-500' : 'text-rose-500'}`}>
            {formatCurrency(cashTotal)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default YearlyReportView;
