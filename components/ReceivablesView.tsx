
import React from 'react';
import { ArrowLeft, Phone, MessageCircle, Inbox, AlertCircle } from 'lucide-react';
import { Unit } from '../types.ts';

interface ReceivablesViewProps {
  units: Unit[];
  onClose: () => void;
}

const ReceivablesView: React.FC<ReceivablesViewProps> = ({ units, onClose }) => {
  const debtors = units.filter(u => u.debt > 0);
  const totalReceivable = debtors.reduce((sum, u) => sum + u.debt, 0);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const toTitleCase = (str: string) => {
    if (!str) return '';
    return str.toLocaleLowerCase('tr-TR').split(' ').map(word => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1)).join(' ');
  };

  const handleCall = (phoneNumber?: string) => {
    if (!phoneNumber) {
      alert("Telefon numarası kayıtlı değil.");
      return;
    }
    window.open(`tel:${phoneNumber.replace(/\s/g, '')}`);
  };

  const handleWhatsApp = (phoneNumber?: string, name?: string, amount?: number) => {
    if (!phoneNumber) {
      alert("Telefon numarası kayıtlı değil.");
      return;
    }
    const cleanPhone = phoneNumber.replace(/\s/g, '').replace(/^0/, '90');
    const message = encodeURIComponent(`Sayın ${name},\n\nGalata Apartmanı yönetimi tarafından yapılan kayıtlara göre ₺${amount?.toLocaleString('tr-TR')} tutarında ödenmemiş borcunuz bulunmaktadır. Ödemenizi en kısa sürede yapmanızı rica ederiz.`);
    window.open(`https://wa.me/${cleanPhone}?text=${message}`);
  };

  return (
    <div className="relative pt-0 pb-24">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-3 mb-3 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between shadow-2xl">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={20} className="text-zinc-400" />
        </button>
        <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-red-500 text-center">ALACAK LİSTESİ</h3>
        <div className="w-10" />
      </div>

      <div className="animate-in slide-in-from-bottom-6 duration-500 px-1">
        <div className="glass-panel rounded-[24px] p-4 mb-3 border border-red-500/10 bg-gradient-to-br from-red-500/5 to-transparent flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center border border-red-500/20 shadow-lg shadow-red-900/10 shrink-0">
              <AlertCircle className="text-red-500" size={24} />
            </div>
            <div>
              <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] leading-none mb-1.5">TOPLAM ALACAK</p>
              <p className="text-[20px] font-black text-red-500 tracking-tighter leading-none">₺ {formatCurrency(totalReceivable)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {debtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-20"><Inbox size={48} className="mb-4" /><p className="text-[10px] font-black uppercase tracking-widest">Hiç Borçlu Kaydı Yok</p></div>
          ) : (
            debtors.sort((a,b) => b.debt - a.debt).map((unit) => {
              const activeName = toTitleCase(unit.tenantName || unit.ownerName);
              
              return (
                <div key={unit.id} className="glass-panel rounded-[16px] py-2 px-4 flex items-center border border-white/5 hover:bg-white/10 transition-all group min-h-[62px]">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mr-3 shadow-inner">
                    <span className="text-[15px] font-black text-white leading-none italic">{unit.no}</span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-bold text-white/90 block truncate leading-tight uppercase tracking-tight">
                      {activeName}
                    </span>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`text-[7px] font-black uppercase tracking-tighter leading-none ${unit.tenantName ? 'text-orange-500' : 'text-blue-500'}`}>
                        {unit.tenantName ? 'KİRACI' : 'MALİK'}
                      </span>
                      <div className="flex items-center space-x-1">
                        <Phone size={8} className="text-green-500" />
                        <span className="text-[10px] font-bold tracking-tight text-green-500">
                          {unit.tenantName && unit.tenantPhone 
                            ? unit.tenantPhone 
                            : (unit.phone || <span className="text-white/20 text-[8px] font-black uppercase">TEL YOK</span>)
                          }
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="ml-2 flex items-center space-x-3">
                    <div className="text-right flex flex-col items-end">
                      <span className="text-red-500 font-black text-[11px] tracking-tighter leading-none">₺{formatCurrency(unit.debt)}</span>
                      <span className="text-[7px] font-black text-white/10 uppercase tracking-widest mt-0.5 whitespace-nowrap">TOPLAM BORÇ</span>
                    </div>
                    <div className="flex items-center space-x-1.5 border-l border-white/5 pl-3">
                      <button 
                        onClick={() => handleWhatsApp(unit.tenantPhone || unit.phone, activeName, unit.debt)}
                        className="p-2 rounded-lg bg-white/5 text-white/40 hover:text-green-400 hover:bg-green-500/10 active:scale-90 transition-all"
                      >
                        <MessageCircle size={18} />
                      </button>
                      <button 
                        onClick={() => handleCall(unit.tenantPhone || unit.phone)}
                        className="p-2 rounded-lg bg-white/5 text-white/40 hover:text-blue-400 hover:bg-blue-500/10 active:scale-90 transition-all"
                      >
                        <Phone size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ReceivablesView;
