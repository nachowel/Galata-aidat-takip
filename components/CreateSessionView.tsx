
import React, { useState } from 'react';
import { Home, ChevronLeft } from 'lucide-react';
import FindManagementView from './FindManagementView.tsx';
import CreateManagementView from './CreateManagementView.tsx';

interface CreateSessionViewProps {
  onClose: () => void;
  onManagementCreated: (data: any) => void;
}

const CreateSessionView: React.FC<CreateSessionViewProps> = ({ onClose, onManagementCreated }) => {
  const [activeSubView, setActiveSubView] = useState<'find' | 'create' | null>(null);

  if (activeSubView === 'find') {
    return <FindManagementView onClose={() => setActiveSubView(null)} />;
  }

  if (activeSubView === 'create') {
    return <CreateManagementView 
      onClose={() => setActiveSubView(null)} 
      onSuccess={(data) => {
        onManagementCreated(data);
      }}
    />;
  }

  return (
    <div className="absolute inset-0 z-[110] bg-gradient-to-b from-[#0f172a] to-[#020617] p-4 animate-in slide-in-from-right duration-500 overflow-y-auto no-scrollbar">
      <button 
        onClick={onClose}
        className="absolute left-4 top-4 p-1.5 bg-white/5 rounded-xl hover:bg-white/10 active:scale-90 transition-all z-10"
      >
        <ChevronLeft size={24} className="text-zinc-500" />
      </button>

      <div className="flex flex-col items-center text-center mt-8 mb-6">
        <div className="text-white mb-2">
          <Home size={56} strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-black text-white leading-none mb-2 uppercase tracking-tight">
          YENİ OTURUM OLUŞTURUN
        </h2>
        <p className="text-[11px] font-medium text-white/60 italic leading-snug px-8">
          Yeni bir yönetim kurun ya da var olan bir yönetime katılın.
        </p>
      </div>

      <div className="space-y-3 max-w-sm mx-auto">
        <button 
          onClick={() => setActiveSubView('find')}
          className="w-full bg-gradient-to-br from-[#134e4a] to-[#0d9488] rounded-[24px] py-4 px-6 text-center border border-white/10 shadow-2xl active:scale-[0.98] transition-all group"
        >
          <h3 className="text-lg font-black text-white mb-1 uppercase tracking-wider">MALİK / KİRACI</h3>
          <p className="text-[10px] font-medium text-white/80 leading-tight italic">Kat malikleri veya kiracılar bu seçeneği kullanır.</p>
        </button>

        <button 
          onClick={() => setActiveSubView('create')}
          className="w-full bg-gradient-to-br from-[#064e3b] to-[#0f766e] rounded-[24px] py-4 px-6 text-center border border-white/10 shadow-2xl active:scale-[0.98] transition-all group"
        >
          <h3 className="text-lg font-black text-white mb-1 uppercase tracking-wider">YÖNETİCİ</h3>
          <p className="text-[10px] font-medium text-white/80 leading-tight italic">İlk kez kullanacak yöneticiler bu seçeneği kullanır.</p>
        </button>
      </div>
    </div>
  );
};

export default CreateSessionView;
