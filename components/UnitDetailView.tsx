
import React, { useRef, useState, useMemo } from 'react';
import { ArrowLeft, Edit3, X, Save, Phone, Info, User, Check, AlertCircle, Smartphone } from 'lucide-react';
import { Unit, BuildingInfo, Transaction } from '../types.ts';

interface UnitDetailViewProps {
  isAdmin: boolean;
  unit: Unit;
  info: BuildingInfo;
  transactions: Transaction[];
  onClose: () => void;
  onUpdate: (unit: Unit) => void;
}

const UnitDetailView: React.FC<UnitDetailViewProps> = ({ isAdmin, unit, info, transactions, onClose, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...unit });
  
  const months = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const currentYear = new Date().getFullYear();
  const currentMonthIdx = new Date().getMonth();

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const getMonthStatus = (mIdx: number) => {
    const hasPayment = transactions.some(tx => 
      tx.unitId === unit.id && tx.type === 'GELİR' && tx.periodMonth === mIdx && tx.periodYear === currentYear
    );
    if (hasPayment) return 'paid';
    if (mIdx <= currentMonthIdx) return 'unpaid';
    return 'future';
  };

  const handleSave = () => {
    onUpdate({ ...editForm, status: editForm.tenantName ? 'Kiracı' : 'Malik' });
    setIsEditing(false);
  };

  const financialData = useMemo(() => {
    const unitTxs = transactions.filter(tx => tx.unitId === unit.id);
    const genIncome = unitTxs.filter(tx => tx.type === 'GELİR' && !tx.description.toLowerCase().includes('demirbaş')).reduce((s, t) => s + t.amount, 0);
    const demIncome = unitTxs.filter(tx => tx.type === 'GELİR' && tx.description.toLowerCase().includes('demirbaş')).reduce((s, t) => s + t.amount, 0);
    const genDebt = unitTxs.filter(tx => tx.type === 'BORÇLANDIRMA' && !tx.description.toLowerCase().includes('demirbaş')).reduce((s, t) => s + t.amount, 0);
    const demDebt = unitTxs.filter(tx => tx.type === 'BORÇLANDIRMA' && tx.description.toLowerCase().includes('demirbaş')).reduce((s, t) => s + t.amount, 0);
    const autoDues = (currentMonthIdx + 1) * (info.duesAmount || 0);
    const totalGenDebt = genDebt + autoDues;
    return {
      genel: { kredi: genIncome > totalGenDebt ? genIncome - totalGenDebt : 0, borc: totalGenDebt > genIncome ? totalGenDebt - genIncome : 0 },
      demirbas: { kredi: demIncome > demDebt ? demIncome - demDebt : 0, borc: demDebt > demIncome ? demDebt - demIncome : 0 }
    };
  }, [transactions, unit, info, currentMonthIdx]);

  return (
    <div className="fixed inset-0 z-[300] bg-[#030712] flex flex-col animate-in slide-in-from-bottom duration-500 overflow-y-auto no-scrollbar pb-20">
      <div className="sticky top-0 z-[100] px-4 py-4 flex items-center justify-between border-b border-white/5 bg-[#030712]/80 backdrop-blur-xl shrink-0">
        <button onClick={onClose} className="p-2 bg-white/5 rounded-xl text-zinc-400 active:scale-90 transition-all"><ArrowLeft size={22} /></button>
        <div className="flex items-center space-x-2">
          {isAdmin && (
            isEditing ? (
              <button onClick={handleSave} className="bg-green-600 px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center space-x-2"><Save size={16} /> <span>KAYDET</span></button>
            ) : (
              <button onClick={() => setIsEditing(true)} className="bg-white/5 p-2 rounded-xl text-zinc-400"><Edit3 size={20} /></button>
            )
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-[#1e293b]/60 rounded-[32px] p-5 border border-blue-500/20 shadow-xl relative overflow-hidden">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-red-600 border border-red-400/30 flex flex-col items-center justify-center shadow-lg shrink-0">
              <span className="text-[8px] font-black text-white/50 uppercase leading-none mb-0.5">NO</span>
              <span className="text-[18px] font-black text-white leading-none italic">{unit.no}</span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-1 block">MALİK BİLGİLERİ</span>
              {isEditing ? (
                <div className="space-y-2">
                  <input className="bg-black/20 text-[16px] font-black text-white w-full outline-none border-b border-blue-500/30 py-1 uppercase" value={editForm.ownerName} onChange={e => setEditForm({...editForm, ownerName: e.target.value})} placeholder="AD SOYAD" />
                  <div className="flex items-center space-x-2 bg-black/20 rounded-full px-3 py-1 border border-white/5">
                    <Smartphone size={12} className="text-green-500" />
                    <input className="bg-transparent text-[12px] font-black text-green-500 w-full outline-none" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} placeholder="05XX XXX XX XX" />
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-[18px] font-black text-white uppercase truncate tracking-tight">{unit.ownerName}</h2>
                  <div className="flex items-center space-x-2 mt-2">
                    <div className="bg-black/40 rounded-full py-1 px-3 flex items-center space-x-2 border border-white/5">
                      <Phone size={12} className="text-green-500" />
                      <span className="text-[12px] font-black text-green-500">{unit.phone || '---'}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {(unit.tenantName || isEditing) && (
          <div className="bg-[#2a1d15] rounded-[32px] p-5 border border-orange-500/20 shadow-xl relative overflow-hidden">
            <div className="flex items-center space-x-4">
              <div className="w-14 h-14 rounded-2xl bg-[#4a2e1e] border border-orange-500/30 flex items-center justify-center shadow-lg shrink-0"><User size={28} className="text-orange-500" /></div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] mb-1 block">KİRACI BİLGİLERİ</span>
                {isEditing ? (
                  <div className="space-y-2">
                    <input className="bg-black/20 text-[16px] font-black text-white w-full outline-none border-b border-orange-500/30 py-1 uppercase" value={editForm.tenantName} onChange={e => setEditForm({...editForm, tenantName: e.target.value})} placeholder="KİRACI ADI" />
                    <div className="flex items-center space-x-2 bg-black/20 rounded-full px-3 py-1 border border-white/5">
                      <Smartphone size={12} className="text-orange-500" />
                      <input className="bg-transparent text-[12px] font-black text-orange-400 w-full outline-none" value={editForm.tenantPhone} onChange={e => setEditForm({...editForm, tenantPhone: e.target.value})} placeholder="05XX XXX XX XX" />
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-[18px] font-black text-white uppercase truncate tracking-tight">{unit.tenantName || 'YOK'}</h2>
                    <div className="flex items-center space-x-2 mt-2">
                      <div className="bg-black/40 rounded-full py-1 px-3 flex items-center space-x-2 border border-white/5">
                        <Phone size={12} className="text-green-500" />
                        <span className="text-[12px] font-black text-green-500">{unit.tenantPhone || '---'}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-[#0f172a] rounded-[28px] p-5 border border-blue-500/10 flex items-center space-x-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0"><Info size={24} /></div>
          <div className="flex-1">
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest block mb-0.5">BORÇLANDIRMA ÖZETİ</span>
            <p className="text-[14px] font-bold text-white">
              <span className="text-red-500">Toplam ₺{formatCurrency(unit.debt)} borç fişi mevcut.</span>
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-3 px-2">
            <h3 className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em]">MALI DURUM</h3>
            <div className="flex space-x-4 text-[9px] font-black uppercase tracking-widest text-white/30"><span>KREDİ</span><span className="text-red-500/60">BORÇ</span></div>
          </div>
          <div className="bg-[#111827]/80 rounded-[28px] p-5 border border-white/5 space-y-5">
            <div className="flex justify-between items-center"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest">GENEL GİDER</span><div className="flex space-x-8"><span className="text-[11px] font-black text-white">₺{formatCurrency(financialData.genel.kredi)}</span><span className="text-[11px] font-black text-red-500">₺{formatCurrency(financialData.genel.borc)}</span></div></div>
            <div className="h-px bg-white/5" /><div className="flex justify-between items-center"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest">DEMİRBAŞ</span><div className="flex space-x-8"><span className="text-[11px] font-black text-white">₺{formatCurrency(financialData.demirbas.kredi)}</span><span className="text-[11px] font-black text-red-500">₺{formatCurrency(financialData.demirbas.borc)}</span></div></div>
            <div className="h-px bg-white/5" /><div className="flex justify-between items-center pt-1"><span className="text-[12px] font-black text-white uppercase tracking-widest">TOPLAM</span><div className="flex space-x-8"><span className="text-[11px] font-black text-white">₺{formatCurrency(financialData.genel.kredi + financialData.demirbas.kredi)}</span><span className="text-[11px] font-black text-red-500">₺{formatCurrency(financialData.genel.borc + financialData.demirbas.borc)}</span></div></div>
          </div>
        </div>

        <div className="mt-4 pb-10">
          <div className="flex items-center justify-between mb-3 px-2"><h3 className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em]">AİDAT ÇİZELGESİ</h3><span className="text-[10px] font-black text-white/20">{currentYear}</span></div>
          <div className="grid grid-cols-12 gap-1 px-1">
            {months.map((m, idx) => {
              const status = getMonthStatus(idx);
              let bgColor = 'bg-[#1e293b] text-white/30';
              if (status === 'paid') bgColor = 'bg-green-600 text-white';
              if (status === 'unpaid') bgColor = 'bg-[#451212] text-red-500 border border-red-500/20';
              return (
                <div 
                  key={m} 
                  className={`h-7 rounded-md flex items-center justify-center font-black text-[9px] transition-all shadow-inner ${bgColor}`}
                >
                  {m}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnitDetailView;
