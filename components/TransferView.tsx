
import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, ArrowRightLeft, Wallet, Briefcase, Calendar, Info, Save, Loader2, X } from 'lucide-react';

interface TransferViewProps {
  onClose: () => void;
  onSave: (amount: number, description: string, sourceVault: 'genel' | 'demirbas', date: string) => void;
}

const TransferView: React.FC<TransferViewProps> = ({ onClose, onSave }) => {
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [sourceVault, setSourceVault] = useState<'genel' | 'demirbas'>('genel');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);

  const handleProcess = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0 || !description) return;

    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setSaveComplete(true);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const targetVault = sourceVault === 'genel' ? 'Demirbaş' : 'Genel Gider';
    const sourceVaultName = sourceVault === 'genel' ? 'Genel Gider' : 'Demirbaş';
    const finalDescription = `${description} [${sourceVaultName} ➔ ${targetVault}]`;

    setIsSuccess(true);
    setTimeout(() => {
      onSave(numAmount, finalDescription, sourceVault, selectedDate);
    }, 500);
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in duration-500 text-center">
        <div className="bg-indigo-500/20 p-10 rounded-full mb-8 border border-indigo-500/20">
          <ArrowRightLeft size={100} className="text-indigo-400" />
        </div>
        <h2 className="text-4xl font-black uppercase tracking-widest text-indigo-400">TRANSFER BAŞARILI</h2>
        <p className="text-white/40 text-[18px] font-bold mt-4 uppercase tracking-tight px-10">Kasa bakiyeleri karşılıklı olarak güncellendi</p>
      </div>
    );
  }

  return (
    <div className="animate-in slide-in-from-bottom-6 duration-500 pt-0 pb-20">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-3.5 mb-3 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={24} className="text-zinc-400" />
        </button>
        <h3 className="text-[17px] font-black uppercase tracking-[0.2em] text-green-500 text-center">KASA TRANSFERİ</h3>
        <div className="w-10" />
      </div>

      <div className="space-y-6 px-1">
        <section>
          <label className="text-[11px] font-black tracking-widest text-white/40 uppercase mb-3 block ml-1 text-center">1. KAYNAK KASA (NEREDEN?)</label>
          <div className="grid grid-cols-2 gap-3 w-full">
            <button onClick={() => setSourceVault('genel')} className={`h-20 rounded-[24px] flex flex-col items-center justify-center border transition-all ${sourceVault === 'genel' ? 'bg-green-500/10 border-green-500/40 text-green-400 shadow-lg' : 'bg-white/5 border-white/5 text-white/20 hover:bg-white/10'}`}>
              <Wallet size={24} className="mb-1" />
              <span className="text-[13px] font-black uppercase tracking-widest">Genel Gider</span>
              <span className="text-[8px] font-bold uppercase opacity-40 italic">➔ DEMİRBAŞ</span>
            </button>
            <button onClick={() => setSourceVault('demirbas')} className={`h-20 rounded-[24px] flex flex-col items-center justify-center border transition-all ${sourceVault === 'demirbas' ? 'bg-blue-500/10 border-blue-500/40 text-blue-400 shadow-lg' : 'bg-white/5 border-white/5 text-white/20 hover:bg-white/10'}`}>
              <Briefcase size={24} className="mb-1" />
              <span className="text-[13px] font-black uppercase tracking-widest">Demirbaş</span>
              <span className="text-[8px] font-bold uppercase opacity-40 italic">➔ GENEL</span>
            </button>
          </div>
        </section>

        <section>
          <label className="text-[11px] font-black tracking-widest text-white/40 uppercase mb-3 block ml-1 text-center">2. İŞLEM DETAYLARI</label>
          <div className="glass-panel rounded-[32px] p-6 space-y-5 border border-white/10 shadow-xl bg-[#111827]/40">
            <div className="grid grid-cols-2 gap-3 w-full">
              <div className="flex flex-col w-full">
                <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.15em] block mb-2 text-center">TRANSFER TARİHİ</label>
                <input 
                  type="date" 
                  value={selectedDate} 
                  onChange={(e) => setSelectedDate(e.target.value)} 
                  className="bg-black/60 w-full h-16 rounded-xl px-2 text-[15px] font-black text-white outline-none border border-white/10 text-center shadow-inner transition-all focus:border-indigo-500/30" 
                />
              </div>
              <div className="flex flex-col w-full">
                <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.15em] block mb-2 text-center">MİKTAR (₺)</label>
                <input 
                  type="number" 
                  placeholder="0.00" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  className="bg-black/60 w-full h-16 rounded-xl px-2 text-[26px] font-black text-indigo-400 outline-none border border-white/10 text-center shadow-inner transition-all focus:border-indigo-500/50" 
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.15em] block mb-2 ml-1 text-center">AÇIKLAMA</label>
              <input 
                type="text" 
                placeholder="Örn: Nakit İhtiyacı İçin Aktarım" 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                className="bg-black/20 w-full h-12 rounded-xl px-5 text-[14px] font-bold text-white outline-none border border-white/5" 
              />
            </div>
          </div>
        </section>

        <button onClick={handleProcess} disabled={!amount || !description || isSaving} className={`w-full h-16 rounded-[24px] shadow-2xl flex items-center justify-center space-x-4 active:scale-95 transition-all ${amount && description ? 'bg-indigo-600 shadow-indigo-900/30' : 'bg-white/5 grayscale cursor-not-allowed opacity-30'}`}>
          {isSaving ? <Loader2 className="animate-spin text-white" size={28} /> : saveComplete ? <div className="flex items-center space-x-3"><CheckCircle2 size={24} className="text-white" /><span className="text-[15px] font-black text-white uppercase tracking-widest">KAYDEDİLDİ</span></div> : <><Save size={24} className="text-white" /><span className="text-[15px] font-black text-white uppercase tracking-[0.2em]">TRANSFERİ KAYDET</span></>}
        </button>
      </div>
    </div>
  );
};

export default TransferView;
