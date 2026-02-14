
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, RotateCcw, Wallet, Briefcase, Home, ChevronDown, User, UserCheck, Save, Loader2, Check } from 'lucide-react';
import { Unit, BuildingInfo } from '../types.ts';

interface IadeViewProps {
  units: Unit[];
  info: BuildingInfo;
  onClose: () => void;
  onSave: (amount: number, description: string, sourceVault: 'genel' | 'demirbas', date: string, unitId: string) => void;
}

const IadeView: React.FC<IadeViewProps> = ({ units, info, onClose, onSave }) => {
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [sourceVault, setSourceVault] = useState<'genel' | 'demirbas'>('genel');
  const [selectedReturnType, setSelectedReturnType] = useState<'Malik' | 'Kiracı'>('Malik');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showUnitList, setShowUnitList] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);

  const selectedUnit = units.find(u => u.id === selectedUnitId);
  const selectableUnits = useMemo(() => [...units].sort((a, b) => parseInt(a.no) - parseInt(b.no)), [units]);

  useEffect(() => {
    if (selectedUnit) {
      const typeLabel = selectedReturnType === 'Kiracı' ? 'Kiracı' : 'Malik';
      const autoDesc = `${selectedUnit.no} Nolu Daire ${typeLabel} İadesi`;
      if (!description || description.includes('İadesi')) {
        setDescription(autoDesc);
      }
    }
  }, [selectedUnitId, selectedReturnType, selectedUnit, description]);

  const handleUnitSelect = (unit: Unit) => {
    setSelectedUnitId(unit.id);
    setShowUnitList(false);
    setSelectedReturnType(unit.tenantName ? 'Kiracı' : 'Malik');
  };

  const handleProcess = async () => {
    const numAmount = parseFloat(amount);
    if (!selectedUnitId || !numAmount || numAmount <= 0) return;
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setSaveComplete(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    const finalDescription = `${description} [${sourceVault === 'genel' ? 'Genel' : 'Demirbaş'}]`;
    setIsSuccess(true);
    setTimeout(() => onSave(numAmount, finalDescription, sourceVault, selectedDate, selectedUnitId), 500);
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in duration-500 text-center">
        <RotateCcw size={80} className="text-red-500 mb-6" />
        <h2 className="text-2xl font-black uppercase tracking-widest text-red-400">İADE TAMAMLANDI</h2>
        <button onClick={onClose} className="mt-8 px-10 py-4 bg-white/10 rounded-2xl font-black">GERİ DÖN</button>
      </div>
    );
  }

  return (
    <div className="animate-in slide-in-from-bottom-6 duration-500 pt-0 pb-20">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-2.5 mb-2 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5"><ArrowLeft size={24} className="text-zinc-400" /></button>
        <h3 className="text-[17px] font-black uppercase tracking-[0.2em] text-red-500 text-center">İADE İŞLEMİ</h3>
        <div className="w-10" />
      </div>

      <div className="space-y-4 px-1">
        <section>
          <label className="text-[10px] font-black tracking-widest text-white/40 uppercase mb-1.5 block ml-1">1. KAYNAK KASA</label>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => setSourceVault('genel')} className={`h-12 rounded-xl flex items-center justify-center space-x-2 border transition-all ${sourceVault === 'genel' ? 'bg-red-500/10 border-red-500/40 text-red-400' : 'bg-white/5 border-white/5 text-white/20'}`}><Wallet size={18} /><span className="text-[12px] font-black uppercase tracking-widest">Genel Gider</span></button>
            <button onClick={() => setSourceVault('demirbas')} className={`h-12 rounded-xl flex items-center justify-center space-x-2 border transition-all ${sourceVault === 'demirbas' ? 'bg-blue-500/10 border-blue-500/40 text-blue-400' : 'bg-white/5 border-white/5 text-white/20'}`}><Briefcase size={18} /><span className="text-[12px] font-black uppercase tracking-widest">Demirbaş</span></button>
          </div>
        </section>

        <section className="relative">
          <label className="text-[10px] font-black tracking-widest text-white/40 uppercase mb-1.5 block ml-1">2. DAİRE SEÇİMİ</label>
          <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-[#111827]">
            <button onClick={() => setShowUnitList(!showUnitList)} className="w-full min-h-[56px] py-2 flex items-center justify-between px-4 active:scale-[0.98] transition-all">
              <div className="flex items-center space-x-3 min-w-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black transition-all shadow-xl shrink-0 ${selectedUnit ? 'bg-blue-600 text-white' : 'bg-green-500/10 text-green-500'}`}>{selectedUnit ? selectedUnit.no : <Home size={18} />}</div>
                <div className="flex flex-col text-left min-w-0">
                  <span className={`text-[13px] font-black uppercase tracking-tighter leading-none truncate ${selectedUnit ? 'text-white' : 'text-blue-500'}`}>
                    {selectedUnit ? (selectedUnit.tenantName || selectedUnit.ownerName).toUpperCase() : 'DAİRE SEÇİNİZ...'}
                  </span>
                </div>
              </div>
              <ChevronDown size={18} className={`text-white transition-transform duration-300 ${showUnitList ? 'rotate-180' : ''}`} />
            </button>
            {showUnitList && (
              <div className="flex flex-col space-y-1 p-1.5 bg-black/40 mx-1 mb-1 rounded-b-xl max-h-[250px] overflow-y-auto no-scrollbar border-t border-white/10">
                {selectableUnits.map((unit) => (
                  <button key={unit.id} onClick={() => handleUnitSelect(unit)} className={`w-full py-2 px-3 rounded-xl flex items-center justify-between border transition-all ${selectedUnitId === unit.id ? 'bg-blue-600/30 border-blue-500/50' : 'hover:bg-white/5 border-transparent'}`}>
                    <div className="flex items-center space-x-3 min-w-0">
                       <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black bg-blue-600 text-white shrink-0">{unit.no}</div>
                       <span className="text-[12px] font-bold uppercase truncate text-white">{unit.ownerName}</span>
                    </div>
                    {selectedUnitId === unit.id && <Check size={14} className="text-white" strokeWidth={4} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <button onClick={handleProcess} disabled={!selectedUnitId || !amount || isSaving} className={`w-full h-14 rounded-[20px] shadow-2xl flex items-center justify-center space-x-3 active:scale-95 transition-all ${selectedUnitId && amount ? 'bg-red-600' : 'bg-white/5 opacity-30 grayscale'}`}>
          {isSaving ? <Loader2 className="animate-spin text-white" size={24} /> : saveComplete ? <div className="flex items-center space-x-2"><Check size={22} className="text-white" /><span className="text-[14px] font-black text-white uppercase">TAMAMLANDI</span></div> : <><RotateCcw size={22} className="text-white" /><span className="text-[14px] font-black text-white uppercase">İADEYİ KAYDET</span></>}
        </button>
      </div>
    </div>
  );
};

export default IadeView;
