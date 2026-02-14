
import React from 'react';
import { Home, Menu, UserCircle, Settings, Folder } from 'lucide-react';
import { ActiveTab } from '../types.ts';

interface BottomNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  isAdmin: boolean;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, isAdmin }) => {
  const tabs = [
    { id: 'home', label: 'ANA SAYFA', icon: <Home className="w-7 h-7" />, adminOnly: false },
    { id: 'menu', label: 'MENÜ', icon: <Menu className="w-7 h-7" />, adminOnly: false },
    { id: 'sessions', label: 'OTURUMLAR', icon: <UserCircle className="w-7 h-7" />, adminOnly: false },
    { id: 'settings', label: 'AYARLAR', icon: <Settings className="w-7 h-7" />, adminOnly: true },
    { id: 'files', label: 'DOSYALAR', icon: <Folder className="w-7 h-7" />, adminOnly: true },
  ] as const;

  const filteredTabs = tabs.filter(t => isAdmin || !t.adminOnly);

  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full mx-auto bg-black border-t border-white/5 flex justify-around items-center px-4 py-4 pb-10 safe-area-bottom z-50">
      {filteredTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id as ActiveTab)}
          className={`flex flex-col items-center space-y-2 transition-all duration-300 relative ${
            activeTab === tab.id ? 'text-white' : 'text-white/30'
          }`}
        >
          {tab.icon}
          <span className={`text-[10px] font-black uppercase tracking-wider ${activeTab === tab.id ? 'opacity-100' : 'opacity-60'}`}>
            {tab.label}
          </span>
          {activeTab === tab.id && (
            <div className="w-7 h-0.5 bg-white rounded-full absolute -bottom-2.5 shadow-[0_0_10px_white]"></div>
          )}
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;
