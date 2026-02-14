
import React from 'react';
import { Transaction } from '../types.ts';
import { Archive } from 'lucide-react';

interface LastTransactionProps {
  transaction: Transaction | null;
}

const LastTransaction: React.FC<LastTransactionProps> = ({ transaction }) => {
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  return (
    <div className="mt-1 mb-4 px-1">
      <div className="bg-[#0f172a]/40 border border-white/5 rounded-[20px] overflow-hidden">
        <div className="px-4 py-2 border-b border-white/5">
          <h4 className="text-[10px] font-black tracking-[0.2em] text-white/30 uppercase">SON YAPILAN İŞLEM</h4>
        </div>
        
        <div className="px-4 py-3">
          {transaction ? (
            <div className="flex items-center justify-between animate-in fade-in duration-500">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${
                  transaction.type === 'GELİR' ? 'bg-[#00df9a]/10 border-[#00df9a]/20' : 'bg-red-500/10 border-red-500/20'
                }`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    transaction.type === 'GELİR' ? 'bg-[#00df9a]' : 'bg-red-500'
                  }`}></div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className={`font-black text-[11px] tracking-wider uppercase ${
                      transaction.type === 'GELİR' ? 'text-[#00df9a]' : 'text-red-500'
                    }`}>
                      {transaction.type}
                    </span>
                    <span className="text-white/40">•</span>
                    <span className="text-[11px] text-white/60 font-bold uppercase truncate">
                      {transaction.description}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <span className="text-white font-black text-[14px] tracking-tight uppercase whitespace-nowrap">₺ {formatCurrency(transaction.amount)}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center space-x-2 py-2">
              <Archive size={16} className="text-white/10" />
              <span className="text-[10px] font-black text-white/10 uppercase tracking-[0.15em]">KAYITLI İŞLEM YOK</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LastTransaction;
