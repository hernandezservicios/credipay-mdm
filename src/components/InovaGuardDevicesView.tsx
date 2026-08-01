import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Lock,
  Unlock,
  QrCode,
  RefreshCw,
  Search,
  KeyRound,
  Trash2,
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  User,
  Battery,
  Signal,
  Calendar,
  X,
  ExternalLink,
  Handshake,
} from 'lucide-react';
import {
  MdmApiConfig,
  InovaGuardDeviceItem,
  InovaGuardBalance,
  InovaGuardLicence,
  ClientCredit,
} from '../types';
import {
  getInovaGuardDevices,
  getInovaGuardBalance,
  getInovaGuardLicences,
  getInovaGuardQrEnrollment,
  getInovaGuardCachedData,
  lockInovaGuardDevice,
  unlockInovaGuardDevice,
  generateInovaGuardUnlockCode,
  removeInovaGuardDevice,
} from '../services/inovaGuardApi';
import { useConfirm } from './ConfirmDialog';

interface InovaGuardDevicesViewProps {
  mdmConfig: MdmApiConfig;
  clients: ClientCredit[];
  onLockDevice: (id: string, reason: string) => void;
  onUnlockDevice: (id: string, reason: string) => void;
  onGenerateCode: (id: string) => void;
  onRemoveDevice: (id: string) => void;
  onSelectClient: (clientId: string) => void;
  onCreateLoanForDevice: (device: InovaGuardDeviceItem) => void;
  onSyncComplete?: () => void;
}

