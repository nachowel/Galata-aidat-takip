
import React from 'react';
import { 
  HandCoins, UserPlus, RotateCcw, TrendingUp, TrendingDown, 
  ArrowLeftRight, Building2, History, UserCheck, CalendarDays, 
  BarChart3, ShieldCheck, Settings, Folder, UserCircle, ChevronRight,
  LayoutDashboard, PieChart
} from 'lucide-react';

interface MenuAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  targetSubView?: string;
  targetTab?: 'home' | 'menu' | 'sessions' | 'settings' | 'files';
  adminOnly?: boolean;
}

interface MenuSection {
  title: string;
  adminOnly: boolean;
  actions: MenuAction[];
}

interface MenuViewProps {
  isAdmin: boolean;
  onActionClick: (targetSubView: string | null, targetTab?: any) => void;
}

const MenuView: React.FC<MenuViewProps> = ({ isAdmin, onActionClick }) => {
  const sections: MenuSection[] = [
    {
      title: "FİNANSAL İŞLEMLER",
      adminOnly: true,
      actions: [
        { id: 'tahsilat', label: "Tahsilat Girişi", icon: <HandCoins size={22} />, color: "text-green-500", targetSubView: 'tahsilat' },
        { id: 'borclandir', label: "Borçlandırma", icon: <UserPlus size={22} />, color: "text-green-500", targetSubView: 'borclandir' },
        { id: 'gelir', label: "Diğer Gelirler", icon: <TrendingUp size={22} />, color: "text-green-500", targetSubView: 'gelir' },
        { id: 'gider', label: "Gider Kaydı", icon: <TrendingDown size={22} />, color: "text-green-500", targetSubView: 'gider' },
        { id: 'transfer', label: "Kasa Transferi", icon: <ArrowLeftRight size={22} />, color: "text-green-500", targetSubView: 'transfer' },
        { id: 'iade', label: "İade İşlemleri", icon: <RotateCcw size={22} />, color: "text-green-500", targetSubView: 'iade' },
      ]
    },
    {
      title: "DAİRE YÖNETİMİ",
      adminOnly: false,
      actions: [
        { id: 'member-registration', label: "Sakin Kaydı (Yeni Üye)", icon: <UserPlus size={22} />, color: "text-green-500", targetSubView: 'member-registration', adminOnly: true },
        { id: 'units', label: "Daire Listesi", icon: <Building2 size={22} />, color: "text-green-500", targetSubView: 'units' },
        { id: 'receivables', label: "Alacak Listesi", icon: <UserCheck size={22} />, color: "text-green-500", targetSubView: 'receivables' },
      ]
    },
    {
      title: "RAPORLAR",
      adminOnly: false,
      actions: [
        { id: 'aidat-cizelge', label: "Aidat Çizelgesi", icon: <CalendarDays size={22} />, color: "text-green-500", targetSubView: 'aidat-cizelge' },
        { id: 'monthly-report', label: "Aylık Bilanço", icon: <BarChart3 size={22} />, color: "text-green-500", targetSubView: 'monthly-report' },
        { id: 'yearly-report', label: "Yıllık Bilanço", icon: <PieChart size={22} />, color: "text-green-500", targetSubView: 'yearly-report' },
        { id: 'history', label: "İşlem Geçmişi", icon: <History size={22} />, color: "text-green-500", targetSubView: 'history' },
      ]
    },
    {
      title: "YÖNETİM",
      adminOnly: false,
      actions: [
        { id: 'board', label: "Yönetim Kurulu", icon: <ShieldCheck size={22} />, color: "text-green-500", targetSubView: 'board' },
        { id: 'sessions', label: "Oturum Yönetimi", icon: <UserCircle size={22} />, color: "text-green-500", targetTab: 'sessions', adminOnly: true },
      ]
    },
    {
      title: "SİSTEM",
      adminOnly: true,
      actions: [
        { id: 'settings', label: "Genel Ayarlar", icon: <Settings size={22} />, color: "text-green-500", targetTab: 'settings' },
        { id: 'files', label: "Dosya Arşivi", icon: <Folder size={22} />, color: "text-green-500", targetTab: 'files' },
      ]
    }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-6 pb-32">
      <div className="flex flex-col items-center mb-8 px-4 text-center">
        <div className="w-16 h-16 bg-white/5 rounded-[28px] border border-white/10 flex items-center justify-center mb-4 shadow-2xl">
          <LayoutDashboard size={32} className="text-green-500" strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-black italic tracking-tighter text-white uppercase">Uygulama Menüsü</h2>
        <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.4em] mt-1">Yönetim Dijital Paneli</p>
      </div>

      <div className="space-y-6 px-2">
        {sections.filter(s => isAdmin || !s.adminOnly).map((section, sIdx) => (
          <div key={sIdx} className="space-y-2.5">
            <div className="flex items-center space-x-3 px-3 mb-1.5">
              <div className="h-px bg-white/5 flex-1"></div>
              <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] whitespace-nowrap">{section.title}</h3>
              <div className="h-px bg-white/5 flex-1"></div>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {section.actions.filter(a => isAdmin || !a.adminOnly).map((action) => (
                <button
                  key={action.id}
                  onClick={() => onActionClick(action.targetSubView || null, action.targetTab)}
                  className="bg-[#111827]/80 backdrop-blur-xl rounded-[24px] py-4 px-5 flex items-center justify-between group active:bg-green-600/20 active:border-green-500/30 active:scale-[0.98] transition-all border border-white/5 shadow-lg"
                >
                  <div className="flex items-center space-x-4">
                    <div className={`p-2.5 rounded-2xl bg-white/5 border border-white/5 ${action.color} group-hover:scale-110 transition-transform group-active:scale-110`}>
                      {action.icon}
                    </div>
                    <span className="text-[16px] font-black uppercase tracking-widest text-white transition-colors italic">
                      {action.label}
                    </span>
                  </div>
                  <ChevronRight size={20} className="text-white/10 group-hover:text-white/40 group-active:text-white transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-14 text-center opacity-10 flex flex-col items-center">
        <div className="w-14 h-0.5 bg-white mb-4 rounded-full"></div>
        <p className="text-[9px] font-black uppercase tracking-[0.5em]">YÖNETİM SİSTEMİ v2.4.0</p>
      </div>
    </div>
  );
};

export default MenuView;
