import React, { useState } from 'react';
import { ArrowLeft, Mail, Lock, User, Phone, Loader2 } from 'lucide-react';

interface RegisterViewProps {
  onRegister: (email: string, password: string, name: string, phone: string) => void;
  onBackToLogin: () => void;
}

const RegisterView: React.FC<RegisterViewProps> = ({ onRegister, onBackToLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !name) {
      alert('Lütfen zorunlu alanları doldurun');
      return;
    }
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    onRegister(email, password, name, phone);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-80 h-80 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-sm">
        <button 
          onClick={onBackToLogin}
          className="mb-6 flex items-center space-x-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Giriş Sayfasına Dön</span>
        </button>

        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-white mb-2 uppercase tracking-tight">KAYIT OL</h1>
          <p className="text-white/60 text-sm">Yeni hesap oluşturun</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <User size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              placeholder="Ad Soyad *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-white/40 outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <div className="relative">
            <Mail size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="email"
              placeholder="E-posta *"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-white/40 outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <div className="relative">
            <Phone size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="tel"
              placeholder="Telefon"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-white/40 outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <div className="relative">
            <Lock size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="password"
              placeholder="Şifre *"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-white/40 outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-2xl py-4 font-bold text-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={24} />
            ) : (
              <span>KAYIT OL</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default RegisterView;
