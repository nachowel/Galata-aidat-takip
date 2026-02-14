
import React, { useState, useRef } from 'react';
import { ArrowLeft, Plus, X, Share2, Loader2, Home, Check, Phone, User, Smartphone } from 'lucide-react';
import { Unit, BuildingInfo, FileEntry, Transaction } from '../types.ts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import UnitDetailView from './UnitDetailView.tsx';

interface UnitsViewProps {
  isAdmin: boolean;
  units: Unit[];
  info: BuildingInfo;
  transactions: Transaction[];
  onClose: () => void;
  onAddUnit: (unit: Omit<Unit, 'id' | 'credit' | 'debt'>) => void;
  onEditUnit: (unit: Unit) => void;
  onAddFile: (name: string, category: FileEntry['category'], data?: string) => void;
}

const UnitsView: React.FC<UnitsViewProps> = ({ isAdmin, units, info, transactions, onClose, onAddUnit, onEditUnit, onAddFile }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  
  const captureAreaRef = useRef<HTMLDivElement>(null);
  
  const [formData, setFormData] = useState({
    no: '',
    ownerName: '',
    tenantName: '',
    phone: '',
    tenantPhone: '',
    status: 'Malik' as 'Malik' | 'Kiracı'
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);

  const toTitleCase = (str: string) => {
    if (!str) return '';
    return str
      .split(/(\s+)/)
      .map(part => {
        if (part.trim().length > 0) {
          return part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR');
        }
        return part;
      })
      .join('');
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.no || !formData.ownerName) return;
    setIsSaving(true);
    onAddUnit({
      no: formData.no,
      ownerName: toTitleCase(formData.ownerName),
      tenantName: formData.status === 'Kiracı' ? toTitleCase(formData.tenantName) : '',
      phone: formData.phone,
      tenantPhone: formData.status === 'Kiracı' ? formData.tenantPhone : '',
      status: formData.status
    });
    setTimeout(() => {
      setIsSaving(false); setSaveSuccess(true);
      setTimeout(() => { 
        setShowAddModal(false); 
        setSaveSuccess(false);
        setFormData({ no: '', ownerName: '', tenantName: '', phone: '', tenantPhone: '', status: 'Malik' });
      }, 800);
    }, 500);
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
        height: element.scrollHeight,
        windowHeight: element.scrollHeight,
        scrollY: 0, scrollX: 0,
        onclone: (clonedDoc) => {
          const clonedArea = clonedDoc.querySelector('[data-capture-area]');
          if (clonedArea) { (clonedArea as HTMLElement).style.height = 'auto'; (clonedArea as HTMLElement).style.overflow = 'visible'; }
          const toHide = clonedDoc.querySelectorAll('button, .no-print');
          toHide.forEach(el => (el as HTMLElement).style.display = 'none');
          const sticky = clonedDoc.querySelector('.sticky');
          if (sticky) { (sticky as HTMLElement).style.position = 'relative'; (sticky as HTMLElement).style.top = '0'; }
        }
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: imgHeight > 297 ? [imgWidth, imgHeight] : 'a4' });
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      const fileName = `${info.name || 'Yonetim'}_Daire_Listesi.pdf`;
      
      onAddFile(fileName, 'Diğer', pdf.output('datauristring'));

      const pdfBlob = pdf.output('blob');
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Daire Listesi' }); } catch (e) { pdf.save(fileName); }
      } else { 
        pdf.save(fileName);
        alert("Paylaşım desteklenmiyor, dosya hem indirildi hem arşive eklendi."); 
      }
    } catch (err) { alert("PDF hatası."); } finally { setIsProcessingPdf(false); }
  };

  if (selectedUnit) {
    return <UnitDetailView isAdmin={isAdmin} unit={selectedUnit} info={info} transactions={transactions} onClose={() => setSelectedUnit(null)} onUpdate={(u) => { onEditUnit(u); setSelectedUnit(u); }} />;
  }

  return (
    <>
      <div ref={captureAreaRef} data-capture-area className="relative pt-0 pb-20 bg-[#030712] min-h-screen">
        <div className="sticky top-0 z-[100] -mx-4 px-4 pt-5 pb-3 bg-[#030712]/95 backdrop-blur-3xl border-b border-white/5">
          <div className="flex items-center h-10 w-full relative">
            <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5 shrink-0 no-print">
              <ArrowLeft size={20} className="text-zinc-400" />
            </button>
            <div className="flex-1 flex items-center ml-3 overflow-hidden">
              <Home size={22} className="text-zinc-400 mr-2 shrink-0" />
              <h4 className="text-[18px] font-black uppercase tracking-[0.05em] text-white truncate leading-none">DAİRELER</h4>
            </div>
            <div className="flex items-center space-x-1.5 shrink-0 ml-2 no-print">
              {isAdmin && (
                <>
                  <button onClick={handleExportPdf} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all text-green-400 border border-white/5"><Share2 size={20} /></button>
                  <button onClick={() => setShowAddModal(true)} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all text-white border border-white/5"><Plus size={20} /></button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 mt-2 px-1 pb-10">
          {units.sort((a,b) => parseInt(a.no) - parseInt(b.no)).map((unit) => (
            <div key={unit.id} onClick={() => setSelectedUnit(unit)} className="bg-[#111827]/60 backdrop-blur-2xl rounded-[24px] py-3 px-5 flex items-center justify-between border border-white/5 hover:bg-white/10 active:bg-white/10 transition-all cursor-pointer shadow-xl">
              <div className="flex items-center space-x-5 min-w-0">
                <div className="flex flex-col items-center justify-center shrink-0 w-10"><span className="text-[19px] font-black text-white leading-none italic">{unit.no}</span></div>
                <div className="flex-1 min-w-0">
                  <span className="text-[15px] font-bold text-white uppercase truncate block leading-tight">{unit.tenantName || unit.ownerName}</span>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`text-[9px] font-black uppercase tracking-widest leading-none ${unit.tenantName ? 'text-orange-500' : 'text-blue-500'}`}>{unit.tenantName ? 'KİRACI' : 'MALİK'}</span>
                    <div className="flex items-center space-x-1"><Phone size={7} className="text-green-500" /><span className="text-[11px] font-bold tracking-tight text-green-500">{unit.tenantName && unit.tenantPhone ? unit.tenantPhone : (unit.phone || '---')}</span></div>
                  </div>
                </div>
              </div>
              <div className="text-right flex flex-col items-end">
                <span className="text-[9px] font-black text-white leading-none">₺{formatCurrency(unit.credit)}</span>
                <span className="text-[9px] font-black text-red-500 mt-1 leading-none">₺{formatCurrency(unit.debt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAddModal && isAdmin && (
        <div className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-md flex items-center justify-center px-6 animate-in fade-in duration-300">
          <div className="bg-[#1e293b] w-full max-w-sm rounded-[32px] p-6 border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-white">YENİ DAİRE EKLE</h3>
              <button onClick={() => setShowAddModal(false)} className="text-white/40"><X size={24} /></button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                  <label className="text-[9px] font-black text-white/40 uppercase block mb-1">Daire No *</label>
                  <input type="text" value={formData.no} onChange={(e) => setFormData({...formData, no: e.target.value})} className="bg-transparent w-full text-sm font-bold text-white outline-none" placeholder="0" required />
                </div>
                <div className="bg-white/5 p-1 rounded-xl border border-white/5 flex">
                    <button type="button" onClick={() => setFormData({...formData, status: 'Malik'})} className={`flex-1 h-9 rounded-lg text-[8px] font-black transition-all ${formData.status === 'Malik' ? 'bg-blue-600 text-white' : 'text-white/30'}`}>MALİK</button>
                    <button type="button" onClick={() => setFormData({...formData, status: 'Kiracı'})} className={`flex-1 h-9 rounded-lg text-[8px] font-black transition-all ${formData.status === 'Kiracı' ? 'bg-orange-600 text-white' : 'text-white/30'}`}>KİRACI</button>
                </div>
              </div>
              
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-3">
                <div className="flex items-center space-x-3"><User size={16} className="text-blue-400" /><input type="text" placeholder="Malik Ad Soyad *" value={formData.ownerName} onChange={e => setFormData({...formData, ownerName: e.target.value})} className="bg-transparent w-full text-xs font-bold text-white outline-none" required /></div>
                <div className="flex items-center space-x-3 border-t border-white/5 pt-3"><Smartphone size={16} className="text-green-500" /><input type="tel" placeholder="Malik Telefon" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="bg-transparent w-full text-xs font-bold text-white outline-none" /></div>
              </div>

              {formData.status === 'Kiracı' && (
                <div className="bg-orange-600/5 p-3 rounded-xl border border-orange-500/20 space-y-3 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center space-x-3"><User size={16} className="text-orange-400" /><input type="text" placeholder="Kiracı Ad Soyad" value={formData.tenantName} onChange={e => setFormData({...formData, tenantName: e.target.value})} className="bg-transparent w-full text-xs font-bold text-white outline-none" /></div>
                  <div className="flex items-center space-x-3 border-t border-white/5 pt-3"><Smartphone size={16} className="text-orange-400" /><input type="tel" placeholder="Kiracı Telefon" value={formData.tenantPhone} onChange={e => setFormData({...formData, tenantPhone: e.target.value})} className="bg-transparent w-full text-xs font-bold text-white outline-none" /></div>
                </div>
              )}

              <button type="submit" disabled={isSaving} className="w-full h-14 bg-blue-600 text-white rounded-[20px] font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all mt-4">
                {isSaving ? <Loader2 className="animate-spin mx-auto" /> : saveSuccess ? 'BAŞARILI' : 'DAİREYİ KAYDET'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isProcessingPdf && (
        <div className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in"><Loader2 className="animate-spin text-blue-500 mb-3" size={40} /><p className="text-[10px] font-black text-white uppercase tracking-widest">Daire Listesi Hazırlanıyor...</p></div>
      )}
    </>
  );
};

export default UnitsView;
