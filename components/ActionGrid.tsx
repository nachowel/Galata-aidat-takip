
import React from 'react';
import { 
  HandCoins, UserPlus, RotateCcw, TrendingUp, TrendingDown, 
  ArrowLeftRight, Building2, History, UserCheck 
} from 'lucide-react';

interface ActionGridProps {
  isAdmin: boolean;
  onActionClick?: (label: string) => void;
}

const ActionGrid: React.FC<ActionGridProps> = ({ isAdmin, onActionClick }) => {
  const iconSize = 26;
  const iconColor = "text-[#00df9a]";

  const allActions = [
    { icon: <HandCoins size={iconSize} />, label: "TAHSİLAT", adminOnly: true },
    { icon: <UserPlus size={iconSize} />, label: "BORÇLANDIR", adminOnly: true },
    { icon: <RotateCcw size={iconSize} />, label: "İADE", adminOnly: true },
    { icon: <TrendingUp size={iconSize} />, label: "GELİR", adminOnly: true },
    { icon: <TrendingDown size={iconSize} />, label: "GİDER", adminOnly: true },
    { icon: <ArrowLeftRight size={iconSize} />, label: "TRANSFER", adminOnly: true },
    { icon: <Building2 size={iconSize} />, label: "BAĞIMSIZ BÖLÜMLER", adminOnly: false },
    { icon: <History size={iconSize} />, label: "İŞLEM HAREKETLERİ", adminOnly: false },
    { icon: <UserCheck size={iconSize} />, label: "ALACAK LİSTESİ", adminOnly: false },
  ];

  const filteredActions = allActions.filter(a => isAdmin || !a.adminOnly);

  return (
    <div className="grid grid-cols-3 gap-2 px-1 mb-2">
      {filteredActions.map((action, idx) => (
        <button 
          key={idx} 
          onClick={() => onActionClick?.(action.label)} 
          className="flex flex-col items-center justify-center bg-[#0f172a] border border-white/5 rounded-[24px] h-[85px] w-full active:scale-[0.95] transition-all shadow-xl shadow-black/20 group"
        >
          <div className={`${iconColor} mb-1.5 group-hover:scale-110 transition-transform`}>
            {action.icon}
          </div>
          <span className="text-[9px] font-black text-center px-1 leading-tight text-white tracking-widest uppercase">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
};

export default ActionGrid;
