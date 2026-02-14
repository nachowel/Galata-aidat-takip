
import React, { useState } from 'react';
import { Save, Loader2, X, Check, ChevronRight, Building2, ShieldCheck, ToggleLeft, ToggleRight, User, Home, Trash2, AlertTriangle } from 'lucide-react';
import { BuildingInfo, Unit } from '../types.ts';

interface SettingsViewProps {
  buildingInfo: BuildingInfo;
  onUpdateBuildingInfo: (i: BuildingInfo) => void;
  units: Unit[];
  onResetMoney: () => void;
  onClearFiles?: () => void;
  onDeleteSession?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ buildingInfo, onUpdateBuildingInfo, units, onResetMoney, onClearFiles, onDeleteSession }) => {
  const [st, setSt] = useState({ 
    ...buildingInfo, 
    duesAmount: buildingInfo.duesAmount === 0 ? '' : buildingInfo.duesAmount.toString(),
    managerName: buildingInfo.managerName || '',
    name: buildingInfo.name || ''
  });
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 800));
    onUpdateBuildingInfo({ 
      ...buildingInfo, 
      name: st.name, 
      address: st.address, 
      managerName: st.managerName, 
      duesAmount: parseFloat(st.duesAmount) || 0, 
      managerUnitId: st.managerUnitId, 
      isManagerExempt: st.isManagerExempt, 
      isAutoDuesEnabled: st.isAutoDuesEnabled 
    });
    setIsSaving(false);
  };

  const handleDeleteCancelledDocs = () => {
    const firstConfirm = window.confirm("Arşivdeki tüm belgeleri silmek istediğinize emin misiniz?");
    if (firstConfirm) {
      const secondConfirm = window.confirm("DİKKAT: Bu işlem geri alınamaz. Arşiv tamamen temizlenecektir. Onaylıyor musunuz?");
      if (secondConfirm) {
        if (onClearFiles) onClearFiles();
        alert("Dosya arşivi başarıyla temizlendi.");
      }
    }
  };

  const handleClearAccountingData = () => {
    const firstConfirm = window.confirm("TÜM MUHASEBE VERİLERİNİ SIFIRLAMAK ÜZERESİNİZ. Emin misiniz?");
    if (firstConfirm) {
      const secondConfirm = window.confirm("SON UYARI: Bugüne kadar yapılan tüm gelir/gider hareketleri kalıcı olarak silinecektir. Onaylıyor musunuz?");
      if (secondConfirm) {
        onResetMoney();
        alert("Muhasebe verileri tamamen sıfırlandı.");
      }
    }
  };

  const selectedManagerUnit = units.find(u => u.id === st.managerUnitId);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-40 pt-2 px-1 space-y-3">
      
      {/* GENEL AYARLAR BÖLÜMÜ */}
      <section className="bg-blue-900/10 backdrop-blur-md rounded-[32px] p-5 border border-white/5 shadow-xl space-y-4">
        
        <div className="flex items-center space-x-2 opacity-40 mb-1 px-1">
          <ShieldCheck size={16} className="text-blue-400" />
          <h2 className="text-[10px] font-black tracking-[0.25em] uppercase text-blue-100 italic">GENEL YÖNETİM AYARLARI</h2>
        </div>
        
        <div className="space-y-3">
          <div className="bg-black/40 p-3.5 rounded-2xl border border-white/5 shadow-inner transition-all focus-within:border-blue-500/30">
            <label className="text-[8px] font-black text-zinc-500 uppercase block mb-1.5 ml-1 tracking-widest">Bina / Site İsmi</label>
            <div className="flex items-center">
              <Home size={18} className="text-blue-400 mr-3 shrink-0" />
              <input 
                type="text" 
                value={st.name} 
                onChange={e => setSt({ ...st, name: e.target.value })} 
                className="bg-transparent outline-none font-black text-sm w-full text-zinc-300 uppercase tracking-tight" 
                placeholder="ÖRN: GALATA APARTMANI"
              />
            </div>
          </div>

          <div className="bg-black/40 p-3.5 rounded-2xl border border-white/5 shadow-inner transition-all focus-within:border-blue-500/30">
            <label className="text-[8px] font-black text-zinc-500 uppercase block mb-1.5 ml-1 tracking-widest">Aylık Aidat Tutarı</label>
            <div className="flex items-center">
              <span className="text-blue-400 text-xl font-black mr-2 leading-none">₺</span>
              <input 
                type="number" 
                value={st.duesAmount} 
                onChange={e => setSt({ ...st, duesAmount: e.target.value })} 
                className="bg-transparent outline-none font-black text-2xl w-full text-zinc-300 leading-none" 
              />
            </div>
          </div>
          
          <div className="flex items-center justify-between bg-black/20 p-3 rounded-2xl border border-white/5">
            <div className="flex flex-col">
              <p className="text-[11px] font-black uppercase tracking-wider text-zinc-300">Otomatik Aidat</p>
              <p className="text-[8px] font-bold text-zinc-500 uppercase mt-0.5 tracking-tighter">Her ay otomatik borçlandır</p>
            </div>
            <button onClick={() => setSt({ ...st, isAutoDuesEnabled: !st.isAutoDuesEnabled })} className={`transition-all ${st.isAutoDuesEnabled ? "text-blue-400" : "text-zinc-700"}`}>
              {st.isAutoDuesEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </div>
        </div>

        <div className="h-px bg-white/5 w-full"></div>

        <div className="space-y-3">
          <div className="bg-black/40 p-3.5 rounded-2xl border border-white/5 shadow-inner transition-all focus-within:border-blue-500/30">
            <label className="text-[8px] font-black text-zinc-500 uppercase block mb-1.5 ml-1 tracking-widest">Yönetici İsmi</label>
            <div className="flex items-center">
              <User size={18} className="text-blue-400 mr-3 shrink-0" />
              <input 
                type="text" 
                value={st.managerName} 
                onChange={e => setSt({ ...st, managerName: e.target.value })} 
                className="bg-transparent outline-none font-black text-sm w-full text-zinc-300 uppercase tracking-tight" 
                placeholder="YÖNETİCİ ADI SOYADI"
              />
            </div>
          </div>

          <div>
            <label className="text-[8px] font-black text-zinc-500 uppercase block mb-1.5 ml-1 tracking-widest">Yönetici Dairesi</label>
            <button 
              onClick={() => setShowUnitModal(true)} 
              className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 flex items-center justify-between active:bg-white/10 transition-all"
            >
              <div className="flex items-center space-x-3">
                <div className="w-7 h-7 rounded-full bg-blue-600/10 flex items-center justify-center border border-blue-500/20">
                    <Building2 size={14} className="text-blue-400" />
                </div>
                <span className="text-[12px] font-black text-zinc-300 truncate max-w-[180px] tracking-tight uppercase">
                  {selectedManagerUnit ? `${selectedManagerUnit.no}. Daire` : 'Seçiniz...'}
                </span>
              </div>
              <ChevronRight size={16} className="text-zinc-500" />
            </button>
          </div>

          <div className="flex items-center justify-between bg-black/20 p-3 rounded-2xl border border-white/5">
            <div className="flex flex-col">
              <p className="text-[11px] font-black uppercase tracking-wider text-zinc-300">Yönetici Muafiyeti</p>
              <p className="text-[8px] font-bold text-zinc-500 uppercase mt-0.5 tracking-tighter">Seçili daire aidat ödemez</p>
            </div>
            <button 
              disabled={!st.managerUnitId}
              onClick={() => setSt({ ...st, isManagerExempt: !st.isManagerExempt })} 
              className={`transition-all ${st.isManagerExempt ? "text-blue-400" : "text-zinc-700"} disabled:opacity-10`}
            >
              {st.isManagerExempt ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </div>
        </div>

        <button 
          onClick={handleSave} 
          disabled={isSaving} 
          className="w-full h-12 bg-blue-600 rounded-2xl flex items-center justify-center space-x-3 active:scale-95 transition-all shadow-xl shadow-blue-900/30 mt-2"
        >
          {isSaving ? <Loader2 className="animate-spin" size={20} /> : (
            <>
              <span className="font-black text-[11px] tracking-[0.2em] uppercase text-white">AYARLARI KAYDET</span>
              <Save size={18} className="text-white" />
            </>
          )}
        </button>
      </section>

      {/* VERİ YÖNETİMİ BÖLÜMÜ */}
      <section className="bg-red-900/5 backdrop-blur-md rounded-[40px] p-5 border border-red-500/10 shadow-2xl space-y-3">
        <div className="flex items-center space-x-2.5 opacity-60 px-1">
          <Trash2 size={16} className="text-rose-500" />
          <h2 className="text-[11px] font-black tracking-[0.25em] uppercase text-rose-200">VERİ YÖNETİMİ</h2>
        </div>

        {/* İptalli Belgeler */}
        <div className="bg-[#0f172a]/60 rounded-[28px] p-4 border border-white/5 space-y-2">
          <h3 className="text-[12px] font-black text-zinc-200 uppercase tracking-widest ml-1">ARŞİV BELGELERİ</h3>
          <p className="text-[9px] font-bold text-zinc-500 uppercase leading-relaxed tracking-tight px-1">
            Dijital arşivdeki tüm belgeleri ve dekontları kalıcı olarak temizleyin.
          </p>
          <button 
            onClick={handleDeleteCancelledDocs}
            className="w-full h-11 bg-rose-600/80 hover:bg-rose-500 rounded-xl flex items-center justify-center space-x-3 active:scale-95 transition-all shadow-lg"
          >
            <AlertTriangle size={18} className="text-white" />
            <span className="text-[13px] font-black text-white uppercase tracking-[0.2em]">ARŞİVİ SİL</span>
          </button>
        </div>

        {/* Muhasebe Verileri */}
        <div className="bg-[#0f172a]/60 rounded-[28px] p-4 border border-white/5 space-y-2">
          <h3 className="text-[12px] font-black text-zinc-200 uppercase tracking-widest ml-1">MUHASEBE VERİLERİ</h3>
          <p className="text-[9px] font-bold text-zinc-500 uppercase leading-relaxed tracking-tight px-1">
            Tüm gelir ve gider hareketlerini sıfırlayın. Bu işlem geri alınamaz.
          </p>
          <button
            onClick={handleClearAccountingData}
            className="w-full h-11 bg-rose-600/80 hover:bg-rose-500 rounded-xl flex items-center justify-center space-x-3 active:scale-95 transition-all shadow-lg"
          >
            <AlertTriangle size={18} className="text-white" />
            <span className="text-[13px] font-black text-white uppercase tracking-[0.2em]">HER ŞEYİ TEMİZLE</span>
          </button>
        </div>

        {/* Oturum Silme */}
        {onDeleteSession && (
          <div className="bg-red-950/40 rounded-[28px] p-4 border border-red-500/20 space-y-2">
            <h3 className="text-[12px] font-black text-red-300 uppercase tracking-widest ml-1">OTURUMU SİL</h3>
            <p className="text-[9px] font-bold text-zinc-500 uppercase leading-relaxed tracking-tight px-1">
              Sadece şu an açık olan oturumun tüm verilerini (birim, muhasebe, arşiv, kurul) kalıcı olarak siler. Diğer oturumlara dokunulmaz.
            </p>
            <button
              onClick={() => {
                const firstConfirm = window.confirm(
                  `"${buildingInfo.name}" oturumuna ait TÜM VERİLER kalıcı olarak silinecektir. Emin misiniz?`
                );
                if (firstConfirm) {
                  const secondConfirm = window.confirm(
                    "SON UYARI: Bu işlem geri alınamaz! Oturuma ait bina bilgileri, daireler, muhasebe kayıtları, yönetim kurulu ve arşiv belgeleri tamamen silinecektir. Onaylıyor musunuz?"
                  );
                  if (secondConfirm) {
                    onDeleteSession();
                  }
                }
              }}
              className="w-full h-12 bg-red-700 hover:bg-red-600 rounded-xl flex items-center justify-center space-x-3 active:scale-95 transition-all shadow-lg shadow-red-900/40 border border-red-500/30"
            >
              <Trash2 size={20} className="text-white" />
              <span className="text-[13px] font-black text-white uppercase tracking-[0.2em]">OTURUMU KALICI SİL</span>
            </button>
          </div>
        )}
      </section>

      <p className="text-center text-[7px] font-black uppercase tracking-[0.5em] text-zinc-800 mt-4">
        GALATA DİJİTAL YÖNETİM SİSTEMİ
      </p>

      {/* Daire Seçici Modal */}
      {showUnitModal && (
        <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex items-center justify-center px-6 animate-in fade-in duration-300">
          <div className="bg-[#1e293b] w-full max-w-sm rounded-[32px] p-6 border border-white/10 shadow-2xl max-h-[70vh] flex flex-col">
            <div className="flex justify-between items-center mb-5 px-1">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">DAİRE SEÇ</h3>
              <button onClick={() => setShowUnitModal(false)} className="text-zinc-500 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 no-scrollbar px-1">
              {units.sort((a,b) => parseInt(a.no) - parseInt(b.no)).map(u => (
                <button 
                  key={u.id} 
                  onClick={() => { setSt({ ...st, managerUnitId: u.id }); setShowUnitModal(false); }} 
                  className={`w-full py-3 px-4 rounded-xl flex items-center justify-between border transition-all active:scale-[0.98] ${st.managerUnitId === u.id ? 'bg-blue-600 border-blue-400 shadow-lg' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex flex-col text-left">
                    <span className="text-sm font-black uppercase text-zinc-100 tracking-tight">{u.no}. Daire</span>
                  </div>
                  {st.managerUnitId === u.id && <Check size={18} className="text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
