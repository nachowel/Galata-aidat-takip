
import React, { useState } from 'react';
import { ArrowLeft, UserPlus, Home, User, UserCheck, Phone, CheckCircle2, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Unit } from '../types.ts';

interface MemberRegistrationViewProps {
  onClose: () => void;
  onSave: (unit: Omit<Unit, 'id' | 'credit' | 'debt'>) => void;
}

const MemberRegistrationView: React.FC<MemberRegistrationViewProps> = ({ onClose, onSave }) => {
  const [formData, setFormData] = useState({
    no: '',
    ownerName: '',
    tenantName: '',
    phone: '',
    tenantPhone: '',
    status: 'Malik' as 'Malik' | 'Kiracı',
    type: '3+1',
    m2: '100'
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const toTitleCase = (str: string) => {
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

  const handleProcess = async () => {
    if (!formData.no || !formData.ownerName) {
      alert("Lütfen en az Daire No ve Malik ismini doldurunuz.");
      return;
    }

    setIsSaving(true);
    await new Promise(r => setTimeout(r, 1000));

    onSave({
      no: formData.no,
      ownerName: toTitleCase(formData.ownerName),
      tenantName: formData.status === 'Kiracı' ? toTitleCase(formData.tenantName) : '',
      phone: formData.phone,
      tenantPhone: formData.status === 'Kiracı' ? formData.tenantPhone : '',
      status: formData.status,
      type: formData.type,
      m2: parseFloat(formData.m2) || 0,
      huzurHakki: 'YOK'
    });

    setIsSaving(false);
    setIsSuccess(true);
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 z-[400] bg-[#030712] flex flex-col items-center justify-center p-8 text-center animate-in zoom-in duration-300">
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6 border border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
          <CheckCircle2 size={64} className="text-green-500" />
        </div>
        <h3 className="text-2xl font-black text-white uppercase tracking-widest">KAYIT BAŞARILI</h3>
        <p className="text-white/40 text-sm mt-3 uppercase font-bold tracking-tight">Yeni sakin sisteme dahil edildi.</p>
        <button 
          onClick={onClose} 
          className="mt-12 w-[85%] mx-auto h-14 bg-blue-600 rounded-[28px] font-black text-white uppercase tracking-widest active:scale-95 transition-all shadow-2xl"
        >
          ANASAYFAYA DÖN
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#030712] flex flex-col animate-in slide-in-from-bottom duration-500 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 flex items-center justify-between border-b border-white/5 bg-[#030712]/90 backdrop-blur-xl shrink-0 shadow-xl">
        <button onClick={onClose} className="p-2.5 bg-white/5 rounded-xl text-zinc-400 active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={24} />
        </button>
        <div className="flex flex-col items-center">
           <h3 className="text-[14px] font-black uppercase tracking-[0.2em] text-white">SAKİN KAYDI</h3>
           <p className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Sisteme yeni üye girişi</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-500">
           <UserPlus size={24} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-6 pb-24">
        {/* 1. DAİRE TEMEL BİLGİLERİ */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 px-1">
             <Home size={14} className="text-blue-500" />
             <label className="text-[11px] font-black tracking-widest text-white/40 uppercase">1. BÖLÜM BİLGİLERİ</label>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
             <div className="bg-[#111827] rounded-[24px] p-4 border border-white/10 shadow-inner group focus-within:border-blue-500/50 transition-all">
                <label className="text-[9px] font-black text-white/30 uppercase block mb-1">Daire No *</label>
                <input 
                  type="text" 
                  value={formData.no}
                  onChange={e => setFormData({...formData, no: e.target.value})}
                  className="bg-transparent text-2xl font-black text-white w-full outline-none placeholder:text-white/5"
                  placeholder="0"
                  required
                />
             </div>
             <div className="bg-[#111827] rounded-[24px] p-4 border border-white/10 shadow-inner group focus-within:border-blue-500/50 transition-all">
                <label className="text-[9px] font-black text-white/30 uppercase block mb-1">Daire Tipi</label>
                <input 
                  type="text" 
                  value={formData.type}
                  onChange={e => setFormData({...formData, type: e.target.value})}
                  className="bg-transparent text-xl font-black text-white w-full outline-none"
                  placeholder="3+1"
                />
             </div>
          </div>
        </section>

        {/* 2. MALİK BİLGİLERİ */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 px-1">
             <User size={14} className="text-blue-500" />
             <label className="text-[11px] font-black tracking-widest text-white/40 uppercase">2. MALİK (SAHİBİ) BİLGİLERİ</label>
          </div>
          
          <div className="bg-[#111827] rounded-[32px] p-5 border border-white/10 shadow-xl space-y-5">
             <div className="space-y-2">
                <label className="text-[9px] font-black text-white/20 uppercase block ml-1">Ad Soyad *</label>
                <input 
                  type="text" 
                  value={formData.ownerName}
                  onChange={e => setFormData({...formData, ownerName: e.target.value})}
                  className="bg-black/30 w-full h-14 rounded-2xl px-5 text-base font-bold text-white outline-none border border-white/5 focus:border-blue-500/30 transition-all"
                  placeholder="İsim Soyisim"
                />
             </div>
             <div className="space-y-2">
                <label className="text-[9px] font-black text-white/20 uppercase block ml-1">İletişim Numarası</label>
                <div className="relative">
                  <input 
                    type="tel" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="bg-black/30 w-full h-14 rounded-2xl px-5 pl-12 text-base font-bold text-green-400 outline-none border border-white/5 focus:border-green-500/30 transition-all"
                    placeholder="05xx xxx xx xx"
                  />
                  <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                </div>
             </div>
          </div>
        </section>

        {/* 3. DURUM SEÇİMİ */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 px-1">
             <ShieldCheck size={14} className="text-blue-500" />
             <label className="text-[11px] font-black tracking-widest text-white/40 uppercase">3. İKAMET DURUMU</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
             <button 
                onClick={() => setFormData({...formData, status: 'Malik'})}
                className={`h-16 rounded-[24px] border flex flex-col items-center justify-center transition-all ${formData.status === 'Malik' ? 'bg-blue-600 border-blue-400 shadow-xl text-white' : 'bg-white/5 border-white/5 text-white/30'}`}
             >
                <span className="text-[11px] font-black uppercase tracking-widest">MALİK OTURUYOR</span>
                <span className="text-[7px] font-bold opacity-40">SAHİBİ KULLANIYOR</span>
             </button>
             <button 
                onClick={() => setFormData({...formData, status: 'Kiracı'})}
                className={`h-16 rounded-[24px] border flex flex-col items-center justify-center transition-all ${formData.status === 'Kiracı' ? 'bg-orange-600 border-orange-400 shadow-xl text-white' : 'bg-white/5 border-white/5 text-white/30'}`}
             >
                <span className="text-[11px] font-black uppercase tracking-widest">KİRACI OTURUYOR</span>
                <span className="text-[7px] font-bold opacity-40">KİRALANMIŞ DURUMDA</span>
             </button>
          </div>
        </section>

        {/* 4. KİRACI BİLGİLERİ (Koşullu) */}
        {formData.status === 'Kiracı' && (
          <section className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center space-x-2 px-1">
               <UserCheck size={14} className="text-orange-500" />
               <label className="text-[11px] font-black tracking-widest text-orange-400/60 uppercase">4. KİRACI BİLGİLERİ</label>
            </div>
            
            <div className="bg-[#111827] rounded-[32px] p-5 border border-orange-500/20 shadow-xl space-y-5">
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-white/20 uppercase block ml-1">Kiracı Ad Soyad</label>
                  <input 
                    type="text" 
                    value={formData.tenantName}
                    onChange={e => setFormData({...formData, tenantName: e.target.value})}
                    className="bg-black/30 w-full h-14 rounded-2xl px-5 text-base font-bold text-white outline-none border border-white/5 focus:border-orange-500/30 transition-all"
                    placeholder="Kiracı İsmi"
                  />
               </div>
               <div className="space-y-2">
                  <label className="text-[9px] font-black text-white/20 uppercase block ml-1">Kiracı İletişim</label>
                  <div className="relative">
                    <input 
                      type="tel" 
                      value={formData.tenantPhone}
                      onChange={e => setFormData({...formData, tenantPhone: e.target.value})}
                      className="bg-black/30 w-full h-14 rounded-2xl px-5 pl-12 text-base font-bold text-orange-400 outline-none border border-white/5 focus:border-orange-500/30 transition-all"
                      placeholder="05xx xxx xx xx"
                    />
                    <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
                  </div>
               </div>
            </div>
          </section>
        )}

        <button 
          onClick={handleProcess}
          disabled={isSaving}
          className="w-[85%] mx-auto h-14 bg-green-600 hover:bg-green-500 text-white rounded-[32px] flex items-center justify-center space-x-4 shadow-[0_20px_50px_rgba(34,197,94,0.3)] active:scale-95 transition-all mt-8"
        >
          {isSaving ? <Loader2 className="animate-spin" size={28} /> : (
            <>
              <Save size={24} />
              <span className="text-[15px] font-black uppercase tracking-[0.2em]">KAYDI TAMAMLA</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default MemberRegistrationView;
