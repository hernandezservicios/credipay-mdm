import React, { useState } from 'react';
import { Smartphone, LogIn, KeyRound, Loader2, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { apiChangePassword, apiLogin, apiLoginTotp, errorMessage, type Session } from '../services/api';

interface LoginScreenProps {
  onAuthenticated: (session: Session) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Super Admin', email: 'admin@credipay.local', password: '7xs8G8GJrTze9S' },
  { label: 'Gerente', email: 'demo.gestor@credipay.local', password: '7xs8G8GJrTze9S' },
  { label: 'Operador', email: 'demo.operador@credipay.local', password: 'Fase2Test2026!' },
  { label: 'Solo Lectura', email: 'demo.consulta@credipay.local', password: 'NuevaClave2026!' },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [step, setStep] = useState<'LOGIN' | 'CHANGE_PW' | '2FA'>('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ticket, setTicket] = useState('');
  const [challengeName, setChallengeName] = useState('');
  const [totpCode, setTotpCode] = useState('');

  // Cambio de contraseña obligatorio (mustChangePassword)
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const s = await apiLogin(email.trim(), password, remember);
      if ('twoFactorRequired' in s) {
        setTicket(s.ticket);
        setChallengeName(s.user.name);
        setStep('2FA');
        return;
      }
      if (s.mustChangePassword) {
        setSession(s);
        setStep('CHANGE_PW');
        return;
      }
      onAuthenticated(s);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const s = await apiLoginTotp(ticket, totpCode.trim(), remember);
      onAuthenticated(s);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPw.length < 10) {
      setError('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (newPw !== confirmPw) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setLoading(true);
    try {
      await apiChangePassword(currentPw, newPw);
      if (session) onAuthenticated({ ...session, mustChangePassword: false });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(acc.email);
    setPassword(acc.password);
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center space-x-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg">
            <Smartphone className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">CrediPay MDM</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 -mt-0.5">
              Sistema Integral de Préstamos con Bloqueo MDM (RD$)
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {step === 'LOGIN' ? (
            <form onSubmit={handleLogin} className="p-7 space-y-4">              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
                  <LogIn className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Iniciar Sesión</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Accede a la consola multitenant CrediPay MDM
                </p>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@credipay.local"
                  className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contraseña</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Mantener sesión iniciada (30 días)</span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl shadow-md transition-colors flex items-center justify-center space-x-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span>{loading ? 'Autenticando...' : 'Entrar a la Consola'}</span>
              </button>
            </form>
          ) : step === '2FA' ? (
            <form onSubmit={handleTotp} className="p-7 space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center mb-3">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Verificación en Dos Pasos</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {challengeName}, ingresa el código de 6 dígitos de tu app de autenticación (o un código
                  de recuperación).
                </p>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Código TOTP</label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  autoFocus
                  maxLength={8}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="123456"
                  className="w-full px-3 py-2.5 text-center text-lg tracking-[0.4em] border border-slate-300 dark:border-slate-600 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl shadow-md transition-colors flex items-center justify-center space-x-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>{loading ? 'Verificando...' : 'Verificar y Entrar'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('LOGIN');
                  setError(null);
                }}
                className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 font-medium"
              >
                ← Volver a iniciar sesión
              </button>
            </form>
          ) : (
            <form onSubmit={handleChangePassword} className="p-7 space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Cambio de Contraseña Obligatorio</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {session?.user?.name ? `${session.user.name}, ` : ''}por seguridad debes establecer una
                  contraseña nueva (mínimo 10 caracteres) antes de continuar.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contraseña Actual</label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nueva Contraseña</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    required
                    minLength={10}
                    autoComplete="new-password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw((v) => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    aria-label="Mostrar/ocultar"
                  >
                    {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Confirmar Nueva Contraseña</label>
                <input
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl shadow-md transition-colors flex items-center justify-center space-x-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>{loading ? 'Guardando...' : 'Actualizar y Continuar'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Cuentas demo para desarrollo */}
        <div className="mt-5 bg-slate-900/95 rounded-2xl border border-slate-800 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
            Cuentas de demostración (desarrollo)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => fillDemo(acc)}
                className="text-left p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition-colors"
              >
                <span className="block text-[11px] font-bold text-emerald-400">{acc.label}</span>
                <span className="block text-[10px] text-slate-400 font-mono truncate">{acc.email}</span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">{acc.password}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
