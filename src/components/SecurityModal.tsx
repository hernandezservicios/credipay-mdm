import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  apiCreateApiKey,
  apiListApiKeys,
  apiRevokeApiKey,
  apiTwoFactorDisable,
  apiTwoFactorEnable,
  apiTwoFactorSetup,
  apiTwoFactorStatus,
  errorMessage,
  type ApiKeyRow,
} from '../services/api';
import { useConfirm } from './ConfirmDialog';
import { formatDate, formatDateTime } from '../utils/formatters';
import { ModalShell } from './ui/ModalShell';

interface SecurityModalProps {
  onClose: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ onClose }) => {
  const confirm = useConfirm();
  const [tab, setTab] = useState<'2FA' | 'API'>('2FA');

  // 2FA
  const [tfaEnabled, setTfaEnabled] = useState<boolean | null>(null);
  const [tfaSecret, setTfaSecret] = useState<string | null>(null);
  const [tfaUrl, setTfaUrl] = useState<string | null>(null);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaRecovery, setTfaRecovery] = useState<string[] | null>(null);
  const [tfaError, setTfaError] = useState<string | null>(null);

  // API keys
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [keyName, setKeyName] = useState('');
  const [keyExpires, setKeyExpires] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [status, keysRes] = await Promise.all([apiTwoFactorStatus(), apiListApiKeys()]);
      setTfaEnabled(status.data.enabled);
      setKeys(keysRes.data);
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSetup = async () => {
    setTfaError(null);
    try {
      const res = await apiTwoFactorSetup();
      setTfaSecret(res.data.secret);
      setTfaUrl(res.data.otpauthUrl);
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  };

  const handleEnable = async () => {
    setTfaError(null);
    try {
      const res = await apiTwoFactorEnable(tfaCode.trim());
      setTfaRecovery(res.data.recoveryCodes);
      setTfaEnabled(true);
      setTfaSecret(null);
      setTfaUrl(null);
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  };

  const handleDisable = async () => {
    if (
      !(await confirm({
        title: 'Desactivar autenticación',
        message: '¿Desactivar la verificación en dos pasos? Esta llave dejará de requerir el código TOTP.',
        confirmLabel: 'Confirmar',
        tone: 'rose',
      }))
    )
      return;
    setTfaError(null);
    try {
      await apiTwoFactorDisable(tfaCode.trim());
      setTfaEnabled(false);
      setTfaCode('');
      setTfaError(null);
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setTfaError(null);
    try {
      const res = await apiCreateApiKey({
        name: keyName.trim(),
        ...(keyExpires ? { expiresInDays: Number(keyExpires) } : {}),
      });
      setNewKey(res.data.printed);
      setKeyName('');
      setKeyExpires('');
      await reload();
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  };

  const handleRevoke = async (id: number, name: string) => {
    if (
      !(await confirm({
        title: 'Revocar API key',
        message: `¿Revocar la API key "${name}"? Los consumidores dejarán de autenticarse.`,
        confirmLabel: 'Sí, Revocar',
        tone: 'rose',
      }))
    )
      return;
    try {
      await apiRevokeApiKey(id);
      await reload();
    } catch (err) {
      setTfaError(errorMessage(err));
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs: { id: '2FA' | 'API'; label: string; icon: React.ReactNode }[] = [
    { id: '2FA', label: 'Autenticación 2FA', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'API', label: 'API Keys', icon: <KeyRound className="w-4 h-4" /> },
  ];

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      size="lg"
      headerVariant="dark"
      title={
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span>Seguridad & API</span>
        </div>
      }
      subtitle="2FA (TOTP) y llaves para integraciones externas"
    >
      <div className="text-xs">
        <div className="flex space-x-1 pb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-lg font-semibold flex items-center space-x-1.5 transition-colors ${
                tab === t.id ? 'bg-slate-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div>
          {tfaError && (
            <div className="mb-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-200 font-medium flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{tfaError}</span>
            </div>
          )}

          {tab === '2FA' && (
            <div className="space-y-3">
              {tfaEnabled === null ? (
                <div className="text-center text-slate-400 py-6">Cargando…</div>
              ) : tfaEnabled ? (
                <div>
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-200 font-semibold flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>2FA ACTIVO · tu cuenta exige un código TOTP en cada inicio de sesión.</span>
                  </div>
                  <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl flex items-end space-x-2">
                    <input
                      value={tfaCode}
                      onChange={(e) => setTfaCode(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="Código TOTP actual"
                      maxLength={6}
                      inputMode="numeric"
                      className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg font-mono text-center tracking-widest focus:ring-2 focus:ring-rose-500 focus:outline-none"
                    />
                    <button
                      onClick={handleDisable}
                      className="px-3 py-2 bg-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/20 dark:bg-rose-500/100 text-white rounded-lg font-semibold"
                    >
                      Desactivar
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    Ingresa un código vigente de tu app (o de recuperación) para confirmar la desactivación.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-600 dark:text-slate-400 mb-3">
                    Activa la verificación en dos pasos para proteger la cuenta con un código TOTP de tu app de
                    autenticación (Google Authenticator, Authy, etc.).
                  </p>
                  {!tfaSecret ? (
                    <button
                      onClick={handleSetup}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white rounded-lg font-semibold"
                    >
                      Configurar 2FA
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200">
                        <b>Escanea este secreto en tu app</b> (otpauth://):
                        <div className="mt-1 font-mono text-[10px] break-all bg-white border border-amber-200 rounded-lg p-2">
                          {tfaUrl}
                        </div>
                        <div className="mt-1">
                          Secreto: <code className="font-mono">{tfaSecret}</code>
                        </div>
                      </div>
                      {tfaRecovery ? (
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                          <p className="font-semibold text-emerald-800 mb-1">Códigos de recuperación (guárdalos):</p>
                          <div className="grid grid-cols-5 gap-1.5">
                            {tfaRecovery.map((c) => (
                              <code key={c} className="text-center bg-white border border-emerald-200 rounded-md p-1 font-mono">
                                {c}
                              </code>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          <input
                            value={tfaCode}
                            onChange={(e) => setTfaCode(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="Código TOTP de confirmación"
                            maxLength={6}
                            inputMode="numeric"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg font-mono text-center tracking-widest focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          />
                          <button
                            onClick={handleEnable}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 dark:bg-indigo-500/100 text-white rounded-lg font-semibold"
                          >
                            Activar 2FA
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'API' && (
            <div className="space-y-4">
              <p className="text-slate-600 dark:text-slate-400">
                Las llaves se autentican con el encabezado <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">X-API-Key</code>.
                Solo se muestran una vez al crearlas.
              </p>

              <form onSubmit={handleCreateKey} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                <div className="flex space-x-2">
                  <input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Nombre (ej: Integración tienda)"
                    required
                    minLength={2}
                    maxLength={100}
                    className="flex-1 px-2.5 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <input
                    value={keyExpires}
                    onChange={(e) => setKeyExpires(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Días"
                    inputMode="numeric"
                    maxLength={3}
                    className="w-16 px-2 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold"
                  >
                    Crear llave
                  </button>
                </div>
              </form>

              {newKey && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 rounded-xl">
                  <p className="font-semibold text-emerald-800 mb-1">¡Llave creada! Cópiala ahora (no se volverá a mostrar):</p>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-white border border-emerald-200 rounded-md p-2 font-mono text-[11px] break-all">
                      {newKey}
                    </code>
                    <button onClick={copyKey} className="p-2 bg-white border border-emerald-200 dark:border-emerald-800 rounded-md text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/30 dark:bg-emerald-500/15">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="divide-y divide-slate-100 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {keys.length === 0 ? (
                  <div className="p-4 text-center text-slate-400">Sin API keys configuradas.</div>
                ) : (
                  keys.map((k) => (
                    <div key={k.id} className="px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
                          <span>{k.key_name}</span>
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 dark:text-indigo-300 rounded text-[10px] font-bold">
                            {k.key_prefix}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Última uso: {k.last_used_at ? formatDateTime(k.last_used_at) : 'nunca'}
                          {k.expires_at ? ` · Expira: ${formatDate(k.expires_at)}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleRevoke(k.id, k.key_name)}
                        className="px-2 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/20 dark:bg-rose-500/10 rounded-lg flex items-center space-x-1 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revocar</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};