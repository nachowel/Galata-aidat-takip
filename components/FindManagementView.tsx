
import React, { useState } from 'react';
import { Home, X, Search } from 'lucide-react';

interface FindManagementViewProps {
  onClose: () => void;
}

const FindManagementView: React.FC<FindManagementViewProps> = ({ onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <div className="absolute inset-0 z-[120] bg-[#020617] p-6 animate-in slide-in-from-right duration-500">
      <button onClick={onClose} className="absolute right-4 top-4 w-12 h-12 bg-red-600 rounded-2xl flex items-center justify-center active:scale-90 shadow-lg shadow-red-900/20"><X size={32} className="text-white" strokeWidth={3} /></button>
      <div className="flex items-start mt-10 mb-10">
        <Home size={64} className="text-white mr-4" strokeWidth={2} />
        <div className="pt-1">
          <h2 className="text-xl font-black text-white uppercase tracking-tight">YÖNETİM BUL</h2>
          <p className="text-[11px] font-medium text-white/50 italic">Kayıtlı bir site/apartman yönetimi arayın.</p>
        </div>
      </div>
      <div className="relative mb-8">
        <input type="text" placeholder="Yönetim veya adres giriniz..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full h-14 bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 text-sm font-black text-white outline-none focus:border-white transition-all" />
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
      </div>
      <div className="bg-white/5 rounded-[32px] min-h-[300px] border border-white/5 flex flex-col items-center justify-center p-8 text-center opacity-40">
        <Search size={48} className="text-white/10 mb-4" />
        <h4 className="text-sm font-black text-white uppercase tracking-[0.2em]">SONUÇ YOK</h4>
      </div>
    </div>
  );
};

export default FindManagementView;
