import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Mail, Lock, User, Loader2 } from 'lucide-react';
import { registerUser, auth, functions } from '../firebaseConfig';
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

interface RegisterViewProps {
  onBackToLogin: () => void;
}

type InviteContext = {
  mgmtId: string;
  inviteId: string;
  unitId: string;
  reservedNonce: string;
  reservedUntil: number;
  reservationKey: string;
};

function getFirebaseErrorMessage(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Bu e-posta adresi zaten kullanımda';
    case 'auth/invalid-email':
      return 'Geçersiz e-posta adresi';
    case 'auth/weak-password':
      return 'Şifre en az 6 karakter olmalıdır';
    default:
      return 'Kayıt başarısız. Lütfen tekrar deneyin';
  }
}

function mapInviteError(message: string): string {
  if (message.includes('INVITE_EXPIRED')) return 'Davet süresi dolmuş.';
  if (message.includes('INVITE_ALREADY_USED')) return 'Bu davet linki daha önce kullanılmış.';
  if (message.includes('INVITE_REVOKED')) return 'Bu davet linki iptal edilmiş.';
  if (message.includes('INVITE_RESERVED') || message.includes('INVITE_RESERVATION_TIMEOUT')) return 'Davet rezervasyon süresi doldu. Linki yeniden açın.';
  if (message.includes('INVITE_NONCE_MISMATCH') || message.includes('INVALID_LINK')) return 'Davet linki geçersiz.';
  return 'Davet doğrulanamadı.';
}

const RegisterView: React.FC<RegisterViewProps> = ({ onBackToLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState('');
  const [inviteContext, setInviteContext] = useState<InviteContext | null>(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const reservationKey = useMemo(() => {
    const storageKey = 'galata_invite_reservation_key';
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(storageKey, created);
    return created;
  }, []);
  const mgmtId = params.get('mgmtId');
  const inviteId = params.get('inviteId');
  const hasInviteParams = Boolean(mgmtId || inviteId);

  useEffect(() => {
    const validateInvite = async () => {
      if (!hasInviteParams) {
        setInviteLoading(false);
        return;
      }

      if (!mgmtId || !inviteId) {
        setInviteError('Davet linki eksik veya hatalı.');
        setInviteLoading(false);
        return;
      }

      try {
        const callable = httpsCallable(functions, 'validateInvite');
        const result = await callable({ mgmtId, inviteId, reservationKey });
        const data = result.data as { mgmtId: string; unitId: string; reservedNonce: string; reservedUntil: number };
        setInviteContext({
          mgmtId: data.mgmtId,
          inviteId,
          unitId: data.unitId,
          reservedNonce: data.reservedNonce,
          reservedUntil: data.reservedUntil,
          reservationKey
        });
      } catch (e: any) {
        setInviteError(mapInviteError(String(e?.message || 'INVALID_LINK')));
      } finally {
        setInviteLoading(false);
      }
    };

    validateInvite();
  }, [hasInviteParams, inviteId, mgmtId, reservationKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password || !name) {
      setError('Lütfen zorunlu alanları doldurun');
      return;
    }
    if (password !== confirmPassword) {
      setError('Şifreler uyuşmuyor');
      return;
    }
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalıdır');
      return;
    }

    setIsLoading(true);
    try {
      if (inviteContext) {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        try {
          const consumeInvite = httpsCallable(functions, 'consumeInvite');
          await consumeInvite({
            mgmtId: inviteContext.mgmtId,
            inviteId: inviteContext.inviteId,
            reservedNonce: inviteContext.reservedNonce
          });
        } catch (consumeError: any) {
          await deleteUser(cred.user).catch(() => undefined);
          throw consumeError;
        }
      } else {
        await registerUser(email.trim(), password);
      }
      // onAuthStateChanged App.tsx'te durumu güncelleyecek — otomatik login
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.includes('INVITE_') || message.includes('INVALID_LINK')) {
        setInviteError(mapInviteError(message));
      } else {
        setError(getFirebaseErrorMessage(err?.code));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6 relative overflow-hidden">
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
          <p className="text-white/40 text-xs uppercase tracking-widest">Yeni hesap oluşturun</p>
        </div>

        <div className="bg-[#0f172a]/90 backdrop-blur-3xl rounded-[44px] p-8 border border-white/10 shadow-2xl">
          {inviteLoading && hasInviteParams && (
            <div className="mb-4 bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-white/60" />
            </div>
          )}
          {inviteError && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-2xl p-3">
              <p className="text-[10px] font-black text-red-400 text-center uppercase tracking-widest">{inviteError}</p>
            </div>
          )}
          {inviteContext && !inviteError && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-2xl p-3">
              <p className="text-[10px] font-black text-green-400 text-center uppercase tracking-widest">
                Davet doğrulandı
              </p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="text"
                placeholder="Ad Soyad *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                required
              />
            </div>

            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="email"
                placeholder="E-posta *"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                required
                autoComplete="email"
              />
            </div>

            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="password"
                placeholder="Şifre * (min. 6 karakter)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                required
                autoComplete="new-password"
              />
            </div>

            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="password"
                placeholder="Şifre Tekrar *"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-11 pr-4 text-sm font-bold text-zinc-300 outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3">
                <p className="text-[10px] font-black text-red-400 text-center uppercase tracking-widest">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || (hasInviteParams && (inviteLoading || !!inviteError || !inviteContext))}
              className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'KAYDI TAMAMLA'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegisterView;
