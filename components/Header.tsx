
import React from 'react';
import { Power, Shield } from 'lucide-react';
import { BuildingInfo } from '../types.ts';

interface HeaderProps {
  info: BuildingInfo;
  onLogout: () => void;
  isAdmin: boolean;
}

const Header: React.FC<HeaderProps> = ({ info, onLogout, isAdmin }) => {
  const managerName = info?.managerName || 'YÖNETİCİ TANIMLANMADI';

  return (
    <div className="relative w-full pt-1 pb-2 flex flex-col items-center">
      {/* DB Label */}
      <div className="absolute top-0 left-4 opacity-20 flex items-center space-x-1">
        <div className="w-1 h-1 bg-white rounded-full"></div>
        <span className="text-[7px] font-black tracking-widest uppercase">DB: GALATA_V16_LOCAL</span>
      </div>

      <div className="w-full flex items-center justify-between px-6 mt-2">
        {/* Power Button */}
        <button 
          onClick={onLogout}
          className="p-1.5 text-red-600 active:scale-90 transition-all"
        >
          <Power size={28} strokeWidth={3} />
        </button>

        {/* Center Info */}
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="flex items-center space-x-1 opacity-40 mb-0.5">
            <Shield size={10} className="text-blue-400" />
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-white">SİSTEM YÖNETİCİSİ</span>
          </div>
          <h2 className="text-[13px] font-black text-white uppercase tracking-tight leading-none text-center max-w-[200px] truncate">
            {managerName}
          </h2>
        </div>

        {/* Balance space */}
        <div className="w-10 h-10" />
      </div>
    </div>
  );
};

export default Header;
