
import React, { useMemo } from 'react';
import { Transaction, BalanceSummary } from '../types.ts';

interface MonthlyFinancialSummaryProps {
  transactions: Transaction[];
  balance: BalanceSummary;
}

const MonthlyFinancialSummary: React.FC<MonthlyFinancialSummaryProps> = ({ transactions, balance }) => {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthlyFlow = useMemo(() => {
    let income = 0;
    let expense = 0;
    transactions.forEach(tx => {
      const parts = tx.date.split('.');
      if (parts.length === 3) {
        const txMonth = parseInt(parts[1]) - 1;
        const txYear = parseInt(parts[2]);
        if (txMonth === currentMonth && txYear === currentYear) {
          if (tx.type === 'GELİR') income += tx.amount;
          if (tx.type === 'GİDER') expense += tx.amount;
        }
      }
    });
    return { income, expense };
  }, [transactions, currentMonth, currentYear]);

  const formatCurrency = (val: number) => {
    return "₺" + new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  return (
    <div className="px-2 space-y-1 mt-2">
      <div className="flex items-center space-x-1.5 mb-1 px-1">
        <div className="w-1 h-3 bg-green-500 rounded-full"></div>
        <h4 className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">MALİ ÖZET</h4>
      </div>

      <div className="space-y-1">
        <div className="bg-[#1e293b]/40 rounded-lg py-2.5 px-4 flex justify-between items-center border border-white/5">
          <span className="text-[12px] font-black text-white/40 uppercase tracking-widest">GELİR TOPLAMI</span>
          <span className="text-[12px] font-bold text-white/80 tracking-tight">{formatCurrency(monthlyFlow.income)}</span>
        </div>

        <div className="bg-[#1e293b]/40 rounded-lg py-2.5 px-4 flex justify-between items-center border border-white/5">
          <span className="text-[12px] font-black text-white/40 uppercase tracking-widest">GİDER TOPLAMI</span>
          <span className="text-[12px] font-bold text-red-400/60 tracking-tight">{formatCurrency(monthlyFlow.expense)}</span>
        </div>

        <div className="bg-[#1e293b]/70 rounded-xl py-3.5 px-4 flex justify-between items-center border border-white/10 shadow-lg mt-0.5">
          <span className="text-[14px] font-black text-white uppercase tracking-[0.2em]">KASA TOPLAMI</span>
          <span className="text-[14px] font-black text-white tracking-tight">{formatCurrency(balance.mevcutBakiye)}</span>
        </div>
      </div>
    </div>
  );
};

export default MonthlyFinancialSummary;
