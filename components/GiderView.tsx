
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle2, TrendingDown, Wallet, Briefcase, ChevronDown, Save, Loader2, MessageSquare, ShieldCheck, X, Building, List } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const GiderView: React.FC<{ onClose: () => void; onSave: (a: number, d: string, v: any, dt: string) => void; }> = ({ onClose, onSave }) => {
  const [st, setSt] = useState({ cat: '', amt: '', desc: '', v: 'genel', dt: new Date().toISOString().split('T')[0] });
  const [showCatList, setShowCatList] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  const expenseCategories = [
    { id: 'elektrik', label: 'Elektrik Gideri', icon: '⚡' },
    { id: 'su', label: 'Su Gideri', icon: '💧' },
    { id: 'temizlik', label: 'Temizlik ve Çöp Alımı', icon: '🧹' },
    { id: 'asansor', label: 'Asansör Bakım', icon: '🛗' },
    { id: 'onarim', label: 'Tadilat', icon: '🔧' },
    { id: 'bahce', label: 'Bahçe Bakımı', icon: '🌱' },
    { id: 'personel', label: 'Personel Maaşı', icon: '👤' },
    { id: 'sigorta', label: 'Bina Sigortası', icon: '🛡️' },
    { id: 'diger', label: 'Diğer Giderler', icon: '📦' },
  ];

  const handleCategorySelect = (catLabel: string) => {
    const newDesc = `${catLabel.toUpperCase()}`;
    
    setSt(prev => ({ 
      ...prev, 
      cat: catLabel,
      desc: newDesc 
    }));
    setShowCatList(false);
  };

  const numberToWordsTr = (num: number) => {
    const unitsWords = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
    const tensWords = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];
    const scalesWords = ["", "BİN", "MİLYON", "MİLYAR"];
    let str = "";
    let integerPart = Math.floor(num);
    let decimalPart = Math.round((num - integerPart) * 100);
    const convertThreeDigit = (n: number) => {
      let res = "";
      let h = Math.floor(n / 100);
      let t = Math.floor((n % 100) / 10);
      let u = n % 10;
      if (h > 0) { if (h > 1) res += unitsWords[h]; res += "YÜZ"; }
      if (t > 0) res += tensWords[t];
      if (u > 0) res += unitsWords[u];
      return res;
    };
    if (integerPart === 0) str = "SIFIR";
    else {
      let parts = [];
      let temp = integerPart;
      while (temp > 0) { parts.push(temp % 1000); temp = Math.floor(temp / 1000); }
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i] === 0) continue;
        let partStr = convertThreeDigit(parts[i]);
        if (i === 1 && parts[i] === 1) str += "BİN";
        else str += partStr + scalesWords[i];
      }
    }
    str += " TÜRK LİRASI";
    if (decimalPart > 0) str += " " + convertThreeDigit(decimalPart) + " KURUŞ";
    return str;
  };

  const handleProcess = async () => {
    const a = parseFloat(st.amt); 
    if (!a || a <= 0) {
      alert("Lütfen geçerli bir tutar giriniz.");
      return;
    }
    setLoading(true); 
    await new Promise(r => setTimeout(r, 800));
    
    onSave(a, st.desc, st.v as any, st.dt);
    
    setReceiptData({ 
      category: st.cat || 'Genel Gider', 
      amount: a, 
      date: new Date(st.dt).toLocaleDateString('tr-TR'), 
      description: st.desc || 'Gider Kaydı', 
      amountWords: numberToWordsTr(a), 
      vault: st.v 
    });
    setLoading(false); 
    setIsSuccess(true);
  };

  if (isSuccess && receiptData) {
    return (
      <div className="animate-in zoom-in duration-500 pt-0 pb-20 px-1">
        <div className="sticky top-0 z-[100] -mx-4 px-4 py-3 mb-6 bg-[#030712]/95 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
           <div className="flex items-center space-x-2 text-green-500">
             <CheckCircle2 size={16} />
             <span className="text-[8px] font-black uppercase tracking-widest">KAYDEDİLDİ</span>
           </div>
           <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500">DEKONT</h3>
           <button onClick={onClose} className="text-white/40"><X size={18} /></button>
        </div>

        <div className="flex justify-center mb-8 overflow-hidden rounded-xl border border-white/10 shadow-2xl">
          <div data-receipt-container ref={receiptRef} className="bg-white text-[#1e293b] flex flex-col" style={{ width: '840px', height: '595px', minWidth: '840px', minHeight: '595px', position: 'relative' }}>
            <div className="absolute inset-0 z-0 opacity-[0.05] pointer-events-none flex items-center justify-center"><Building size={480} /></div>
            
            <div className="p-[30px] h-full flex flex-col justify-between relative z-10 text-left">
              <div className="flex justify-between items-start border-b-[3px] border-slate-900 pb-4">
                <div>
                  <h2 className="font-black text-[40px] tracking-tight mb-0 text-[#0f172a] leading-none uppercase">Galata Apartmanı</h2>
                  <p className="text-[12px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">GİDER DEKONTU</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">TARİH</p>
                  <p className="text-[30px] font-black text-[#0f172a] leading-none">{receiptData.date}</p>
                </div>
              </div>

              <div className="flex-1 space-y-4 pt-4">
                <div className="grid grid-cols-5 gap-8">
                  <div className="col-span-3 border-b border-slate-300 pb-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">KATEGORİ / KASA</p>
                    <p className="text-[28px] font-black text-[#0f172a] leading-tight uppercase tracking-tighter">{receiptData.category} - {receiptData.vault.toUpperCase()}</p>
                  </div>
                  <div className="col-span-2 border-b border-slate-300 pb-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">İŞLEM NO</p>
                    <p className="text-[28px] font-black text-[#0f172a] leading-tight">EXP-{Math.floor(Math.random()*10000)}</p>
                  </div>
                </div>

                <div className="border-b border-slate-300 pb-1 pt-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1 tracking-widest">AÇIKLAMA</p>
                  <p className="text-[22px] font-bold text-slate-800 leading-relaxed uppercase tracking-tight">{receiptData.description}</p>
                </div>
                
                <div className="pt-8">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest leading-none">TUTAR</p>
                  <div className="flex items-baseline space-x-4 mb-6">
                    <span className="text-[40px] font-black text-[#000000] leading-none">₺</span>
                    <span className="text-[44px] font-black text-[#000000] leading-none tracking-tighter">{new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(receiptData.amount)}</span>
                  </div>
                  <p className="text-[13px] font-black text-black uppercase tracking-tight italic bg-slate-100/50 p-2 inline-block"># YALNIZ {receiptData.amountWords} #</p>
                </div>
              </div>

              <div className="flex justify-start items-end h-24 pl-[570px]">
                <div className="mb-[110px] flex flex-col items-center">
                    <div className="bg-red-500 text-white rounded-full p-2 shadow-xl mb-2"><ShieldCheck size={32} strokeWidth={3} /></div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-red-500 leading-tight">ÖDENDİ</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-2">
          <button className="w-full bg-[#25D366] text-white h-14 rounded-xl flex items-center justify-center space-x-2 shadow-lg active:scale-95 transition-all">
            <MessageSquare size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest">PAYLAŞ</span>
          </button>
        </div>

        <button onClick={onClose} className="w-full mt-4 h-14 bg-white/10 text-white rounded-xl font-black text-[10px] uppercase tracking-[0.2em] active:scale-95 border border-white/5">KAPAT</button>
      </div>
    );
  }

  return (
    <div className="animate-in slide-in-from-bottom-6 duration-500 pt-0 pb-16">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-3.5 mb-3 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl border border-white/5 active:scale-90 transition-all"><ArrowLeft size={24} className="text-zinc-400" /></button>
        <h3 className="text-[18px] font-black uppercase tracking-[0.2em] text-red-500 text-center">GİDER KAYDI</h3>
        <div className="w-10" />
      </div>

      <div className="space-y-6 px-1">
        <section>
          <label className="text-[10px] font-black tracking-widest text-white/30 uppercase mb-3 block ml-1">KASA VE TARİH PUKALI</label>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid grid-cols-2 gap-1.5 bg-white/5 p-1.5 rounded-2xl border border-white/5">
              <button onClick={() => setSt({ ...st, v: 'genel' })} className={`h-12 rounded-xl flex items-center justify-center space-x-2 transition-all ${st.v === 'genel' ? 'bg-green-500 shadow-lg text-white' : 'text-white/20'}`}>
                <Wallet size={16} /><span className="text-[11px] font-black uppercase">Genel</span>
              </button>
              <button onClick={() => setSt({ ...st, v: 'demirbas' })} className={`h-12 rounded-xl flex items-center justify-center space-x-2 transition-all ${st.v === 'demirbas' ? 'bg-blue-600 shadow-lg text-white' : 'text-white/20'}`}>
                <Briefcase size={16} /><span className="text-[11px] font-black uppercase">Demirbaş</span>
              </button>
            </div>
            <input 
              type="date" 
              value={st.dt} 
              onChange={e => setSt({ ...st, dt: e.target.value })} 
              className="bg-white/5 w-full h-12 rounded-xl px-2 text-[13px] font-black text-white outline-none border border-white/5 text-center shadow-inner" 
            />
          </div>
        </section>

        <section className="relative group">
          <label className="text-[10px] font-black tracking-widest text-white/30 uppercase mb-3 block text-center">GİDER KALEMİ</label>
          <button 
            onClick={() => setShowCatList(!showCatList)}
            className="w-full bg-[#1e293b] rounded-2xl h-14 flex items-center justify-between px-5 border border-white/10 hover:bg-[#2d3a4f] hover:border-red-500/50 active:bg-white/5 transition-all shadow-xl"
          >
            <div className="flex items-center space-x-3 truncate">
              <span className="text-xl shrink-0">{expenseCategories.find(c => c.label === st.cat)?.icon || '📂'}</span>
              <span className={`text-[13px] font-black uppercase tracking-wider truncate transition-colors ${st.cat ? 'text-white' : 'text-white/20 group-hover:text-white/40'}`}>
                {st.cat || 'TÜR SEÇ...'}
              </span>
            </div>
            <ChevronDown size={20} className={`text-white/30 shrink-0 transition-transform duration-300 ${showCatList ? 'rotate-180' : ''}`} />
          </button>
          
          {showCatList && (
            <div className="absolute top-full left-0 right-0 z-[110] mt-2 bg-[#1e293b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="max-h-[220px] overflow-y-auto no-scrollbar">
                {expenseCategories.map((cat) => (
                  <button 
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat.label)}
                    className={`w-full py-3.5 px-4 text-left flex items-center space-x-3 border-b border-white/5 last:border-0 hover:bg-red-500/20 active:bg-white/5 transition-colors group ${st.cat === cat.label ? 'bg-red-500/10' : ''}`}
                  >
                    <span className="text-xl shrink-0 group-hover:scale-110 transition-transform">{cat.icon}</span>
                    <span className={`text-[12px] font-black uppercase tracking-widest flex-1 truncate transition-colors ${st.cat === cat.label ? 'text-red-400' : 'text-white/60 group-hover:text-white'}`}>
                      {cat.label}
                    </span>
                    {st.cat === cat.label && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="bg-slate-800/40 rounded-[24px] p-5 space-y-4 border border-white/5 shadow-2xl">
          <div>
            <label className="text-[10px] font-black tracking-widest text-white/20 uppercase mb-2 block ml-1 text-center">TUTAR (₺)</label>
            <input 
              type="number" 
              placeholder="0.00" 
              value={st.amt} 
              onChange={e => setSt({ ...st, amt: e.target.value })} 
              className="w-full h-20 bg-black/40 rounded-2xl px-4 text-[42px] font-black text-red-500 border border-white/10 outline-none focus:border-red-500/50 transition-all text-center shadow-inner" 
            />
          </div>
          
          <div>
            <label className="text-[10px] font-black tracking-widest text-white/20 uppercase mb-2 block ml-1">AÇIKLAMA</label>
            <input 
              type="text" 
              placeholder="Açıklama giriniz..." 
              value={st.desc} 
              onChange={e => setSt({ ...st, desc: e.target.value })} 
              className="w-full h-12 bg-black/20 rounded-xl px-4 text-[11px] font-bold text-white border border-white/5 outline-none" 
            />
          </div>
        </section>

        <button 
          onClick={handleProcess} 
          disabled={!st.amt || loading} 
          className={`w-full h-16 rounded-[28px] flex items-center justify-center space-x-4 transition-all shadow-xl active:scale-95 ${st.amt ? 'bg-red-600 shadow-[0_15px_30px_rgba(220,38,38,0.3)]' : 'bg-white/5 opacity-20 cursor-not-allowed'}`}
        >
          {loading ? <Loader2 className="animate-spin" size={24} /> : (
            <>
              <span className="text-[14px] font-black text-white uppercase tracking-[0.2em]">KAYDET VE DEKONT ÜRET</span>
              <Save size={24} />
            </>
          )}
        </button>
      </div>

      {isProcessingPdf && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center">
          <Loader2 className="animate-spin text-red-500 mb-3" size={40} />
          <p className="text-[10px] font-black text-white uppercase tracking-widest">Dekont Hazırlanıyor...</p>
        </div>
      )}
    </div>
  );
};
export default GiderView;
