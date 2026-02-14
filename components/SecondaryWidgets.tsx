
import React from 'react';
import { CalendarDays, BarChart3, TrendingUp } from 'lucide-react';

interface SecondaryWidgetsProps {
  onActionClick?: (action: string) => void;
}

const SecondaryWidgets: React.FC<SecondaryWidgetsProps> = ({ onActionClick }) => {
  const iconSize = 26;
  const iconColor = "text-[#00df9a]";
  
  const reportActions = [
    { label: 'AİDAT ÇİZELGE', icon: <CalendarDays size={iconSize} /> },
    { label: 'AYLIK BİLANÇO', icon: <BarChart3 size={iconSize} /> },
    { label: 'YILLIK BİLANÇO', icon: <TrendingUp size={iconSize} /> },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 px-1 mb-2">
      {reportActions.map((action, idx) => (
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

export default SecondaryWidgets;
