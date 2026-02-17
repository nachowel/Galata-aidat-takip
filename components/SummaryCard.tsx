
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { BalanceSummary } from '../types.ts';
import { RefreshCw } from 'lucide-react';

interface SummaryCardProps {
  balance: BalanceSummary;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ balance }) => {
  const formatCurrency = (val: number = 0) => {
    return "₺" + new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(val) || 0);
  };

  // Görseldeki tek parça kırmızı halka görünümü için data
  const chartData = [
    { name: 'Red', value: 100, color: '#ef4444' }
  ];

  return (
    <div className="px-1 mb-2">
      <div className="bg-[#0f172a] border border-white/5 rounded-[24px] py-3 px-4 shadow-2xl flex items-center">
        {/* Ring Chart Area - Daha küçük */}
        <div className="w-[65px] h-[65px] shrink-0 relative flex items-center justify-center -ml-[5px] mt-[10px]" style={{ minHeight: 65 }}>
          <ResponsiveContainer width="100%" height={65}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={20}
                outerRadius={30}
                paddingAngle={0}
                dataKey="value"
                stroke="none"
                isAnimationActive={false}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stats Content Area */}
        <div className="flex-1 ml-4 flex flex-col min-w-0">
          {/* Header row */}
          <div className="flex items-center space-x-2 mb-1.5">
            <span className="text-[13px] font-black text-[#00df9a] uppercase tracking-[0.2em]">
              GENEL GİDER
            </span>
            <RefreshCw size={12} className="text-[#00df9a] opacity-40" />
          </div>

          {/* Table rows */}
          <div className="flex flex-col">
            {/* Mevcut Row */}
            <div className="flex justify-between items-center py-0.5">
              <span className="text-[11px] font-black text-white/90 tracking-widest uppercase">MEVCUT</span>
              <span className="text-[13px] font-black text-[#00df9a] tracking-tighter leading-none truncate ml-2">
                {formatCurrency(balance.mevcutBakiye)}
              </span>
            </div>
            
            {/* İnce Ayırıcı Çizgi */}
            <div className="h-[1px] bg-white/10 w-full my-0.5"></div>

            {/* Alacak Row */}
            <div className="flex justify-between items-center py-0.5">
              <span className="text-[11px] font-black text-white/90 tracking-widest uppercase">ALACAK</span>
              <span className="text-[13px] font-black text-red-500 tracking-tighter leading-none truncate ml-2">
                {formatCurrency(balance.alacakBakiyesi)}
              </span>
            </div>

            {/* İnce Ayırıcı Çizgi */}
            <div className="h-[1px] bg-white/10 w-full my-0.5"></div>

            {/* Toplam Row */}
            <div className="flex justify-between items-center py-0.5">
              <span className="text-[11px] font-black text-white/90 tracking-widest uppercase">TOPLAM</span>
              <span className="text-[13px] font-black text-[#60a5fa] tracking-tighter leading-none truncate ml-2">
                {formatCurrency(balance.toplam)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryCard;
