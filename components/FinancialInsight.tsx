
import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { getFinancialAdvice } from '../geminiService.ts';
import { BalanceSummary } from '../types.ts';

interface FinancialInsightProps {
  balance: BalanceSummary;
}

const FinancialInsight: React.FC<FinancialInsightProps> = ({ balance }) => {
  const [advice, setAdvice] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAdvice = async () => {
      setLoading(true);
      try {
        const result = await getFinancialAdvice(balance);
        setAdvice(result || 'Verileriniz şu an sağlıklı görünüyor.');
      } catch (e) {
        setAdvice('Tavsiye alınamadı.');
      }
      setLoading(false);
    };
    fetchAdvice();
  }, [balance]);

  return (
    <div className="px-2 mt-2">
      <div className="glass-panel rounded-2xl p-3 border-l-4 border-l-green-500 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
          <Sparkles size={40} className="text-green-400" />
        </div>
        
        <div className="flex items-center space-x-2 mb-1">
          <div className="bg-green-500/20 p-1 rounded-md">
            <Sparkles size={12} className="text-green-400" />
          </div>
          <span className="text-[10px] font-black tracking-widest text-green-300 uppercase">AI ANALİZİ</span>
        </div>

        {loading ? (
          <div className="flex items-center space-x-2 py-1">
            <Loader2 size={14} className="animate-spin text-green-400" />
            <span className="text-[11px] text-white/40 italic font-medium">Veriler analiz ediliyor...</span>
          </div>
        ) : (
          <p className="text-[11px] text-white/80 leading-snug font-medium pr-4">
            {advice}
          </p>
        )}
      </div>
    </div>
  );
};

export default FinancialInsight;
