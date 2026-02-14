
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, CheckCircle2, UserPlus, Home, ChevronDown, Wallet, Briefcase, Calendar, Save, Loader2, User, UserCheck, Check, Phone } from 'lucide-react';
import { Unit, BuildingInfo } from '../types.ts';

interface BorclandirViewProps {
  units: Unit[];
  info: BuildingInfo;
  onClose: () => void;
  onSave: (amount: number, description: string, vault: 'genel' | 'demirbas', date: string, unitId: string, month: number, year: number) => void;
}

const BorclandirView: React.FC<BorclandirViewProps> = ({ units, info, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    unitId: '',
    amount: '',
    description: '',
    kasa: 'genel' as 'genel' | 'demirbas',
    debtorType: 'Malik' as 'Malik' | 'Kiracı',
    date: new Date().toISOString().split('T')[0]
  });

  const [showUnitList, setShowUnitList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const selectedUnit = units.find(u => u.id === formData.unitId);

  const selectableUnits = useMemo(() => 
    units.filter(u => !(info.isManagerExempt && u.id === info.managerUnitId))
         .sort((a, b) => parseInt(a.no) - parseInt(b.no)),
    [units, info]
  );

  useEffect(() => {
    if (selectedUnit) {
      const typeLabel = formData.debtorType === 'Kiracı' ? 'Kiracı' : 'Malik';
      const newDesc = `${selectedUnit.no} Nolu Daire ${typeLabel} Borçlandırma`;
      if (!formData.description || formData.description.includes('Borçlandırma')) {
        setFormData(prev => ({ ...prev, description: newDesc }));
      }
    }
  }, [formData.unitId, formData.debtorType, selectedUnit]);

  const handleUnitSelect = (unit: Unit) => {
    setFormData(prev => ({
      ...prev,
      unitId: unit.id,
      debtorType: unit.tenantName ? 'Kiracı' : 'Malik',
      amount: prev.amount || (info.duesAmount || 750).toString()
    }));
    setShowUnitList(false);
  };

  const handleProcess = async () => {
    const numAmount = parseFloat(formData.amount);
    if (!formData.unitId || !numAmount || numAmount <= 0) return;
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setSaveComplete(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const kasaName = formData.kasa === 'genel' ? 'Genel Gider' : 'Demirbaş';
    const finalDescription = `${formData.description || 'Borçlandırma'} [${kasaName}]`;
    const d = new Date(formData.date);
    setIsSuccess(true);
    setTimeout(() => {
      onSave(numAmount, finalDescription, formData.kasa, formData.date, formData.unitId, d.getMonth(), d.getFullYear());
    }, 500);
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in duration-500">
        <div className="bg-orange-500/20 p-8 rounded-full mb-6 border border-orange-500/20">
          <CheckCircle2 size={80} className="text-orange-500" />
        </div>
        <h2 className="text-2xl font-black uppercase tracking-widest text-orange-400">BORÇ KAYDEDİLDİ</h2>
        <p className="text-zinc-400 text-[14px] font-bold mt-2 uppercase tracking-tight text-center px-10">Daire borç bakiyesi güncellendi</p>
      </div>
    );
  }

  return (
    <div className="animate-in slide-in-from-bottom-6 duration-500 pt-0 pb-16">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-2.5 mb-2 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={24} className="text-zinc-400" />
        </button>
        <h3 className="text-[17px] font-black uppercase tracking-[0.2em] text-red-500 text-center">BORÇLANDIRMA</h3>
        <div className="w-10" />
      </div>

      <div className="space-y-4 px-1">
        <section>
          <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-1.5 block ml-1 text-center">1. KASA SEÇİMİ</label>
          <div className="grid grid-cols-2 gap-2.5 w-full">
            <button onClick={() => setFormData(prev => ({...prev, kasa: 'genel'}))} className={`h-12 rounded-xl flex items-center justify-center space-x-2 border transition-all ${formData.kasa === 'genel' ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'}`}><Wallet size={16} /><span className="text-[12px] font-black uppercase tracking-widest">Genel Gider</span></button>
            <button onClick={() => setFormData(prev => ({...prev, kasa: 'demirbas'}))} className={`h-12 rounded-xl flex items-center justify-center space-x-2 border transition-all ${formData.kasa === 'demirbas' ? 'bg-blue-500/10 border-blue-500/40 text-blue-400' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'}`}><Briefcase size={16} /><span className="text-[12px] font-black uppercase tracking-widest">Demirbaş</span></button>
          </div>
        </section>

        <section className="relative">
          <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-1.5 block ml-1 text-center">2. DAİRE SEÇİMİ</label>
          <div className={`rounded-2xl border border-white/10 overflow-hidden shadow-2xl transition-all ${selectedUnit ? 'bg-[#111827]' : 'bg-gradient-to-br from-slate-800 to-slate-900'}`}>
            <button onClick={() => setShowUnitList(!showUnitList)} className="w-full min-h-[52px] py-1.5 flex items-center justify-between px-4 active:scale-[0.98] transition-all">
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all shadow-xl shrink-0 ${selectedUnit ? 'bg-red-600 text-white' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>{selectedUnit ? selectedUnit.no : <Home size={16} />}</div>
                <div className="flex flex-col text-left min-w-0">
                  <div className="flex items-center space-x-2">
                    {selectedUnit && <span className="text-[9px] font-black text-red-500/70 uppercase">NO {selectedUnit.no}</span>}
                    <span className={`text-[15px] font-black uppercase tracking-tighter leading-none truncate ${selectedUnit ? 'text-zinc-100' : 'text-red-500'}`}>
                      {selectedUnit ? (selectedUnit.tenantName || selectedUnit.ownerName).toUpperCase() : 'DAİRE SEÇİNİZ...'}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronDown size={16} className="text-zinc-400 transition-transform duration-300" style={{ transform: showUnitList ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>
            {showUnitList && (
              <div className="flex flex-col space-y-1 p-1 bg-black/40 mx-1 mb-1 rounded-b-xl max-h-[220px] overflow-y-auto no-scrollbar border-t border-white/10">
                {selectableUnits.map((unit) => (
                  <button key={unit.id} onClick={() => handleUnitSelect(unit)} className={`w-full py-2 px-3 rounded-xl flex items-center justify-between transition-all ${formData.unitId === unit.id ? 'bg-red-500/20 border border-red-500/40' : 'hover:bg-white/5 border border-transparent'}`}>
                    <div className="flex items-center space-x-3 min-w-0">
                       <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black bg-red-600 text-white shrink-0">{unit.no}</div>
                       <div className="flex flex-col text-left min-w-0">
                          <span className="text-[11px] font-bold uppercase truncate text-zinc-300">{unit.ownerName}</span>
                       </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-1.5 block ml-1 text-center">3. BORÇLU TÜRÜ</label>
          <div className="grid grid-cols-2 gap-2.5 w-full">
            <button type="button" disabled={!!selectedUnit?.tenantName} onClick={() => setFormData(prev => ({...prev, debtorType: 'Malik'}))} className={`flex items-center justify-center space-x-2 h-11 rounded-xl border transition-all ${formData.debtorType === 'Malik' ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'} disabled:opacity-20 disabled:grayscale disabled:pointer-events-none`}><User size={14} /><span className="text-[11px] font-black uppercase tracking-widest">MALİK</span></button>
            <button type="button" disabled={!selectedUnit?.tenantName} onClick={() => setFormData(prev => ({...prev, debtorType: 'Kiracı'}))} className={`flex items-center justify-center space-x-2 h-11 rounded-xl border transition-all ${formData.debtorType === 'Kiracı' ? 'bg-orange-600 border-orange-400 text-white shadow-lg' : 'bg-white/5 border-white/5 text-zinc-500 hover:bg-white/10'} disabled:opacity-20 disabled:grayscale disabled:pointer-events-none`}><UserCheck size={14} /><span className="text-[11px] font-black uppercase tracking-widest">KİRACI</span></button>
          </div>
        </section>

        <section>
          <label className="text-[11px] font-black tracking-widest text-zinc-400 uppercase mb-1.5 block ml-1 text-center">4. İŞLEM DETAYLARI</label>
          <div className="glass-panel rounded-[24px] p-4 space-y-4 border border-white/10 bg-[#111827]/40 shadow-inner">
            <div className="grid grid-cols-2 gap-3 w-full">
              <div className="flex flex-col w-full">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] block mb-1.5 text-center">İŞLEM TARİHİ</label>
                <input 
                  type="date" 
                  value={formData.date} 
                  onChange={(e) => setFormData(prev => ({...prev, date: e.target.value}))} 
                  className="bg-black/60 w-full h-16 rounded-xl px-2 text-[15px] font-black text-zinc-300 outline-none border border-white/10 text-center shadow-2xl transition-all" 
                />
              </div>
              <div className="flex flex-col w-full">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] block mb-1.5 text-center">MİKTAR (₺)</label>
                <input 
                  type="number" 
                  placeholder="0.00" 
                  value={formData.amount} 
                  onChange={(e) => setFormData(prev => ({...prev, amount: e.target.value}))} 
                  className="bg-black/60 w-full h-16 rounded-xl px-2 text-[26px] font-black text-orange-400 outline-none border border-white/10 text-center shadow-2xl transition-all" 
                />
              </div>
            </div>
            <div>
              <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.1em] block mb-1.5 ml-1 text-center">AÇIKLAMA</label>
              <input 
                type="text" 
                placeholder="Örn: Aidat Borcu" 
                value={formData.description} 
                onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))} 
                className="bg-black/20 w-full h-11 rounded-xl px-4 text-[12px] font-bold text-zinc-300 outline-none border border-white/5 shadow-inner" 
              />
            </div>
          </div>
        </section>

        <button onClick={handleProcess} disabled={!formData.unitId || !formData.amount || isSaving} className={`w-full h-14 rounded-[20px] shadow-2xl flex items-center justify-center space-x-3 active:scale-95 transition-all ${formData.unitId && formData.amount ? 'bg-orange-600' : 'bg-white/5 grayscale cursor-not-allowed opacity-30'}`}>{isSaving ? <Loader2 className="animate-spin text-white" size={22} /> : saveComplete ? <div className="flex items-center space-x-2"><CheckCircle2 size={20} className="text-white" /><span className="text-[13px] font-black text-white uppercase tracking-widest">KAYDEDİLDİ</span></div> : <><Save size={20} className="text-white" /><span className="text-[13px] font-black text-white uppercase tracking-widest">BORCU KAYDET</span></>}</button>
      </div>
    </div>
  );
};

export default BorclandirView;
