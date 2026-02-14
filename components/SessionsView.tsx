
import React, { useState } from 'react';
import { ArrowLeft, Plus, Building2, Trash2, AlertTriangle, CheckCircle2, LogIn, Edit3, ShieldAlert, Save } from 'lucide-react';
import CreateManagementView from './CreateManagementView.tsx';
import EditManagementView from './EditManagementView.tsx';
import { BuildingInfo } from '../types.ts';

interface Management {
  id: string;
  name: string;
}

interface SessionsViewProps {
  managements: Management[];
  activeId: string;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreate: (data: any) => void;
  onDelete: (id: string) => void;
  buildingInfo: BuildingInfo;
  onUpdateInfo: (info: BuildingInfo) => void;
}

const SessionsView: React.FC<SessionsViewProps> = ({ managements, activeId, onClose, onSwitch, onCreate, onDelete, buildingInfo, onUpdateInfo }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0: Idle, 1: Confirming

  if (showCreate) {
    return (
      <CreateManagementView 
        onClose={() => setShowCreate(false)} 
        onSuccess={(data) => { onCreate(data); setShowCreate(false); }} 
      />
    );
  }

  if (showEdit) {
    return (
      <EditManagementView 
        info={buildingInfo} 
        onClose={() => setShowEdit(false)} 
        onSuccess={(data) => { onUpdateInfo(data); setShowEdit(false); }} 
      />
    );
  }

  const activeMgmt = managements.find(m => m.id === activeId);
  const otherMgmts = managements.filter(m => m.id !== activeId);

  const handleDeleteActive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteStep === 0) {
      setDeleteStep(1);
    } else {
      onDelete(activeId);
      setDeleteStep(0);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 pt-0 pb-40 px-1">
      <div className="sticky top-0 z-[100] -mx-4 px-4 py-3 mb-6 bg-[#030712]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between shadow-xl">
        <button onClick={onClose} className="bg-white/5 p-2 rounded-xl active:scale-90 transition-all border border-white/5">
          <ArrowLeft size={22} className="text-zinc-400" />
        </button>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-400 text-center">OTURUM MERKEZİ</h3>
        <div className="w-10" />
      </div>

      <div className="space-y-6">
        {/* AKTİF OTURUM PANELİ */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 opacity-40 px-1">
            <CheckCircle2 size={14} className="text-green-500" />
            <h2 className="text-[10px] font-black tracking-[0.2em] uppercase text-zinc-100">ŞU ANKİ AKTİF OTURUM</h2>
          </div>
          
          {activeMgmt ? (
            <div className="space-y-3">
              {/* Aktif Oturum Kartı */}
              <div className="bg-blue-600/10 border border-blue-500/30 rounded-[32px] p-6 shadow-xl relative overflow-hidden group transition-all">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Building2 size={60} />
                </div>
                <div className="relative z-10">
                  <span className="bg-green-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full tracking-widest uppercase mb-2 inline-block shadow-lg">AKTİF OTURUM</span>
                  <h2 className="text-xl font-black text-white uppercase tracking-tight mb-1">{activeMgmt.name}</h2>
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest leading-none">
                    Yönetici: {buildingInfo.managerName || 'İsim Belirtilmedi'}
                  </p>
                </div>
              </div>

              {/* Kontrol Butonları */}
              <div className="grid grid-cols-1 gap-2.5 px-1">
                {/* Güncelle ve Kaydet Butonu */}
                <button 
                  onClick={() => setShowEdit(true)}
                  className="w-full h-15 bg-[#1e293b]/40 hover:bg-[#1e293b]/60 border border-white/10 rounded-[22px] flex items-center justify-center space-x-3 active:scale-[0.98] transition-all shadow-lg"
                >
                  <Edit3 size={18} className="text-blue-400" />
                  <span className="text-[11px] font-black text-white uppercase tracking-[0.15em]">BİLGİLERİ GÜNCELLE / KAYDET</span>
                </button>

                {/* Tehlike Simgeli Silme Butonu */}
                <button 
                  onClick={handleDeleteActive}
                  onMouseLeave={() => setDeleteStep(0)}
                  className={`w-full h-15 rounded-[22px] border flex items-center justify-center space-x-3 active:scale-[0.98] transition-all relative overflow-hidden group ${
                    deleteStep === 1 
                    ? 'bg-red-600 border-red-400 text-white shadow-[0_0_25px_rgba(239,68,68,0.4)]' 
                    : 'bg-red-600/10 border-red-500/20 text-red-500 hover:bg-red-600/20'
                  }`}
                >
                  {deleteStep === 1 ? (
                    <>
                      <AlertTriangle size={22} className="animate-pulse" strokeWidth={3} />
                      <span className="text-[11px] font-black uppercase tracking-widest">SİLMEK İÇİN TEKRAR TIKLA</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={20} className="text-red-500" strokeWidth={2.5} />
                      <span className="text-[11px] font-black uppercase tracking-[0.15em]">OTURUMU SİL</span>
                    </>
                  )}
                  <div className="absolute inset-0 bg-red-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                </button>
              </div>
              
              <p className="text-center text-[8px] font-black text-zinc-700 uppercase tracking-widest px-8">
                * Silme işlemi sadece bu oturuma ait verileri ve dosyaları temizler. Diğer oturumlar etkilenmez.
              </p>
            </div>
          ) : (
            <div className="bg-white/5 rounded-[32px] p-8 text-center border border-white/5 opacity-40">
              <p className="text-[10px] font-black uppercase tracking-widest">AKTİF OTURUM BULUNAMADI</p>
            </div>
          )}
        </section>

        {/* DİĞER KAYITLAR */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center space-x-2 opacity-40">
              <Building2 size={14} className="text-blue-400" />
              <h2 className="text-[10px] font-black tracking-[0.2em] uppercase text-zinc-100">KAYITLI DİĞER YÖNETİMLER</h2>
            </div>
            <span className="text-[10px] font-black text-white/20">{otherMgmts.length} KAYIT</span>
          </div>

          <div className="space-y-2">
            {otherMgmts.length === 0 ? (
              <div className="bg-[#1e293b]/20 rounded-[28px] p-10 text-center border border-white/5">
                <p className="text-[10px] font-black uppercase text-white/20 tracking-widest">BAŞKA OTURUM BULUNAMADI</p>
              </div>
            ) : (
              otherMgmts.map(mgmt => (
                <div key={mgmt.id} className="bg-[#111827]/80 rounded-[24px] p-4 border border-white/5 flex items-center justify-between group hover:bg-white/5 transition-all">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600">
                      <Building2 size={20} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-black text-zinc-300 uppercase tracking-tight">{mgmt.name}</span>
                      <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter italic">Kayıtlı Veri Alanı</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => onSwitch(mgmt.id)}
                      className="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center space-x-2 shadow-lg shadow-blue-900/20"
                    >
                      <LogIn size={14} />
                      <span>GİRİŞ</span>
                    </button>
                    <button 
                      onClick={() => onDelete(mgmt.id)}
                      className="p-2 text-rose-500/20 hover:text-rose-500 transition-colors active:scale-90"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* YÖNETİM EKLE BUTONU */}
        <button 
          onClick={() => setShowCreate(true)}
          className="w-full h-16 bg-white hover:bg-zinc-100 rounded-[28px] flex items-center justify-between px-6 active:scale-[0.98] transition-all group shadow-2xl mt-4"
        >
          <div className="flex flex-col text-left">
            <span className="text-[13px] font-black text-[#030712] uppercase tracking-widest">YENİ YÖNETİM EKLE</span>
            <span className="text-[8px] font-bold text-black/40 uppercase tracking-tighter italic">Sıfır bir veritabanı açar</span>
          </div>
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Plus size={24} className="text-white" strokeWidth={3} />
          </div>
        </button>

        <div className="pt-8 opacity-10 flex flex-col items-center">
          <div className="w-12 h-0.5 bg-white mb-3"></div>
          <p className="text-[8px] font-black uppercase tracking-[0.5em]">GALATA MULTI-SESSION SECURE STORAGE</p>
        </div>
      </div>
    </div>
  );
};

export default SessionsView;
