
import React, { useState } from 'react';
import { ChevronLeft, Check, Building, MapPin, Loader2, Hash, CheckCircle2, Banknote, Shield } from 'lucide-react';
import { BuildingInfo, Unit } from '../types.ts';

interface EditManagementViewProps {
  info: BuildingInfo;
  units?: Unit[];
  onClose: () => void;
  onSuccess: (data: BuildingInfo) => void;
}

const EditManagementView: React.FC<EditManagementViewProps> = ({ info, units = [], onClose, onSuccess }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  
  const [formData, setFormData] = useState({
    name: info.name || '',
    address: info.address || '',
    taxNo: info.taxNo || '',
    duesAmount: (info.duesAmount || 0).toString(),
    isAutoDuesEnabled: info.isAutoDuesEnabled !== undefined ? info.isAutoDuesEnabled : true,
    isManagerExempt: info.isManagerExempt || false,
    managerUnitId: info.managerUnitId || ''
  });

  const handleUpdate = async () => {
    if (!formData.name.trim()) {
      alert("Yönetim adı boş bırakılamaz.");
      return;
    }
    setIsSubmitting(true);
    
    // Kısa bir bekleme ile kaydediliyor hissi verelim
    await new Promise(r => setTimeout(r, 600));
    
    const updatedData: BuildingInfo = {
      ...info,
      name: formData.name,
      taxNo: formData.taxNo,
      duesAmount: parseFloat(formData.duesAmount) || 0,
      isAutoDuesEnabled: formData.isAutoDuesEnabled,
      isManagerExempt: formData.isManagerExempt,
      managerUnitId: formData.managerUnitId,
      address: formData.address,
    };

    setIsSubmitting(false);
    setIsSuccess(true);
    
    // Hemen ana state'i güncelle, sonra ekranı kapat
    onSuccess(updatedData);
    setTimeout(() => onClose(), 1000);
  };

  return (
    <div className="fixed inset-0 z-[300] bg-[#030712] p-8 animate-in slide-in-from-right duration-500 overflow-y-auto no-scrollbar">
      {!isSuccess && (
        <button 
          onClick={onClose} 
          className="absolute left-6 top-8 p-3 bg-white/5 rounded-2xl border border-white/5 active:scale-90 transition-all"
        >
          <ChevronLeft size={24} className="text-zinc-400" />
        </button>
      )}

      {isSuccess ? (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
           <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-4 border border-green-500/30 animate-bounce">
             <CheckCircle2 size={48} className="text-green-500" />
           </div>
           <h2 className="text-2xl font-black text-white uppercase tracking-tighter">BİLGİLER GÜNCELLENDİ</h2>
           <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Yönlendiriliyorsunuz...</p>
        </div>
      ) : (
        <div className="max-w-sm mx-auto pt-16 pb-24 space-y-8">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-blue-600/10 rounded-[30px] border border-blue-500/20 flex items-center justify-center mx-auto mb-4 shadow-2xl">
              <Shield size={40} className="text-blue-500" />
            </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">YÖNETİM AYARLARI</h2>
            <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.3em] mt-2">SİSTEM YAPILANDIRMASI</p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-2.5 block ml-1">Yönetim Adı</label>
              <div className="relative group">
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className="w-full h-15 bg-[#111827] border border-white/10 rounded-2xl pl-12 pr-4 text-sm font-black text-white outline-none focus:border-blue-500/50 transition-all" 
                />
                <Building size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-blue-500" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-2.5 block ml-1">Vergi Numarası</label>
              <div className="relative group">
                <input 
                  type="text" 
                  placeholder="Opsiyonel"
                  value={formData.taxNo} 
                  onChange={e => setFormData({...formData, taxNo: e.target.value})} 
                  className="w-full h-15 bg-[#111827] border border-white/10 rounded-2xl pl-12 pr-4 text-sm font-black text-white outline-none focus:border-blue-500/50 transition-all placeholder:text-white/5" 
                />
                <Hash size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-blue-500" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-2.5 block ml-1">Aylık Aidat (₺)</label>
              <div className="relative group">
                <input 
                  type="number" 
                  value={formData.duesAmount} 
                  onChange={e => setFormData({...formData, duesAmount: e.target.value})} 
                  className="w-full h-15 bg-[#111827] border border-white/10 rounded-2xl pl-12 pr-4 text-xl font-black text-white outline-none focus:border-emerald-500/50 transition-all" 
                />
                <Banknote size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500/40 group-focus-within:text-emerald-500" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-2.5 block ml-1">Yönetim Adresi</label>
              <div className="relative group">
                <textarea 
                  value={formData.address} 
                  onChange={e => setFormData({...formData, address: e.target.value})} 
                  className="w-full h-28 bg-[#111827] border border-white/10 rounded-2xl pl-12 pr-4 pt-4 text-sm font-bold text-white outline-none focus:border-blue-500/50 resize-none transition-all placeholder:text-white/5" 
                  placeholder="Tam adres giriniz..."
                />
                <MapPin size={18} className="absolute left-4 top-5 text-white/20 group-focus-within:text-blue-500" />
              </div>
            </div>

            <button 
              onClick={handleUpdate} 
              disabled={isSubmitting} 
              className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white rounded-3xl flex items-center justify-center space-x-3 active:scale-95 transition-all mt-4 shadow-[0_20px_40px_rgba(37,99,235,0.2)] disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin text-white" size={24} />
              ) : (
                <>
                  <span className="text-sm font-black text-white uppercase tracking-[0.2em]">AYARLARI KAYDET</span>
                  <Check size={20} className="text-white" strokeWidth={3} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditManagementView;
