
import React, { useState, useMemo, useRef } from 'react';
import { Inbox, ChevronDown, ArrowLeft, TrendingUp, AlertCircle, CalendarDays, Share2, Loader2 } from 'lucide-react';
import { Unit, BuildingInfo, Transaction, FileEntry } from '../types.ts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface AidatCizelgeViewProps {
  units: Unit[];
  transactions: Transaction[];
  info: BuildingInfo;
  onClose: () => void;
  onAddDues: (unitId: string, amount: number, month: number, year: number) => void;
  onAddFile?: (name: string, category: FileEntry['category'], data?: string) => void;
}

const AidatCizelgeView: React.FC<AidatCizelgeViewProps> = ({ units, transactions, info, onClose, onAddDues, onAddFile }) => {
  const now = new Date();
  const currentMonthActual = now.getMonth() + 1; // 1-12
  const currentYearActual = now.getFullYear();

  const [selectedYear, setSelectedYear] = useState(currentYearActual);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  
  const captureAreaRef = useRef<HTMLDivElement>(null);
  
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026];

  const getMonthStatus = (unit: Unit, month: number): 'paid' | 'unpaid' | 'future' | 'exempt' | 'none' => {
    if (selectedYear > currentYearActual || (selectedYear === currentYearActual && month > currentMonthActual)) {
      return 'future';
    }

    if (unit.id === info.managerUnitId && info.isManagerExempt) {
      return 'exempt';
    }

    const mIdx = month - 1; // periodMonth is 0-indexed

    // Expected debit: AIDAT_AUTO + BORÇLANDIRMA for this unit/month/year
    const expectedDebit = transactions
      .filter(tx =>
        tx.unitId === unit.id &&
        tx.periodMonth === mIdx &&
        tx.periodYear === selectedYear &&
        (tx.direction === 'DEBIT' || (!tx.direction && tx.type !== 'GELİR'))
      )
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    if (expectedDebit === 0) return 'none';

    // Collected credit: all CREDIT direction txs for this unit/month/year
    const collectedCredit = transactions
      .filter(tx =>
        tx.unitId === unit.id &&
        tx.periodMonth === mIdx &&
        tx.periodYear === selectedYear &&
        (tx.direction === 'CREDIT' || (!tx.direction && tx.type === 'GELİR'))
      )
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    return collectedCredit >= expectedDebit ? 'paid' : 'unpaid';
  };

  const stats = useMemo(() => {
    const actualCollection = transactions.reduce((sum, tx) => {
      if (tx.periodYear !== selectedYear) return sum;
      const isCredit = tx.direction === 'CREDIT' || (!tx.direction && tx.type === 'GELİR');
      return isCredit ? sum + Number(tx.amount) : sum;
    }, 0);

    const totalPending = units.reduce((sum, u) => sum + u.debt, 0);

    return { collected: actualCollection, pending: totalPending };
  }, [units, transactions, selectedYear]);

  const formatCurrency = (val: number) => {
    return "₺" + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0 }).format(val);
  };

  const handleExportPdf = async () => {
    if (!captureAreaRef.current) return;
    
    setIsProcessingPdf(true);
    await new Promise(r => setTimeout(r, 400));

    try {
      const element = captureAreaRef.current;
      const canvas = await html2canvas(element, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#030712',
        logging: false,
        width: element.offsetWidth,
        height: element.scrollHeight,
        windowHeight: element.scrollHeight,
        scrollY: 0, scrollX: 0,
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.querySelector('[data-capture-area]');
          if (clonedElement) {
            (clonedElement as HTMLElement).style.height = 'auto';
            (clonedElement as HTMLElement).style.overflow = 'visible';
          }
          const toHide = clonedDoc.querySelectorAll('button, .no-print');
          toHide.forEach(el => (el as HTMLElement).style.display = 'none');
          const sticky = clonedDoc.querySelector('.sticky');
          if (sticky) (sticky as HTMLElement).style.position = 'relative';
        }
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const imgWidth = 210; 
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: imgHeight > 297 ? [imgWidth, imgHeight] : 'a4'
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      const fileName = `${info.name || 'Yonetim'}_Aidat_Cizelgesi_${selectedYear}.pdf`;

      // Otomatik arşive kaydet
      if (onAddFile) onAddFile(fileName, 'Diğer', pdf.output('datauristring'));

      const pdfBlob = pdf.output('blob');
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Aidat Çizelgesi',
            text: `${info.name} - ${selectedYear} Aidat Çizelgesi`
          });
        } catch (e) {
          pdf.save(fileName);
        }
      } else {
        pdf.save(fileName);
        alert("Paylaşım desteklenmiyor, dosya arşive eklendi ve indirildi.");
      }
    } catch (err) {
      console.error("PDF Export Error:", err);
      alert("PDF oluşturulurken bir hata oluştu.");
    } finally {
      setIsProcessingPdf(false);
    }
  };

  return (
    <>
      <div ref={captureAreaRef} data-capture-area className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-0 pb-20 relative bg-[#030712] min-h-screen">
        <div className="sticky top-0 z-[60] px-4 pt-2.5 pb-2.5 bg-[#030712]/95 backdrop-blur-3xl border-b border-white/5 shadow-2xl -mx-4">
          <div className="flex items-center justify-between mb-2.5 px-4">
            <button onClick={onClose} className="bg-white/5 p-2 rounded-xl border border-white/5 active:scale-90 transition-all shrink-0 no-print">
              <ArrowLeft size={20} strokeWidth={3} className="text-zinc-400" />
            </button>
            
            <div className="flex items-center space-x-2 flex-1 justify-center px-1">
              <CalendarDays size={18} className="text-blue-400 shrink-0" />
              <h3 className="text-[13px] font-black uppercase tracking-[0.05em] text-white truncate italic">AİDAT ÇİZELGESİ</h3>
            </div>

            <div className="flex items-center space-x-1.5 shrink-0 no-print">
              <div className="relative">
                <button onClick={() => setIsYearPickerOpen(!isYearPickerOpen)} className="h-12 bg-white/5 rounded-xl px-3 flex items-center border border-white/5">
                  <span className="text-white font-black text-[16px] tracking-widest leading-none">{selectedYear}</span>
                  <ChevronDown size={14} className={`ml-1.5 text-white/40 transition-transform ${isYearPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                {isYearPickerOpen && (
                  <div className="absolute top-full right-0 mt-2 w-28 bg-[#1e293b] border border-white/10 rounded-2xl shadow-2xl z-[70] overflow-hidden">
                    {years.map(y => (
                      <button key={y} onClick={() => { setSelectedYear(y); setIsYearPickerOpen(false); }} className={`w-full py-4 text-xs font-black text-center border-b border-white/5 last:border-0 hover:bg-white/5 ${selectedYear === y ? 'text-green-400 bg-white/5' : 'text-white/40'}`}>{y}</button>
                    ))}
                  </div>
                )}
              </div>
              
              <button 
                onClick={handleExportPdf} 
                disabled={isProcessingPdf}
                className="bg-white/5 p-2 rounded-xl border border-white/5 active:scale-90 transition-all text-green-400 disabled:opacity-20"
              >
                <Share2 size={18} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 px-5">
            <div className="bg-[#0f172a] border border-green-500/20 rounded-[20px] p-2 flex flex-col items-center justify-center text-center shadow-lg">
               <div className="flex items-center space-x-1.5 mb-0.5">
                 <TrendingUp size={11} className="text-green-500" />
                 <span className="text-[8px] font-black text-white/40 uppercase tracking-[0.1em]">GERÇEK TAHSİLAT</span>
               </div>
               <p className="text-xl font-black text-white tracking-tight leading-none italic">{formatCurrency(stats.collected)}</p>
            </div>
            
            <div className="bg-[#0f172a] border border-red-500/20 rounded-[20px] p-2 flex flex-col items-center justify-center text-center shadow-lg">
               <div className="flex items-center space-x-1.5 mb-0.5">
                 <AlertCircle size={11} className="text-red-500" />
                 <span className="text-[8px] font-black text-white/40 uppercase tracking-[0.1em]">TOPLAM ALACAK</span>
               </div>
               <p className="text-xl font-black text-red-500 tracking-tight leading-none italic">{formatCurrency(stats.pending)}</p>
            </div>
          </div>
        </div>

        <div className="px-2 mt-4 space-y-2 pb-10">
          {units.sort((a,b) => parseInt(a.no) - parseInt(b.no)).map((unit) => (
            <div key={unit.id} className="bg-[#111827]/60 backdrop-blur-md rounded-[24px] p-4 border border-white/5 shadow-xl flex flex-col">
              <div className="flex items-baseline justify-between mb-3">
                <div className="flex items-baseline space-x-4 min-w-0">
                  <span className="text-2xl font-black text-white leading-none italic">{unit.no}</span>
                  <div className="min-w-0">
                    <span className="text-[13px] font-black text-white uppercase tracking-tight truncate block leading-tight">
                      {unit.tenantName || unit.ownerName}
                    </span>
                    {unit.tenantName && <span className="text-[9px] font-black text-orange-500/60 uppercase tracking-[0.2em] leading-none">KİRACI</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  {unit.credit > 0 && <span className="text-[9px] font-black text-blue-400 uppercase tracking-tighter">KREDİ: {formatCurrency(unit.credit)}</span>}
                  {unit.debt > 0 && <span className="text-[9px] font-black text-red-500 uppercase tracking-tighter">BORÇ: {formatCurrency(unit.debt)}</span>}
                </div>
              </div>

              <div className="grid grid-cols-12 gap-0.5 w-full">
                {months.map((m) => {
                  const status = getMonthStatus(unit, m);
                  let bgColor = 'bg-[#1e293b] border-white/5';
                  let textColor = 'text-white/20';
                  
                  if (status === 'paid') {
                    bgColor = 'bg-[#22c55e] border-[#22c55e]/20';
                    textColor = 'text-white';
                  } else if (status === 'unpaid') {
                    bgColor = 'bg-[#ef4444] border-[#ef4444]/20';
                    textColor = 'text-white';
                  } else if (status === 'exempt') {
                    bgColor = 'bg-blue-600/40 border-blue-400/20';
                    textColor = 'text-white';
                  } else if (status === 'future') {
                     bgColor = 'bg-white/[0.02] border-white/5';
                     textColor = 'text-white/5';
                  }
                  
                  return (
                    <div key={m} className={`h-5 rounded-[4px] flex items-center justify-center border transition-all duration-300 ${bgColor} shadow-inner`}>
                      <span className={`text-[8px] font-black leading-none ${textColor}`}>{m}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isProcessingPdf && (
        <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in">
          <div className="relative mb-8">
            <div className="w-20 h-20 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <CalendarDays size={32} className="text-blue-500 animate-pulse" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-black text-white uppercase tracking-widest">ÇİZELGE HAZIRLANIYOR</h3>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">LÜTFEN BEKLEYİNİZ</p>
          </div>
        </div>
      )}
    </>
  );
};

export default AidatCizelgeView;
