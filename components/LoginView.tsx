
import React, { useState, useEffect } from 'react';
import { Lock, User, Eye, EyeOff, Loader2, Building2, ShieldCheck, Check, Phone, ArrowLeft, UserPlus, Home } from 'lucide-react';

interface LoginViewProps {
  onLogin: (role: 'admin' | 'resident', remember: boolean) => void;
  buildingName?: string;
}

const REMEMBERED_USER_KEY = 'galata_remembered_username';

const LoginView: React.FC<LoginViewProps> = ({ onLogin, buildingName }) => {
  const [viewMode, setViewMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Kayıt Formu State'leri
  const [regData, setRegData] = useState({
    fullName: '',
    phone: '',
    unitNo: '',
    password: '',
    confirmPassword: ''
  });

  useEffect(() => {
    const savedUser = localStorage.getItem(REMEMBERED_USER_KEY);
    if (savedUser) setUsername(savedUser);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    await new Promise(resolve => setTimeout(resolve, 800));

    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (cleanUsername === 'admin' && cleanPassword === 'admin123') {
      if (rememberMe) localStorage.setItem(REMEMBERED_USER_KEY, cleanUsername);
      onLogin('admin', rememberMe);
    } else if (cleanUsername === 'sakin' && cleanPassword === 'sakin123') {
      if (rememberMe) localStorage.setItem(REMEMBERED_USER_KEY, cleanUsername);
      onLogin('resident', rememberMe);
    } else {
      setError('Geçersiz kullanıcı adı veya şifre!');
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (regData.password !== regData.confirmPassword) {
      setError('Şifreler uyuşmuyor!');
      return;
    }

    setIsLoading(true);
    // Kayıt simülasyonu
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    setIsLoading(false);
    alert('Kaydınız başarıyla oluşturuldu! Şimdi giriş yapabilirsiniz.');
    setViewMode('login');
  };

  return (
    <div className="fixed inset-0 z-[500] bg-[#020617] flex items-center justify-center px-6 overflow-hidden">
      {/* Arka Plan Efektleri */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-sm">
        {/* Logo Bölümü */}
        <div className="text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-1000">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[32px] bg-[#1e293b]/50 border border-white/5 mb-6 shadow-2xl relative">
             <Building2 size={42} className="text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-white mb-2 uppercase italic">
            {buildingName || 'YÖNETİM SİSTEMİ'}
          </h1>
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] leading-none">
            {viewMode === 'login' ? 'GÜVENLİ GİRİŞ PANELİ' : 'YENİ SAKİN KAYDI'}
          </p>
        </div>

        {/* Giriş Kartı */}
        <div className="bg-[#0f172a]/90 backdrop-blur-3xl rounded-[44px] p-8 border border-white/10 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-500">
          {viewMode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">KULLANICI ADI</label>
                <div className="relative group">
                  <input 
                    type="text" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Kullanıcı adınız"
                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-12 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all placeholder:text-zinc-700"
                    required
                  />
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-blue-500 transition-colors" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">ŞİFRE</label>
                <div className="relative group">
                  <input 
                    type={showPassword ? 'text' : 'password'} 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-12 pr-12 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all placeholder:text-zinc-700"
                    required
                  />
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-blue-500 transition-colors" />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between px-1">
                <button 
                  type="button"
                  onClick={() => setRememberMe(!rememberMe)}
                  className="flex items-center space-x-2 group cursor-pointer"
                >
                  <div className={`w-5 h-5 rounded-lg border transition-all flex items-center justify-center ${rememberMe ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/30' : 'bg-white/5 border-white/10'}`}>
                    {rememberMe && <Check size={14} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">Beni Hatırla</span>
                </button>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3 animate-in shake duration-300">
                  <p className="text-[10px] font-black text-red-400 text-center uppercase tracking-widest leading-none">{error}</p>
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoading}
                className="w-full h-16 bg-blue-600 hover:bg-blue-500 text-white rounded-[28px] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-blue-600/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center space-x-3"
              >
                {isLoading ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <>
                    <span>SİSTEME GİRİŞ YAP</span>
                    <ShieldCheck size={20} />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button 
                  type="button"
                  onClick={() => setViewMode('register')}
                  className="text-[11px] font-black text-zinc-500 uppercase tracking-widest hover:text-blue-400 transition-colors"
                >
                  Hesabınız yok mu? <span className="text-blue-500 underline underline-offset-4">Kayıt Ol</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center mb-2">
                <button type="button" onClick={() => setViewMode('login')} className="p-2 bg-white/5 rounded-xl mr-3 text-zinc-600 hover:text-white transition-all"><ArrowLeft size={18}/></button>
                <h3 className="text-xs font-black text-white uppercase tracking-widest">YENİ ÜYELİK</h3>
              </div>

              <div className="space-y-4">
                <div className="relative group">
                  <input type="text" placeholder="Ad Soyad" value={regData.fullName} onChange={e => setRegData({...regData, fullName: e.target.value})} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-11 text-xs font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all" required />
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative group">
                    <input type="tel" placeholder="Telefon" value={regData.phone} onChange={e => setRegData({...regData, phone: e.target.value})} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-11 text-xs font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all" required />
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                  </div>
                  <div className="relative group">
                    <input type="text" placeholder="Daire No" value={regData.unitNo} onChange={e => setRegData({...regData, unitNo: e.target.value})} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-11 text-xs font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all" required />
                    <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                  </div>
                </div>

                <div className="relative group">
                  <input type="password" placeholder="Şifre" value={regData.password} onChange={e => setRegData({...regData, password: e.target.value})} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-11 text-xs font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all" required />
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                </div>

                <div className="relative group">
                  <input type="password" placeholder="Şifre Tekrar" value={regData.confirmPassword} onChange={e => setRegData({...regData, confirmPassword: e.target.value})} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-11 text-xs font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all" required />
                  <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                </div>
              </div>

              {error && <p className="text-[10px] font-black text-red-400 text-center uppercase tracking-widest">{error}</p>}

              <button 
                type="submit"
                disabled={isLoading}
                className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center space-x-3"
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <><span>KAYDI TAMAMLA</span><UserPlus size={18} /></>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