export const InovaGuardDevicesView: React.FC<InovaGuardDevicesViewProps> = ({
  mdmConfig,
  clients,
  onLockDevice,
  onUnlockDevice,
  onGenerateCode,
  onRemoveDevice,
  onSelectClient,
  onCreateLoanForDevice,
  onSyncComplete,
}) => {
  const confirmDialog = useConfirm();
  const [devices, setDevices] = useState<InovaGuardDeviceItem[]>([]);
  const [balance, setBalance] = useState<InovaGuardBalance | null>(null);
  const [licences, setLicences] = useState<InovaGuardLicence[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [totalDevices, setTotalDevices] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'LOCKED' | 'UNLOCKED' | 'STOCK'>('ALL');
  
  // Modal states
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [qrData, setQrData] = useState<{ qrUrl: string; enrollmentToken: string } | null>(null);
  const [codeModal, setCodeModal] = useState<{ isOpen: boolean; deviceName: string; code: string; unlockCode?: string } | null>(null);

  // Cargar datos en vivo. `force` omite la caché y consulta la red (siempre en
  // refrescos); `showLoader` controla el spinner (los refrescos en segundo plano
  // pasan `false` para no parpadear la pantalla).
  const loadInovaGuardData = async (force = false, showLoader = force) => {
    if (showLoader) setIsLoading(true);
    try {
      const [devRes, balRes, licRes] = await Promise.all([
        getInovaGuardDevices(mdmConfig, { force }),
        getInovaGuardBalance(mdmConfig, { force }),
        getInovaGuardLicences(mdmConfig, { force }),
      ]);
      setDevices(devRes.devices);
      setTotalDevices(devRes.totalDevices);
      setIsSimulated(devRes.isSimulated);
      setBalance(balRes.balance);
      setLicences(licRes.licences);
    } catch (err) {
      console.warn('Error cargando dispositivos InovaGuard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const cached = getInovaGuardCachedData();
    if (cached) {
      // Datos ya cargados -> render instantáneo y refresh real en segundo plano
      setDevices(cached.devices);
      setTotalDevices(cached.totalDevices);
      setIsSimulated(cached.isSimulated);
      setBalance(cached.balance);
      setLicences(cached.licences);
      setIsLoading(false);
      loadInovaGuardData(true, false);
    } else {
      // Primera vez -> loader y consulta real a la API
      loadInovaGuardData(true, true);
    }
  }, [mdmConfig]);

  // Polling cada 5s solo con la vista visible: cambios desde la plataforma
  // Inova (bloqueos, enrolamientos) se reflejan casi al instante. Al ocultar
  // la pestaña se detiene y al volver se refresca de inmediato.
  useEffect(() => {
    const isVisible = () => document.visibilityState === 'visible';
    let timer: number | undefined;

    const startPolling = () => {
      if (!isVisible()) return;
      loadInovaGuardData(true, false);
      timer = window.setInterval(() => {
        loadInovaGuardData(true, false);
      }, 5000);
    };

    const stopPolling = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibility = () => {
      if (isVisible()) {
        stopPolling();
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mdmConfig]);

  // Manejar sincronización manual (spinner + datos frescos del API)
  const handleSyncNow = async () => {
    setIsSyncing(true);
    await loadInovaGuardData(true);
    if (onSyncComplete) {
      onSyncComplete();
    }
    setIsSyncing(false);
  };

  // Cargar QR de Enrolamiento
  const handleOpenQr = async () => {
    setShowQrModal(true);
    try {
      const res = await getInovaGuardQrEnrollment(mdmConfig);
      setQrData(res);
    } catch (err) {
      console.warn('Error obteniendo QR', err);
    }
  };

  // Bloqueo manual por API /lock
  const handleLockClick = async (device: InovaGuardDeviceItem) => {
    const ok = await confirmDialog({
      icon: <Lock className="w-5 h-5" />,
      tone: 'rose',
      title: 'Confirmar Bloqueo MDM',
      message: `¿BLOQUEAR MDM el dispositivo ${device.deviceName} (InovaGuard ID: ${device.unlockCode || '—'})?\n\nSe enviará el comando de bloqueo y el cliente no podrá usar el equipo.`,
      confirmLabel: 'Sí, Bloquear',
    });
    if (!ok) return;
    const matchedClient = clients.find(c => c.device.inovaguardId === device.id || c.device.imei === device.imei);
    if (matchedClient) {
      onLockDevice(matchedClient.id, 'Bloqueado manualmente desde la Vista de Dispositivos InovaGuard', 'MANUAL_OPERATOR', true);
    } else {
      await lockInovaGuardDevice(mdmConfig, device.id);
    }
    setDevices(prev =>
      prev.map(d => (d.id === device.id ? { ...d, status: 'LOCKED' } : d))
    );
  };

  // Desbloqueo manual por API /unlock
  const handleUnlockClick = async (device: InovaGuardDeviceItem) => {
    const ok = await confirmDialog({
      icon: <Unlock className="w-5 h-5" />,
      tone: 'emerald',
      title: 'Confirmar Desbloqueo MDM',
      message: `¿DESBLOQUEAR MDM el dispositivo ${device.deviceName} (InovaGuard ID: ${device.unlockCode || '—'})?\n\nSe reenviará el comando de desbloqueo y el cliente recuperará el acceso.`,
      confirmLabel: 'Sí, Desbloquear',
    });
    if (!ok) return;
    const matchedClient = clients.find(c => c.device.inovaguardId === device.id || c.device.imei === device.imei);
    if (matchedClient) {
      onUnlockDevice(matchedClient.id, 'Desbloqueado manualmente desde la Vista de Dispositivos InovaGuard', 'MANUAL_OPERATOR', true);
    } else {
      await unlockInovaGuardDevice(mdmConfig, device.id);
    }
    setDevices(prev =>
      prev.map(d => (d.id === device.id ? { ...d, status: 'UNLOCKED' } : d))
    );
  };

  // Generar Código Unlock Offline /unlock-code
  const handleGenerateCodeClick = async (device: InovaGuardDeviceItem) => {
    const ok = await confirmDialog({
      icon: <KeyRound className="w-5 h-5" />,
      tone: 'indigo',
      title: 'Generar Código de Desbloqueo Offline',
      message: `¿GENERAR código de desbloqueo offline para ${device.deviceName} (InovaGuard ID: ${device.unlockCode || '—'})?\n\nEl cliente podrá desbloquear el equipo sin internet usando ese PIN temporal.`,
      confirmLabel: 'Sí, Generar Código',
    });
    if (!ok) return;
    const matchedClient = clients.find(c => c.device.inovaguardId === device.id || c.device.imei === device.imei);
    if (matchedClient) {
      onGenerateCode(matchedClient.id, true);
      return;
    }
    const res = await generateInovaGuardUnlockCode(mdmConfig, device.id);
    if (res.code) {
      setCodeModal({
        isOpen: true,
        deviceName: device.deviceName,
        unlockCode: device.unlockCode,
        code: res.code,
      });
    }
  };

  // Desvincular / Remove
  const handleRemoveClick = async (device: InovaGuardDeviceItem) => {
    const ok = await confirmDialog({
      icon: <Trash2 className="w-5 h-5" />,
      tone: 'rose',
      title: 'Desvincular Dispositivo del MDM',
      message: `¿DESVINCULAR el dispositivo InovaGuard ID: ${device.unlockCode || '—'} (${device.deviceName})?\n\nEl equipo dejará de estar monitoreado por MDM y la acción NO se puede deshacer.`,
      confirmLabel: 'Sí, Desvincular',
    });
    if (!ok) return;
    const matchedClient = clients.find(c => c.device.inovaguardId === device.id || c.device.imei === device.imei);
    if (matchedClient) {
      onRemoveDevice(matchedClient.id, true);
    } else {
      await removeInovaGuardDevice(mdmConfig, device.id);
    }
    setDevices(prev => prev.filter(d => d.id !== device.id));
  };

  // Filtrado
  const filteredDevices = devices.filter(device => {
    const clientInfo = clients.find(
      c => c.device.inovaguardId === device.id || c.device.imei === device.imei
    );

    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      device.deviceName.toLowerCase().includes(q) ||
      device.id.includes(q) ||
      device.imei.toLowerCase().includes(q) ||
      (device.serie && device.serie.toLowerCase().includes(q)) ||
      device.brand.toLowerCase().includes(q) ||
      device.model.toLowerCase().includes(q) ||
      (device.unlockCode && device.unlockCode.includes(q)) ||
      (device.assignedClientName &&
        device.assignedClientName.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (filterStatus === 'LOCKED') return device.status === 'LOCKED';
    if (filterStatus === 'UNLOCKED') return device.status === 'UNLOCKED';
    if (filterStatus === 'STOCK') return !device.assignedClientId && !clientInfo;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Cabecera de la sección y resumen de Balance */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-indigo-900/40">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Parque de Dispositivos InovaGuard MDM
                </h1>
                <p className="text-xs text-indigo-200 mt-0.5">
                  Consola unificada con sincronización real en punto de venta (API /devices, /balance & /qr-enrollment)
                </p>
              </div>
            </div>
          </div>

          {/* Tarjeta de Balance de Licencias InovaGuard */}
          {balance && (
            <div className="bg-slate-900/80 border border-indigo-800/60 rounded-xl p-3 min-w-[320px]">
              <div className="grid grid-cols-3 gap-3 text-center sm:text-left">
                <div className="px-2 border-r border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 block">
                    Licencias Total
                  </span>
                  <span className="text-xl font-extrabold text-white">
                    {balance.added}
                  </span>
                </div>
                <div className="px-2 border-r border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
                    Disponibles
                  </span>
                  <span className="text-xl font-extrabold text-emerald-400">
                    {balance.balance}
                  </span>
                </div>
                <div className="px-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block">
                    En Uso
                  </span>
                  <span className="text-xl font-extrabold text-amber-300">
                    {balance.demo_used + balance.basic_used + balance.business_used + balance.enterprise_used}
                  </span>
                </div>
              </div>

              {licences && (
                <div className="mt-3 pt-2.5 border-t border-slate-800 grid grid-cols-5 gap-1 text-center">
                  {licences.map((l) => (
                    <div key={l.name}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-300 block">
                        {l.name}
                      </span>
                      <span className="text-xs font-bold text-white">{l.availables}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botones de acción general */}
        <div className="mt-6 pt-5 border-t border-indigo-900/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
                isSimulated
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}
            >
              {isSimulated ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              <span>
                {isSimulated
                  ? 'DATOS SIMULADOS'
                  : `EN VIVO · ${totalDevices} DISPOSITIVOS REALES`}
              </span>
            </span>

            <button
              onClick={handleOpenQr}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition-all duration-150"
            >
              <QrCode className="w-4 h-4" />
              <span>Enrolamiento Rápido QR</span>
            </button>

            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-indigo-700/50 font-medium text-xs transition-all duration-150 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Refrescar API (/devices)'}</span>
            </button>
          </div>

          <div className="text-xs text-indigo-300">
            Conectado al servidor oficial: <strong className="font-mono text-white">api/v1/customer</strong>
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Input de Búsqueda */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por IMEI, Serie, ID InovaGuard, Código, Cliente, Marca o Modelo..."
              className="w-full pl-10 pr-4 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
            />
          </div>

          {/* Filtros rápidos por estado */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg">
            {(
              [
                { id: 'ALL', label: 'Todos', count: devices.length },
                {
                  id: 'LOCKED',
                  label: 'Bloqueados',
                  count: devices.filter(d => d.status === 'LOCKED').length,
                },
                {
                  id: 'UNLOCKED',
                  label: 'Desbloqueados',
                  count: devices.filter(d => d.status === 'UNLOCKED').length,
                },
                {
                  id: 'STOCK',
                  label: 'En Stock / Sin Asignar',
                  count: devices.filter(
                    d =>
                      !d.assignedClientId &&
                      !clients.some(
                        c => c.device.inovaguardId === d.id || c.device.imei === d.imei
                      )
                  ).length,
                },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                  filterStatus === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 text-slate-700">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista / Tabla de Dispositivos */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
          <p className="text-sm font-medium">Consultando dispositivos en InovaGuard MDM...</p>
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          <Smartphone className="w-10 h-10 mx-auto text-slate-400 mb-3" />
          <p className="text-sm font-medium text-slate-700">
            No se encontraron dispositivos que coincidan con la búsqueda o filtro seleccionado.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setFilterStatus('ALL');
            }}
            className="mt-4 px-4 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            Limpiar Filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.map(device => {
            const isLocked = device.status === 'LOCKED';
            const clientInfo = clients.find(
              c => c.device.inovaguardId === device.id || c.device.imei === device.imei
            );

            // Datos de identificación del cliente (cédula y contactos)
            const clientCedula = clientInfo ? clientInfo.cedulaOrId : device.assignedClientId;
            const clientPhone = clientInfo ? clientInfo.phone : device.ownerPhone;
            const clientEmail = clientInfo ? clientInfo.email : device.ownerEmail;
            const clientAddress = clientInfo ? clientInfo.address : device.ownerAddress;

            return (
              <div
                key={device.id}
                className={`bg-white rounded-xl border transition-all duration-150 shadow-xs hover:shadow-md overflow-hidden flex flex-col justify-between ${
                  isLocked ? 'border-rose-300 bg-rose-50/10' : 'border-slate-200'
                }`}
              >
                {/* Cabecera de la Tarjeta del Dispositivo */}
                <div className="p-4 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 shrink-0">
                          Código: {device.unlockCode || '—'}
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm truncate min-w-0">
                          {device.deviceName}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {device.brand} {device.model}
                      </p>
                    </div>

                    <span
                      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-[10px] font-bold border shrink-0 ${
                        isLocked
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      }`}
                    >
                      {isLocked ? (
                        <>
                          <Lock className="w-3 h-3 text-rose-700" />
                          <span>BLOQUEADO</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3 text-emerald-700" />
                          <span>DESBLOQUEADO</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* IMEI & Información técnica */}
                  <div className="mt-3 bg-slate-50 rounded-lg p-2.5 border border-slate-200/80 space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="text-slate-500 shrink-0">IMEI:</span>
                      <span className="font-mono font-semibold text-slate-800 truncate">
                        {device.imei}
                      </span>
                    </div>
                    {device.serie && device.serie !== device.imei && (
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-slate-500 shrink-0">Serie:</span>
                        <span className="font-mono text-slate-700 truncate">
                          {device.serie}
                        </span>
                      </div>
                    )}
                    {device.dueDate && (
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-slate-500 shrink-0">Vence Licencia:</span>
                        <span
                          className={`font-semibold ${
                            device.dueDate < new Date().toISOString().split('T')[0]
                              ? 'text-rose-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {device.dueDate}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs gap-2 border-t border-slate-200/80 pt-1.5">
                      <span className="text-slate-400 shrink-0">ID Interno:</span>
                      <span className="font-mono text-slate-500 truncate">{device.id}</span>
                    </div>
                  </div>
                </div>

                {/* Cliente Asignado */}
                <div className="px-4 py-3 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <User className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Cliente Asignado
                      </span>
                      {clientInfo ? (
                        <button
                          onClick={() => onSelectClient(clientInfo.id)}
                          className="text-xs font-semibold text-indigo-700 hover:underline flex items-center space-x-1"
                        >
                          <span>{clientInfo.fullName}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      ) : device.assignedClientName ? (
                        <span className="text-xs font-medium text-slate-700">
                          {device.assignedClientName}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          Sin Asignar (En Stock)
                        </span>
                      )}

                      {(clientCedula || clientPhone || clientEmail || clientAddress) && (
                        <div className="mt-1.5 space-y-0.5 text-[11px]">
                          {clientCedula && (
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-500">Cédula:</span>
                              <span className="font-mono text-slate-700">{clientCedula}</span>
                            </div>
                          )}
                          {clientPhone && (
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-500">Tel:</span>
                              <span className="text-slate-700">{clientPhone}</span>
                            </div>
                          )}
                          {clientEmail && (
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-500">Email:</span>
                              <span className="text-slate-700 truncate">{clientEmail}</span>
                            </div>
                          )}
                          {clientAddress && (
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-500">Dir:</span>
                              <span className="text-slate-700 truncate">{clientAddress}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {clientInfo && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        clientInfo.status === 'ATRASADO'
                          ? 'bg-rose-100 text-rose-800'
                          : clientInfo.status === 'VENCIDO'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {clientInfo.status}
                    </span>
                  )}
                </div>

                {/* Botones de acción directa para este celular */}
                <div className="p-3 border-t border-slate-100 bg-white grid grid-cols-2 gap-2">
                  {!clientInfo && !device.assignedClientId && (
                    <button
                      onClick={() => onCreateLoanForDevice(device)}
                      className="col-span-2 px-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-xs transition-colors"
                    >
                      <Handshake className="w-4 h-4" />
                      <span>Vincular a Préstamo (Stock → Nuevo Cliente)</span>
                    </button>
                  )}

                  {isLocked ? (
                    <button
                      onClick={() => handleUnlockClick(device)}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 shadow-xs transition-colors"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Desbloquear</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLockClick(device)}
                      className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 shadow-xs transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Bloquear MDM</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleGenerateCodeClick(device)}
                    className="px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs flex items-center justify-center space-x-1.5 border border-indigo-200 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Código Offline</span>
                  </button>

                  <button
                    onClick={() => handleRemoveClick(device)}
                    className="col-span-2 px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>Desvincular del MDM</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal QR de Enrolamiento */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <QrCode className="w-5 h-5 text-indigo-600" />
                <span>Enrolamiento QR - InovaGuard MDM</span>
              </h3>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 inline-block mx-auto">
              {qrData ? (
                <img
                  src={qrData.qrUrl}
                  alt="QR Enrolamiento InovaGuard"
                  className="w-48 h-48 mx-auto"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs">
                  Cargando QR...
                </div>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Escanea este QR desde el asistente inicial de Android o desde la App InovaGuard para
              enrolar el dispositivo en el catálogo de tu empresa al instante.
            </p>

            {qrData && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-left">
                <span className="text-[10px] font-bold text-indigo-700 uppercase block">
                  Token de Enrolamiento
                </span>
                <span className="font-mono text-xs text-indigo-900 font-bold">
                  {qrData.enrollmentToken}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl"
            >
              Cerrar QR
            </button>
          </div>
        </div>
      )}

      {/* Modal Código Offline generado */}
      {codeModal && codeModal.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
              <KeyRound className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">
                Código de Desbloqueo Offline
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Para el dispositivo <strong>{codeModal.deviceName}</strong>{' '}
                {codeModal.unlockCode ? `(InovaGuard ID: ${codeModal.unlockCode})` : ''}
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 my-2">
              <span className="text-[11px] font-bold text-amber-800 uppercase block mb-1">
                PIN Temporal del Sistema MDM
              </span>
              <span className="text-3xl font-mono font-extrabold text-amber-900 tracking-widest">
                {codeModal.code}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Entrega este código de 6 dígitos al cliente si no tiene internet para que lo ingrese
              directamente en la pantalla de bloqueo.
            </p>

            <button
              onClick={() => setCodeModal(null)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl"
            >
              Listo / Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
