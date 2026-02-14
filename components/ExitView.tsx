
import React from 'react';
import { Power, XCircle, RefreshCw } from 'lucide-react';

interface ExitViewProps {
  buildingName?: string;
  onRestart?: () => void;
}

const ExitView: React.FC<ExitViewProps> = ({ buildingName, onRestart }) => {
  const handleTerminate = () => {
    // Tarayıcı kısıtlamaları nedeniyle pencere kapanmayabilir, ancak kullanıcıya net bir mesaj verir.
    if (confirm("Uygulamadan tamamen ayrılmak istiyor musunuz?")) {
        window.location.href = "about:blank";
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black flex flex-col items-center justify-center px-10 text-center animate-in fade-in duration-700">
      {/* Kapatılmış Sistem Görünümü */}
      <div className="relative mb-12">
        <div className="w-24 h-24 bg-red-600/5 rounded-full border border-red-900/20 flex items-center justify-center">
          <Power size={48} className="text-red-900/40" strokeWidth={1.5} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center animate-pulse">
           <div className="w-1.5 h-1.5 rounded-full bg-red-600 shadow-[0_0_10px_red]"></div>
        </div>
      </div>

      <h1 className="text-xl font-black text-white/40 uppercase tracking-[0.3em] mb-4 italic">
        SİSTEM KAPALI
      </h1>
      
      <div className="h-0.5 w-16 bg-red-900/20 mx-auto mb-8"></div>

      <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest leading-relaxed max-w-[260px] mb-16">
        GÜVENLİ ÇIKIŞ PROTOKOLÜ TAMAMLANDI. <br/> TÜM OTURUMLAR SONLANDIRILDI.
      </p>

      <div className="flex flex-col space-y-8 w-full max-w-[200px]">
        {/* Giriş Ekranına Dön Butonu */}
        <button 
          onClick={onRestart}
          className="group relative flex flex-col items-center space-y-3 active:scale-95 transition-all"
        >
          <div className="w-16 h-16 rounded-full border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center group-hover:bg-emerald-500/20 transition-all shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <RefreshCw size={28} className="text-emerald-500/60 group-hover:rotate-180 transition-transform duration-700" strokeWidth={2.5} />
          </div>
          <span className="text-[10px] font-black text-emerald-500/40 uppercase tracking-[0.3em] group-hover:text-emerald-500 transition-colors">SİSTEMİ BAŞLAT</span>
        </button>

        <div className="h-px bg-white/5 w-1/2 mx-auto"></div>

        {/* Sekmeyi Kapat Butonu */}
        <button 
          onClick={handleTerminate}
          className="group relative flex flex-col items-center space-y-3 active:scale-95 transition-all opacity-40 hover:opacity-100"
        >
          <div className="w-12 h-12 rounded-full border border-white/5 flex items-center justify-center group-hover:border-red-500/20 transition-colors">
              <XCircle size={24} className="text-white/10 group-hover:text-red-500/40" strokeWidth={1} />
          </div>
          <span className="text-[8px] font-black text-white/10 uppercase tracking-[0.4em] group-hover:text-red-500/20">SEKMEYİ KAPAT</span>
        </button>
      </div>

      <div className="absolute bottom-12 flex flex-col items-center">
        <p className="text-[7px] font-black uppercase tracking-[0.5em] text-white/5 mb-2">GALATA SECURITY INFRASTRUCTURE</p>
        <div className="flex space-x-1 opacity-5">
            <div className="w-1 h-1 bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-white rounded-full"></div>
        </div>
      </div>
    </div>
  );
};

export default ExitView;
