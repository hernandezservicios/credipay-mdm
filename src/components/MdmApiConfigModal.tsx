import React, { useState } from 'react';
import { MdmApiConfig, MdmApiLog } from '../types';
import { Settings, CheckCircle, Send, Key, Save, Trash2 } from 'lucide-react';
import { loginInovaGuard, getInovaGuardBalance } from '../services/inovaGuardApi';
import { useConfirm } from './ConfirmDialog';
import { ModalShell } from './ui/ModalShell';
import { overdueGraceDays } from '../utils/overdue';

interface MdmApiConfigProps {
  isOpen: boolean;
  onClose: () => void;
  config: MdmApiConfig;
  onSaveConfig: (newConfig: MdmApiConfig) => void;
  logs: MdmApiLog[];
  onClearLogs: () => void;
}

export const MdmApiConfigModal: React.FC<MdmApiConfigProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  logs,
  onClearLogs,
}) => {
  const [activeTab, setActiveTab] = useState<'CONFIG' | 'LOGS' | 'SUGGESTIONS'>('CONFIG');
  const [formState, setFormState] = useState<MdmApiConfig>(config);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const confirmDialog = useConfirm();

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirmDialog({
      icon: <Save className="w-5 h-5" />,
      tone: 'indigo',
      title: 'Guardar Configuración de la API',
      message:
        '¿GUARDAR la nueva configuración de la API MDM?\n\nLos próximos comandos de bloqueo/desbloqueo y sincronizaciones usarán estos parámetros.',
      confirmLabel: 'Sí, Guardar',
    });
    if (!ok) return;
    onSaveConfig(formState);
    setTestResult('✅ ¡Configuración guardada exitosamente! El motor MDM usará estos parámetros.');
  };

  const handleTestApi = async () => {
    setIsTesting(true);
    setTestResult('⏳ Probando autenticación con InovaGuard (' + formState.baseUrl + '/auth/login)...');
    try {
      const loginRes = await loginInovaGuard(formState);
      const balanceRes = await getInovaGuardBalance(formState);
      
      setTestResult(
        `✅ INOVAGUARD API CONECTADA [HTTP 200]: Token Bearer validado ("${loginRes.token.substring(0, 15)}..."). Balance de Licencias: ${balanceRes.balance.balance} Disponibles / ${balanceRes.balance.added} Totales (En uso: ${balanceRes.balance.demo_used + balanceRes.balance.basic_used + balanceRes.balance.business_used + balanceRes.balance.enterprise_used}).`
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      setTestResult(`❌ Error conectando a la API: ${errorMsg}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      headerVariant="dark"
      title={
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white shrink-0">
            <Settings className="w-6 h-6" />
          </div>
          <span>Inyección de API MDM & Configuración de Bloqueo</span>
        </div>
      }
      subtitle="Parámetros de conexión para bloqueo y desbloqueo automático en dispositivos con cuotas atrasadas o pagadas"
      footer={
        <button
          onClick={onClose}
          className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Cerrar Panel
        </button>
      }
    >
      {/* Pestañas de Navegación */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 -mx-6 -mt-5 mb-5 px-6">
        <button
          onClick={() => setActiveTab('CONFIG')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'CONFIG'
              ? 'border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-800'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          🔌 Endpoints & API Key
        </button>
        <button
          onClick={() => setActiveTab('LOGS')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'LOGS'
              ? 'border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-800'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          📋 Historial de Comandos MDM ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('SUGGESTIONS')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'SUGGESTIONS'
              ? 'border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-800'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          🚀 Opiniones & Requisitos para Producción
        </button>
        </div>

        {/* Contenido según pestaña activa */}
        <div>
          {activeTab === 'CONFIG' && (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Estado de la Integración API MDM</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Activa o deshabilita la emisión automática de peticiones REST al bloqueo de celulares
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.enabled}
                      onChange={(e) => setFormState({ ...formState, enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="flex items-center space-x-2 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={formState.autoLockOnOverdue}
                      onChange={(e) => setFormState({ ...formState, autoLockOnOverdue: e.target.checked })}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Bloquear automáticamente cuando cuota está <strong>ATRASADO</strong> (&gt;{overdueGraceDays()} días)</span>
                  </label>
                  <label className="flex items-center space-x-2 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={formState.autoUnlockOnPaid}
                      onChange={(e) => setFormState({ ...formState, autoUnlockOnPaid: e.target.checked })}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Desbloquear automáticamente al recibir pago (cuota <strong>PAGADO</strong>)</span>
                  </label>
                </div>
              </div>

              {/* Credenciales InovaGuard */}
              <div className="bg-indigo-50 dark:bg-indigo-500/10/60 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center space-x-1.5">
                    <Key className="w-4 h-4 text-indigo-600" />
                    <span>Credenciales App Client InovaGuard (Autenticación Bearer Token)</span>
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800 dark:text-indigo-200">
                    Provider: {formState.provider || 'INOVAGUARD'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      InovaGuard App Client ID
                    </label>
                    <input
                      type="text"
                      value={formState.appClient || ''}
                      onChange={(e) => setFormState({ ...formState, appClient: e.target.value })}
                      placeholder="TYP-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      InovaGuard Secret Key
                    </label>
                    <input
                      type="password"
                      value={formState.secret || ''}
                      onChange={(e) => setFormState({ ...formState, secret: e.target.value })}
                      placeholder="TYP-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Endpoints & Headers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Base URL del Servidor MDM
                  </label>
                  <input
                    type="text"
                    value={formState.baseUrl}
                    onChange={(e) => setFormState({ ...formState, baseUrl: e.target.value })}
                    placeholder="https://api.tu-servidor-mdm.com/v1"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Servidor REST que recibirá la inyección de órdenes</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    API Key / Bearer Token
                  </label>
                  <input
                    type="password"
                    value={formState.apiKey}
                    onChange={(e) => setFormState({ ...formState, apiKey: e.target.value })}
                    placeholder="mdm_key_xxx..."
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Se enviará en el Header "Authorization: Bearer [KEY]"</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Lock Endpoint (Bloqueo)
                  </label>
                  <input
                    type="text"
                    value={formState.lockEndpoint}
                    onChange={(e) => setFormState({ ...formState, lockEndpoint: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono"
                  />
                  <span className="text-[10px] text-slate-400">POST {formState.lockEndpoint}</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Unlock Endpoint (Desbloqueo)
                  </label>
                  <input
                    type="text"
                    value={formState.unlockEndpoint}
                    onChange={(e) => setFormState({ ...formState, unlockEndpoint: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono"
                  />
                  <span className="text-[10px] text-slate-400">POST {formState.unlockEndpoint}</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Status Check Endpoint
                  </label>
                  <input
                    type="text"
                    value={formState.statusEndpoint}
                    onChange={(e) => setFormState({ ...formState, statusEndpoint: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono"
                  />
                  <span className="text-[10px] text-slate-400">GET {formState.statusEndpoint}</span>
                </div>
              </div>

              {testResult && (
                <div className="p-3 bg-slate-900 text-emerald-400 rounded-lg text-xs font-mono break-all">
                  {testResult}
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={handleTestApi}
                  disabled={isTesting}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <span>Probar Conexión API (Test cURL)</span>
                </button>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 dark:bg-emerald-500/100 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                  >
                    Guardar Configuración
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeTab === 'LOGS' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Historial en tiempo real de llamadas enviadas a los celulares por eventos automáticos y manuales:
                </p>
                {logs.length > 0 && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        icon: <Trash2 className="w-5 h-5" />,
                        tone: 'rose',
                        title: 'Limpiar Historial de Auditoría',
                        message: `¿BORRAR todo el historial de auditoría MDM (${logs.length} eventos)?\n\nEsta acción NO se puede deshacer.`,
                        confirmLabel: 'Sí, Limpiar',
                      });
                      if (ok) onClearLogs();
                    }}
                    className="text-xs text-rose-600 hover:text-rose-700 font-medium"
                  >
                    Limpiar Historial
                  </button>
                )}
              </div>

              {logs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 dark:bg-slate-900 rounded-xl">
                  No hay registros de llamadas MDM en esta sesión.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-start space-x-2.5">
                        <div
                          className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                            log.action === 'LOCK'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {log.action === 'LOCK' ? '🔒' : '🔓'}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2 font-semibold text-slate-900 dark:text-slate-100">
                            <span>{log.action === 'LOCK' ? 'BLOQUEO MDM (LOCK)' : 'DESBLOQUEO MDM (UNLOCK)'}</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 dark:text-slate-300 text-[10px]">
                              {log.trigger === 'AUTOMATIC_OVERDUE'
                                ? 'Auto: Cuota Atrasada (+3d)'
                                : log.trigger === 'AUTOMATIC_PAYMENT'
                                ? 'Auto: Cuota Pagada'
                                : 'Manual: Operador'}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                            Cliente: <strong>{log.clientName}</strong> | IMEI:{' '}
                            <span className="font-mono">{log.imei}</span>
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">{log.details}</p>
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-slate-400 font-mono shrink-0">
                        {log.timestamp}
                        <div className="text-emerald-600 font-semibold mt-0.5">HTTP 200 OK</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'SUGGESTIONS' && (
            <div className="space-y-6 text-sm">
              <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 text-indigo-900 dark:text-indigo-200">
                <h3 className="font-bold text-sm mb-2 flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-indigo-600" />
                  <span>API InovaGuard Integral - Conectada al Sistema</span>
                </h3>
                <p className="text-xs text-indigo-800 leading-relaxed">
                  El sistema está configurado y preparado para inyección con tu cuenta InovaGuard:
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-white p-3 rounded-lg border border-indigo-100">
                  <div>App Client: <span className="text-indigo-700 font-bold">{formState.appClient || 'TYP-...'}</span></div>
                  <div>Secret: <span className="text-indigo-700 font-bold">••••••••••••••••</span></div>
                  <div>Base URL: <span className="text-indigo-700 font-bold">/api/v1/customer</span></div>
                  <div>Auth: <span className="text-indigo-700 font-bold">Bearer Token (POST /auth/login)</span></div>
                </div>

                <div className="mt-3 bg-slate-900 text-indigo-300 p-3 rounded-lg font-mono text-xs overflow-x-auto">
                  {`// 1. POST /auth/login (Obtención del Bearer Token)
curl --location 'https://dashboard.inovaguardapp.com/api/v1/customer/auth/login' \\
--data '{ "client": "${formState.appClient}", "secret": "${formState.secret}" }'
// Respuesta: { "token": "<bearer-token>" }

// 2. GET /devices/lock/{id}  -> Bloqueo MDM remoto instantáneo
// 3. GET /devices/unlock/{id} -> Desbloqueo MDM tras pago de cuota
// 4. POST /devices/unlock-code/{id} -> Código temporal offline
// 5. GET /devices -> Sincronización completa de dispositivos`}
                </div>
              </div>

              {/* Opiniones de Mejora para Producción */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs uppercase tracking-wider">
                  💡 Recomendaciones y Mejoras de Producción (Solicitadas)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white shadow-xs">
                    <strong className="text-slate-900 dark:text-slate-100 block mb-1">1. Sincronización CRON Automática</strong>
                    <p className="text-slate-600 dark:text-slate-400">
                      Hemos integrado el botón "Sync InovaGuard" en la cabecera para sincronizar dispositivos nuevos y estados al instante. En el servidor en producción, se puede programar un cron job cada 5 minutos al endpoint GET /devices.
                    </p>
                  </div>

                  <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white shadow-xs">
                    <strong className="text-slate-900 dark:text-slate-100 block mb-1">2. Código Offline como Respaldo de Emergencia</strong>
                    <p className="text-slate-600 dark:text-slate-400">
                      Ya puedes generar Códigos de Desbloqueo Offline con un clic desde el menú MDM. Esto permite desbloquear clientes que pagan su cuota estando en zonas sin cobertura celular.
                    </p>
                  </div>

                  <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white shadow-xs">
                    <strong className="text-slate-900 dark:text-slate-100 block mb-1">3. Enrolamiento Rápido QR</strong>
                    <p className="text-slate-600 dark:text-slate-400">
                      Al recibir lotes nuevos de celulares, puedes utilizar el endpoint de enrolamiento QR (/devices/qr-enrollment) para que cada teléfono se configure en InovaGuard en 30 segundos.
                    </p>
                  </div>

                  <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white shadow-xs">
                    <strong className="text-slate-900 dark:text-slate-100 block mb-1">4. Monitoreo del Balance de Licencias (/balance)</strong>
                    <p className="text-slate-600 dark:text-slate-400">
                      El sistema consulta en vivo el número de licencias activas vs disponibles, permitiendo al administrador adquirir nuevas licencias en InovaGuard antes de quedarse sin stock.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
    </ModalShell>
  );
};
