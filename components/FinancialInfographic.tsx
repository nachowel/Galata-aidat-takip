
import React from 'react';
import { Lightbulb, ClipboardList, CheckCircle, Settings2, Sparkles } from 'lucide-react';

interface FinancialInfographicProps {
  data?: {
    aidat: number;
    gider: number;
    demirbas: number;
    diger: number;
  };
}

const FinancialInfographic: React.FC<FinancialInfographicProps> = ({ data }) => {
  // Örnek veriler (Gerçek verilerle beslenebilir)
  const total = 100;
  
  return (
    <div className="px-1 mt-4 mb-6">
      <div className="bg-[#0f172a]/40 backdrop-blur-xl border border-white/5 rounded-[48px] p-8 relative overflow-hidden shadow-2xl">
        
        {/* Başlık */}
        <div className="flex items-center space-x-2 mb-8 opacity-40">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-[10px] font-black tracking-[0.3em] text-white uppercase italic">MALİ DAĞILIM ANALİZİ</span>
        </div>

        <div className="relative w-full aspect-square max-w-[280px] mx-auto flex items-center justify-center">
          
          {/* Ana Donut Grafik (SVG) */}
          <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
            {/* Segment 1: Demirbaş (Mor) */}
            <circle
              cx="50" cy="50" r="40"
              fill="transparent"
              stroke="#8b5cf6"
              strokeWidth="20"
              strokeDasharray="62.8 251.2"
              strokeDashoffset="0"
              className="drop-shadow-[0_0_8px_rgba(139,92,246,0.3)]"
            />
            {/* Segment 2: Giderler (Pembe) */}
            <circle
              cx="50" cy="50" r="40"
              fill="transparent"
              stroke="#ec4899"
              strokeWidth="20"
              strokeDasharray="62.8 251.2"
              strokeDashoffset="-62.8"
              className="drop-shadow-[0_0_8px_rgba(236,72,153,0.3)]"
            />
            {/* Segment 3: Aidat (Turuncu) */}
            <circle
              cx="50" cy="50" r="40"
              fill="transparent"
              stroke="#f59e0b"
              strokeWidth="20"
              strokeDasharray="62.8 251.2"
              strokeDashoffset="-125.6"
              className="drop-shadow-[0_0_8px_rgba(245,158,11,0.3)]"
            />
            {/* Segment 4: Diğer (Yeşil) */}
            <circle
              cx="50" cy="50" r="40"
              fill="transparent"
              stroke="#10b981"
              strokeWidth="20"
              strokeDasharray="62.8 251.2"
              strokeDashoffset="-188.4"
              className="drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]"
            />
          </svg>

          {/* Orta Beyaz Daire */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[45%] h-[45%] bg-white rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex flex-col items-center justify-center border-4 border-[#0f172a]">
              <Lightbulb size={20} className="text-yellow-500 mb-1" />
              <span className="text-[10px] font-black text-[#0f172a] tracking-widest leading-none">BİLANÇO</span>
              <div className="w-6 h-[1px] bg-[#0f172a]/10 my-1"></div>
              <span className="text-[8px] font-bold text-[#0f172a]/40 uppercase tracking-tighter">ÖZETİ</span>
            </div>
          </div>

          {/* Dış Baloncuklar (Görseldeki gibi yerleşim) */}
          
          {/* Sol Üst - Clipboard */}
          <div className="absolute -top-2 -left-2 w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center border-4 border-[#0f172a] animate-bounce duration-[3s]">
            <ClipboardList size={22} className="text-orange-500" />
          </div>

          {/* Sağ Üst - Check */}
          <div className="absolute -top-4 -right-2 w-12 h-12 bg-white rounded-full shadow-2xl flex items-center justify-center border-4 border-[#0f172a] animate-pulse">
            <CheckCircle size={20} className="text-purple-600" />
          </div>

          {/* Sağ Alt - Equalizer */}
          <div className="absolute -bottom-2 -right-4 w-16 h-16 bg-white rounded-full shadow-2xl flex items-center justify-center border-4 border-[#0f172a] animate-bounce duration-[4s]">
            <Settings2 size={24} className="text-pink-500" />
          </div>

          {/* Sol Alt - Mini Lightbulb */}
          <div className="absolute -bottom-4 left-4 w-12 h-12 bg-white rounded-full shadow-2xl flex items-center justify-center border-4 border-[#0f172a] animate-pulse duration-[2s]">
            <Lightbulb size={18} className="text-green-500" />
          </div>
        </div>

        {/* Bilgi Etiketleri */}
        <div className="mt-10 grid grid-cols-2 gap-4">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-purple-400 uppercase tracking-widest">DEMİRBAŞ</span>
            <span className="text-[12px] font-black text-white italic">HEDEF %25</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-[8px] font-black text-pink-400 uppercase tracking-widest">PERSONEL</span>
            <span className="text-[12px] font-black text-white italic">PAY %25</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-orange-400 uppercase tracking-widest">TAHSİLAT</span>
            <span className="text-[12px] font-black text-white italic">AİDAT %25</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-[8px] font-black text-green-400 uppercase tracking-widest">DİĞER</span>
            <span className="text-[12px] font-black text-white italic">FON %25</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancialInfographic;
