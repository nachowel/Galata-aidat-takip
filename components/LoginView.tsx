import React, { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, Loader2, Building2, ShieldCheck } from 'lucide-react';
import { loginUser } from '../firebaseConfig';

interface LoginViewProps {
  buildingName?: string;
  onShowRegister: () => void;
}

function getFirebaseErrorMessage(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return 'Bu e-posta ile kayıtlı kullanıcı bulunamadı';
    case 'auth/wrong-password':
      return 'Şifre hatalı';
    case 'auth/invalid-email':
      return 'Geçersiz e-posta adresi';
    case 'auth/too-many-requests':
      return 'Çok fazla hatalı giriş. Lütfen bekleyin';
    case 'auth/user-disabled':
      return 'Bu hesap devre dışı bırakılmış';
    default:
      return 'Giriş başarısız. Lütfen tekrar deneyin';
  }
}

const LoginView: React.FC<LoginViewProps> = ({ buildingName, onShowRegister }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await loginUser(email.trim(), password);
      // onAuthStateChanged App.tsx'te durumu güncelleyecek
    } catch (err: any) {
      setError(getFirebaseErrorMessage(err.code));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] bg-[#020617] flex items-center justify-center px-6 overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm">
        <div className="text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-1000">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[32px] bg-[#1e293b]/50 border border-white/5 mb-6 shadow-2xl">
            <Building2 size={42} className="text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-white mb-2 uppercase italic">
            {buildingName || 'YÖNETİM SİSTEMİ'}
          </h1>
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] leading-none">
            GÜVENLİ GİRİŞ PANELİ
          </p>
        </div>

        <div className="bg-[#0f172a]/90 backdrop-blur-3xl rounded-[44px] p-8 border border-white/10 shadow-2xl animate-in zoom-in-95 duration-500">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">E-POSTA</label>
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ornek@mail.com"
                  className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-12 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all placeholder:text-zinc-700"
                  required
                  autoComplete="email"
                />
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-blue-500 transition-colors" />
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
                  autoComplete="current-password"
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

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3">
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
                onClick={onShowRegister}
                className="text-[11px] font-black text-zinc-500 uppercase tracking-widest hover:text-blue-400 transition-colors"
              >
                Hesabınız yok mu? <span className="text-blue-500 underline underline-offset-4">Kayıt Ol</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
