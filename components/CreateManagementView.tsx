
import React, { useState } from 'react';
import { Home, ChevronLeft, Check, Building2, Users, Loader2, AlertCircle, Building, Layers, LayoutGrid, UserCircle, Hash, MapPin, Save } from 'lucide-react';

interface CreateManagementViewProps {
  onClose: () => void;
  onSuccess: (data: any) => void;
}

type MgmtType = 'Apartman' | 'Site' | 'Blok';

const CreateManagementView: React.FC<CreateManagementViewProps> = ({ onClose, onSuccess }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [mgmtType, setMgmtType] = useState<MgmtType>('Apartman');
  const [formData, setFormData] = useState({
    name: '',
    managerName: '',
    address: '',
    taxNo: '',
    unitCount: '',
    phone: ''
  });

  const toTitleCase = (str: string) => {
    return str
      .split(/(\s+)/)
      .map(part => {
        if (part.trim().length > 0) {
          return part.slice(0, 1).toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR');
        }
        return part;
      })
      .join('');
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      return;
    }
    setIsSubmitting(true);
    // Kayıt simülasyonu
    await new Promise(r => setTimeout(r, 1200));
    
    const fullName = `${toTitleCase(formData.name.trim())} ${mgmtType}`;
    
    setIsSubmitting(false);
    setIsDone(true);
    await new Promise(r => setTimeout(r, 800));
    
    onSuccess({
      name: fullName,
      managerName: toTitleCase(formData.managerName.trim()) || "Yönetici Atanmadı",
      address: formData.address,
      taxNo: formData.taxNo,
      role: "Yönetici",
      duesAmount: 0,
      isManagerExempt: false,
      isAutoDuesEnabled: true,
      managerUnitId: "",
    });
  };

  if (isDone) return (
    <div className="absolute inset-0 z-[150] bg-[#020617] flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
      <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6 animate-bounce border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.1)]">
        <Check size={40} className="text-green-500" strokeWidth={3} />
      </div>
      <h2 className="text-2xl font-black text-white uppercase tracking-tighter">KAYIT BAŞARILI</h2>
      <p className="text-zinc-500 text-[10px] font-bold mt-2 uppercase tracking-[0.3em]">YÖNETİM VERİ TABANI OLUŞTURULDU</p>
      <div className="mt-8 pt-8 border-t border-white/5 w-full">
         <p className="text-white/40 text-[11px] font-bold uppercase tracking-widest">{formData.name} {mgmtType}</p>
         <p className="text-blue-500 text-[13px] font-black uppercase mt-1 italic">{formData.managerName}</p>
      </div>
    </div>
  );

  const types = [
    { id: 'Apartman' as MgmtType, label: 'APARTMAN', icon: <Building size={16} /> },
    { id: 'Site' as MgmtType, label: 'SİTE', icon: <LayoutGrid size={16} /> },
    { id: 'Blok' as MgmtType, label: 'BLOK', icon: <Layers size={16} /> }
  ];

  const isNameEmpty = !formData.name.trim();

  return (
    <div className="absolute inset-0 z-[120] bg-[#020617] p-8 animate-in slide-in-from-right duration-500 overflow-y-auto no-scrollbar">
      <button 
        onClick={onClose} 
        disabled={isSubmitting} 
        className="absolute left-6 top-8 p-2.5 bg-white/5 rounded-xl border border-white/5 active:scale-90 transition-all"
      >
        <ChevronLeft size={20} className="text-zinc-400" />
      </button>

      <div className="flex flex-col items-center text-center mt-12 mb-10">
        <div className="w-20 h-20 bg-white/[0.03] rounded-[32px] border border-white/10 flex items-center justify-center mb-6 shadow-2xl relative">
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 rounded-full animate-pulse border-2 border-[#020617]"></div>
          <Home size={36} className="text-white" strokeWidth={1.5} />
        </div>
        <h2 className="text-[18px] font-black text-white uppercase tracking-[0.15em] leading-none">YENİ YÖNETİM EKLE</h2>
        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.4em] mt-3">OTURUM YAPILANDIRMASI</p>
      </div>

      <div className="space-y-7 max-w-sm mx-auto pb-24 flex flex-col">
        {/* TÜR SEÇİMİ */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 block ml-1">YÖNETİM TÜRÜ SEÇİNİZ</label>
          <div className="grid grid-cols-3 gap-2 bg-white/5 p-1.5 rounded-[22px] border border-white/5">
            {types.map(t => (
              <button
                key={t.id}
                onClick={() => setMgmtType(t.id)}
                className={`flex flex-col items-center justify-center py-3 rounded-2xl transition-all duration-300 ${
                  mgmtType === t.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                {t.icon}
                <span className="text-[9px] font-black mt-1.5 tracking-tighter">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* BİNA İSMİ ALANI */}
        <div>
          <div className="flex justify-between items-center mb-2.5 px-1">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">BİNA / SİTE İSMİ *</label>
            {isNameEmpty && <span className="text-[8px] font-black text-rose-500 uppercase flex items-center gap-1"><AlertCircle size={10}/> ZORUNLU ALAN</span>}
          </div>
          <div className="relative">
            <input 
              type="text" 
              placeholder={`Örn: Galata`} 
              value={formData.name} 
              onChange={e => setFormData({...formData, name: e.target.value})} 
              className={`w-full h-[64px] bg-[#0c111d] border rounded-[22px] pl-14 pr-4 text-[16px] font-black text-white outline-none transition-all placeholder:text-zinc-800 ${
                isNameEmpty ? 'border-rose-500/20 focus:border-rose-500/40' : 'border-white/5 focus:border-blue-500/30'
              }`} 
            />
            <div className={`absolute left-5 top-1/2 -translate-y-1/2 transition-colors ${isNameEmpty ? 'text-rose-900' : 'text-blue-900'}`}>
               <Building2 size={22} strokeWidth={2} />
            </div>
          </div>
        </div>

        {/* YÖNETİCİ İSMİ ALANI */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2.5 block ml-1">YÖNETİCİ ADI SOYADI</label>
          <div className="relative">
            <input 
              type="text" 
              placeholder="Örn: Ahmet Yılmaz" 
              value={formData.managerName} 
              onChange={e => setFormData({...formData, managerName: e.target.value})} 
              className="w-full h-[64px] bg-[#0c111d] border border-white/5 rounded-[22px] pl-14 pr-4 text-[16px] font-black text-white outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-800" 
            />
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-700">
               <UserCircle size={22} strokeWidth={2} />
            </div>
          </div>
        </div>

        {/* EK BİLGİLER */}
        <div className="grid grid-cols-2 gap-4">
           <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2.5 block ml-1">VERGİ NO</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="000..." 
                  value={formData.taxNo} 
                  onChange={e => setFormData({...formData, taxNo: e.target.value})} 
                  className="w-full h-[58px] bg-[#0c111d] border border-white/5 rounded-[18px] pl-12 pr-4 text-sm font-black text-white outline-none focus:border-white/10 transition-all" 
                />
                <Hash size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" />
              </div>
           </div>
           <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2.5 block ml-1">DAİRE SAYISI</label>
              <div className="relative">
                <input 
                  type="number" 
                  placeholder="0" 
                  value={formData.unitCount} 
                  onChange={e => setFormData({...formData, unitCount: e.target.value})} 
                  className="w-full h-[58px] bg-[#0c111d] border border-white/5 rounded-[18px] pl-12 pr-4 text-sm font-black text-white outline-none focus:border-white/10 transition-all" 
                />
                <Users size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" />
              </div>
           </div>
        </div>

        {/* ADRES ALANI */}
        <div>
          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2.5 block ml-1">YÖNETİM ADRESİ</label>
          <div className="relative">
            <textarea 
              placeholder="Tam adres bilgisi..." 
              value={formData.address} 
              onChange={e => setFormData({...formData, address: e.target.value})} 
              className="w-full h-[80px] bg-[#0c111d] border border-white/5 rounded-[22px] pl-12 pr-4 py-4 text-[13px] font-bold text-white outline-none focus:border-blue-500/30 transition-all placeholder:text-zinc-800 resize-none" 
            />
            <div className="absolute left-4 top-5 text-zinc-700">
               <MapPin size={18} strokeWidth={2} />
            </div>
          </div>
        </div>

        <div className="pt-4">
          <button 
            onClick={handleCreate} 
            disabled={isSubmitting || isNameEmpty} 
            className={`w-full h-16 rounded-[28px] flex items-center justify-center space-x-4 active:scale-[0.98] transition-all shadow-2xl border ${
              isNameEmpty 
                ? 'bg-zinc-900/50 border-white/5 opacity-30 cursor-not-allowed' 
                : 'bg-blue-600 border-blue-400/30 hover:bg-blue-500 shadow-blue-600/20'
            }`}
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin text-white" size={24} />
            ) : (
              <>
                <span className="text-[14px] font-black text-white uppercase tracking-[0.2em] ml-1">YÖNETİMİ KAYDET</span>
                <Save size={22} className="text-white" strokeWidth={2.5} />
              </>
            )}
          </button>
          <p className="text-center text-[8px] font-bold text-zinc-700 uppercase tracking-widest mt-4 italic">
            * Kayıt edilen yönetim: {formData.name.trim() || '...'} {mgmtType}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CreateManagementView;
