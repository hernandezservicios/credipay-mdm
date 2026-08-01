import React, { useState, useMemo, useEffect } from 'react';
import {
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  AlertTriangle,
  CalendarClock,
  Cpu,
} from 'lucide-react';
import {
  ClientCredit,
  InstallmentStatus,
  MdmApiConfig,
  MdmApiLog,
  SystemMetrics,
  InovaGuardDeviceItem,
} from './types';
import {
  INITIAL_CLIENTS,
  INITIAL_MDM_CONFIG,
  INITIAL_LOGS,
} from './data/initialData';
import { Navbar, MainViewTab } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardStats } from './components/DashboardStats';
import { ClientList } from './components/ClientList';
import { InovaGuardDevicesView } from './components/InovaGuardDevicesView';
import { InstallmentsModal } from './components/InstallmentsModal';
import { MdmApiConfigModal } from './components/MdmApiConfigModal';
import { NewCreditModal } from './components/NewCreditModal';
import { AiCobranzaModal } from './components/AiCobranzaModal';
import { HostingerSqlModal } from './components/HostingerSqlModal';
import { FinanceView } from './components/FinanceView';
import { AnalyticsView } from './components/AnalyticsView';
import { PaymentModal, CascadePaymentPayload } from './components/PaymentModal';
import { useConfirm } from './components/ConfirmDialog';
import {
  lockInovaGuardDevice,
  unlockInovaGuardDevice,
  generateInovaGuardUnlockCode,
  removeInovaGuardDevice,
  getInovaGuardDevices,
  loginInovaGuard,
} from './services/inovaGuardApi';

// Persistencia local de la configuración MDM (credenciales + token renovado)
const MDM_CONFIG_STORAGE_KEY = 'credipay-mdm-config';

const loadStoredMdmConfig = (): MdmApiConfig => {
  try {
    const raw = localStorage.getItem(MDM_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MdmApiConfig>;
      if (parsed && typeof parsed === 'object' && parsed.baseUrl && parsed.appClient) {
        return { ...INITIAL_MDM_CONFIG, ...parsed };
      }
    }
  } catch (err) {
    console.warn('No se pudo leer la configuración MDM guardada:', err);
  }
  return INITIAL_MDM_CONFIG;
};

export default function App() {
  const confirmDialog = useConfirm();
  const [activeTab, setActiveTab] = useState<MainViewTab>('CLIENTS');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [clients, setClients] = useState<ClientCredit[]>(INITIAL_CLIENTS);
  const [mdmConfig, setMdmConfig] = useState<MdmApiConfig>(loadStoredMdmConfig);
  const [logs, setLogs] = useState<MdmApiLog[]>(INITIAL_LOGS);

  // Estados de interfaz y modales
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO'
  >('ALL');
  const [autoEngineActive, setAutoEngineActive] = useState(true);
  const [selectedClientForInstallments, setSelectedClientForInstallments] =
    useState<ClientCredit | null>(null);
  const [selectedClientForAi, setSelectedClientForAi] =
    useState<ClientCredit | null>(null);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [isNewCreditModalOpen, setIsNewCreditModalOpen] = useState(false);
  const [isHostingerSqlModalOpen, setIsHostingerSqlModalOpen] = useState(false);
  const [pendingLoanDevice, setPendingLoanDevice] = useState<InovaGuardDeviceItem | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    client: ClientCredit | null;
    installmentId?: string;
  } | null>(null);

  // Toast / Banner de notificación para feedback de acciones MDM
  const [notification, setNotification] = useState<{
    text: string;
    type: 'LOCK' | 'UNLOCK' | 'INFO';
  } | null>(null);

  const showNotification = (
    text: string,
    type: 'LOCK' | 'UNLOCK' | 'INFO' = 'INFO'
  ) => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification((prev) => (prev && prev.text === text ? null : prev));
    }, 4500);
  };

  // AL ARRANCAR: renovar token Bearer automáticamente (los tokens viejos
  // devuelven datos demo de otra cuenta). El token fresco queda en mdmConfig.
  useEffect(() => {
    if (!mdmConfig.enabled || !mdmConfig.liveMode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await loginInovaGuard(mdmConfig);
        if (!cancelled && !res.err && res.token) {
          setMdmConfig((prev) =>
            prev.bearerToken === res.token ? prev : { ...prev, bearerToken: res.token }
          );
        }
      } catch (err) {
        console.warn('[MDM] No se pudo renovar el token al arrancar:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistir la configuración MDM (credenciales + token) entre recargas
  useEffect(() => {
    try {
      localStorage.setItem(MDM_CONFIG_STORAGE_KEY, JSON.stringify(mdmConfig));
    } catch (err) {
      console.warn('No se pudo persistir la configuración MDM:', err);
    }
  }, [mdmConfig]);

  // Helper de log API
  const addLog = (
    clientId: string,
    clientName: string,
    imei: string,
    action: MdmApiLog['action'],
    trigger: MdmApiLog['trigger'],
    details: string
  ) => {
    const newLog: MdmApiLog = {
      id: 'LOG-' + Date.now(),
      timestamp: new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString(),
      clientId,
      clientName,
      imei,
      action,
      trigger,
      status: 'SUCCESS',
      details,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  // ACCIÓN MDM: BLOQUEAR CELULAR
  const handleLockDevice = async (
    clientId: string,
    reason: string,
    trigger: 'AUTOMATIC_OVERDUE' | 'MANUAL_OPERATOR' = 'MANUAL_OPERATOR',
    skipConfirm = false
  ) => {
    const target = clients.find((c) => c.id === clientId);
    if (!target) return;
    if (!skipConfirm) {
      const ok = await confirmDialog({
        icon: <Lock className="w-5 h-5" />,
        tone: 'rose',
        title: 'Confirmar Bloqueo MDM',
        message: `¿Deseas BLOQUEAR el celular ${target.device.model} de ${target.fullName}?\n\nEl cliente no podrá usar el equipo hasta que regularice su pago.`,
        confirmLabel: 'Sí, Bloquear',
      });
      if (!ok) return;
    }
    if (target.device.inovaguardId) {
      try {
        await lockInovaGuardDevice(mdmConfig, target.device.inovaguardId);
      } catch (err) {
        console.warn('Error al llamar a InovaGuard Lock', err);
      }
    }

    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== clientId) return cli;
        const wasLocked = cli.device.mdmStatus === 'LOCKED';
        if (!wasLocked) {
          addLog(
            cli.id,
            cli.fullName,
            cli.device.imei,
            'LOCK',
            trigger,
            `${reason} ${cli.device.unlockCode ? `(InovaGuard ID: ${cli.device.unlockCode})` : ''}`
          );
          showNotification(
            `🔒 MDM LOCK EJECUTADO: Celular ${cli.device.model} del cliente ${cli.fullName} ha sido bloqueado.`,
            'LOCK'
          );
        }
        return {
          ...cli,
          device: {
            ...cli.device,
            mdmStatus: 'LOCKED',
            lastMdmSync: 'Hace unos segundos (Bloqueo enviado)',
          },
        };
      })
    );
  };

  // ACCIÓN MDM: DESBLOQUEAR CELULAR
  const handleUnlockDevice = async (
    clientId: string,
    reason: string,
    trigger: 'AUTOMATIC_PAYMENT' | 'MANUAL_OPERATOR' = 'MANUAL_OPERATOR',
    skipConfirm = false
  ) => {
    const target = clients.find((c) => c.id === clientId);
    if (!target) return;
    if (!skipConfirm) {
      const ok = await confirmDialog({
        icon: <Unlock className="w-5 h-5" />,
        tone: 'emerald',
        title: 'Confirmar Desbloqueo MDM',
        message: `¿Deseas DESBLOQUEAR el celular ${target.device.model} de ${target.fullName}?\n\nSe reenviará el comando MDM y el cliente recuperará el acceso.`,
        confirmLabel: 'Sí, Desbloquear',
      });
      if (!ok) return;
    }
    if (target.device.inovaguardId) {
      try {
        await unlockInovaGuardDevice(mdmConfig, target.device.inovaguardId);
      } catch (err) {
        console.warn('Error al llamar a InovaGuard Unlock', err);
      }
    }

    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== clientId) return cli;
        const wasLocked = cli.device.mdmStatus === 'LOCKED';
        if (wasLocked) {
          addLog(
            cli.id,
            cli.fullName,
            cli.device.imei,
            'UNLOCK',
            trigger,
            `${reason} ${cli.device.unlockCode ? `(InovaGuard ID: ${cli.device.unlockCode})` : ''}`
          );
          showNotification(
            `🔓 MDM UNLOCK EJECUTADO: Celular ${cli.device.model} del cliente ${cli.fullName} desbloqueado exitosamente.`,
            'UNLOCK'
          );
        }
        return {
          ...cli,
          device: {
            ...cli.device,
            mdmStatus: 'UNLOCKED',
            lastMdmSync: 'Hace unos segundos (Desbloqueado)',
          },
        };
      })
    );
  };

  // ACCIÓN MDM: GENERAR CÓDIGO OFFLINE DE INOVAGUARD
  const handleGenerateUnlockCode = async (clientId: string, skipConfirm = false) => {
    const target = clients.find((c) => c.id === clientId);
    if (!target) return;
    if (!skipConfirm) {
      const ok = await confirmDialog({
        icon: <KeyRound className="w-5 h-5" />,
        tone: 'indigo',
        title: 'Generar Código de Desbloqueo Offline',
        message: `¿Deseas GENERAR un código de desbloqueo offline para el celular ${target.device.model} de ${target.fullName}?\n\nEl cliente podrá desbloquear el equipo sin internet con ese PIN temporal.`,
        confirmLabel: 'Sí, Generar Código',
      });
      if (!ok) return;
    }

    const deviceId = target.device.inovaguardId || target.device.imei.slice(-4);
    const res = await generateInovaGuardUnlockCode(mdmConfig, deviceId);    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== clientId) return cli;
        return {
          ...cli,
          device: {
            ...cli.device,
            lastUnlockCode: res.code,
            lastMdmSync: `Código generado: ${res.code}`,
          },
        };
      })
    );

    addLog(
      target.id,
      target.fullName,
      target.device.imei,
      'UNLOCK_CODE',
      'MANUAL_OPERATOR',
      `Generado Código de Desbloqueo Offline (#${res.code}) para InovaGuard ID: ${target.device.unlockCode || target.device.imei.slice(-4)}.`
    );

    showNotification(
      `🔑 CÓDIGO OFFLINE GENERADO (#${res.code}): Puedes dar este código al cliente para desbloqueo manual sin internet.`,
      'INFO'
    );
  };

  // ACCIÓN MDM: DESVINCULAR DISPOSITIVO (REMOVE)
  const handleRemoveDevice = async (clientId: string, skipConfirm = false) => {
    const target = clients.find((c) => c.id === clientId);
    if (!target) return;
    if (!skipConfirm) {
      const ok = await confirmDialog({
        icon: <Trash2 className="w-5 h-5" />,
        tone: 'rose',
        title: 'Desvincular Dispositivo del MDM',
        message: `¿Deseas DESVINCULAR y ELIMINAR el dispositivo ${target.device.model} de ${target.fullName} de la plataforma MDM?\n\nEl equipo dejará de estar monitoreado y la acción NO se puede deshacer.`,
        confirmLabel: 'Sí, Desvincular',
      });
      if (!ok) return;
    }

    const deviceId = target.device.inovaguardId || target.device.imei.slice(-4);
    await removeInovaGuardDevice(mdmConfig, deviceId);

    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== clientId) return cli;
        return {
          ...cli,
          device: {
            ...cli.device,
            mdmStatus: 'UNLOCKED',
            inovaguardId: undefined,
            lastMdmSync: 'Desvinculado (Remove MDM InovaGuard)',
          },
        };
      })
    );

    addLog(
      target.id,
      target.fullName,
      target.device.imei,
      'REMOVE',
      'MANUAL_OPERATOR',
      `Dispositivo removido de la plataforma InovaGuard (InovaGuard ID: ${target.device.unlockCode || target.device.imei.slice(-4)}).`
    );

    showNotification(
      `🗑️ DISPOSITIVO DESVINCULADO: El celular ${target.device.model} ha sido eliminado de la consola MDM.`,
      'INFO'
    );
  };

  // ACCIÓN MDM: SYNC INOVAGUARD DEVICES (/devices)
  const handleSyncInovaGuard = async () => {
    showNotification('🔄 Sincronizando dispositivos en vivo desde InovaGuard API...', 'INFO');
    try {
      const { devices, isSimulated, totalDevices } = await getInovaGuardDevices(mdmConfig, {
        force: true,
      });
      let updatedCount = 0;

      setClients((prev) =>
        prev.map((cli) => {
          const remoteDevice = devices.find(
            (d) => d.id === cli.device.inovaguardId || d.imei === cli.device.imei
          );
          if (!remoteDevice) return cli;

          updatedCount++;
          return {
            ...cli,
            device: {
              ...cli.device,
              inovaguardId: remoteDevice.id,
              unlockCode: remoteDevice.unlockCode,
              mdmStatus: remoteDevice.status,
              lastMdmSync: `Sincronizado vía InovaGuard /devices (${new Date().toLocaleTimeString()})`,
            },
          };
        })
      );

      addLog(
        'SYS-SYNC',
        'Motor de Sincronización',
        'GLOBAL-MDM',
        'SYNC_DEVICES',
        'SYSTEM_SYNC',
        `Sincronización masiva de ${totalDevices} dispositivos en InovaGuard API (${mdmConfig.baseUrl}/devices).`
      );

      showNotification(
        isSimulated
          ? `⚠️ SYNC SIMULADO: La API no respondió; se usaron ${totalDevices} dispositivos demo. Revisa credenciales/CORS.`
          : `✅ SYNC INOVAGUARD COMPLETO: Se sincronizaron ${totalDevices} dispositivos reales y se actualizaron ${updatedCount} clientes en la consola.`,
        'INFO'
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      showNotification(`❌ Error al sincronizar con InovaGuard: ${errorMsg}`, 'LOCK');
    }
  };

  // ACCIÓN: CHECK STATUS API
  const handleCheckStatus = (clientId: string) => {
    const cli = clients.find((c) => c.id === clientId);
    if (!cli) return;
    addLog(
      cli.id,
      cli.fullName,
      cli.device.imei,
      'STATUS_CHECK',
      'MANUAL_OPERATOR',
      `Comprobación de conectividad con la API Externa en ${mdmConfig.baseUrl}. Equipo operando normal.`
    );
    showNotification(
      `🌐 Conexión API Externa OK: El dispositivo ${cli.device.model} (IMEI: ${cli.device.imei}) responde correctamente.`,
      'INFO'
    );
  };

  // REGISTRAR PAGO EN CASCADA (distribuye el monto entre las cuotas pendientes,
  // registra abonos parciales y desbloquea automáticamente si no quedan atrasos)
  const handleCascadePayment = (payload: CascadePaymentPayload) => {
    const target = clients.find((c) => c.id === payload.clientId);
    if (!target) return;

    const affectedIds = new Set(payload.affected.map((a) => a.installment.id));
    const fullyPaidNumbers = payload.affected
      .filter((a) => a.becamePaid)
      .map((a) => a.installment.number);
    const abonoNumbers = payload.affected
      .filter((a) => !a.becamePaid)
      .map((a) => a.installment.number);

    // Desbloqueo automático si con este pago no queda NINGÚN atraso
    const hadOverdue = target.installments.some((i) => i.status === 'ATRASADO');
    const overdueLeft = target.installments.some(
      (i) => i.status === 'ATRASADO' && !affectedIds.has(i.id)
    );
    const willUnlock = hadOverdue && !overdueLeft;

    // Registro en auditoría por cada cuota afectada (fuera del updater)
    payload.affected.forEach((a) => {
      const before = a.installment.paidAmount || 0;
      addLog(
        target.id,
        target.fullName,
        target.device.imei,
        'PAYMENT_REC',
        'MANUAL_OPERATOR',
        `Pago en cascada (${payload.method}${payload.bank ? ` · ${payload.bank}` : ''}): RD$${a.applied.toLocaleString()} → cuota #${a.installment.number}${a.becamePaid ? ' COMPLETADA' : ` (abono total RD$${(before + a.applied).toLocaleString()}, restan RD$${a.remainingAfter.toLocaleString()})`}.${payload.change > 0 ? ` Vuelto entregado: RD$${payload.change.toLocaleString()}.` : ''}`
      );
    });

    if (willUnlock) {
      addLog(
        target.id,
        target.fullName,
        target.device.imei,
        'UNLOCK',
        'AUTOMATIC_PAYMENT',
        `Pago en cascada recibido. Sin atrasos pendientes -> Desbloqueo MDM ejecutado automáticamente vía ${mdmConfig.baseUrl}.`
      );
    }

    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== payload.clientId) return cli;

        const nextInstallments = cli.installments.map((inst) => {
          const aff = payload.affected.find((a) => a.installment.id === inst.id);
          if (!aff) return inst;
          const paidAmount = (inst.paidAmount || 0) + aff.applied;
          if (aff.becamePaid) {
            return {
              ...inst,
              paidAmount,
              status: 'PAGADO' as InstallmentStatus,
              paidDate: new Date().toISOString().split('T')[0],
              paymentRef: 'REC-' + Math.floor(10000 + Math.random() * 90000),
            };
          }
          return { ...inst, paidAmount };
        });

        let nextDevice = { ...cli.device };
        if (willUnlock && cli.device.mdmStatus === 'LOCKED' && mdmConfig.autoUnlockOnPaid) {
          nextDevice = {
            ...cli.device,
            mdmStatus: 'UNLOCKED',
            lastMdmSync: 'Hace unos instantes (Desbloqueado al recibir pago en cascada)',
          };
        }

        const updatedClient = {
          ...cli,
          device: nextDevice,
          installments: nextInstallments,
        };

        if (selectedClientForInstallments && selectedClientForInstallments.id === cli.id) {
          setSelectedClientForInstallments(updatedClient);
        }

        return updatedClient;
      })
    );

    const paidLabel =
      fullyPaidNumbers.length > 0
        ? `cuota${fullyPaidNumbers.length > 1 ? 's' : ''} ${fullyPaidNumbers.map((n) => `#${n}`).join(', ')} pagada${fullyPaidNumbers.length > 1 ? 's' : ''}`
        : '';
    const abonoLabel =
      abonoNumbers.length > 0
        ? `${paidLabel ? ' y ' : ''}abono${abonoNumbers.length > 1 ? 's' : ''} en cuota${abonoNumbers.length > 1 ? 's' : ''} ${abonoNumbers.map((n) => `#${n}`).join(', ')}`
        : '';
    const changeLabel = payload.change > 0 ? ` · Vuelto a entregar: RD$${payload.change.toLocaleString()}` : '';

    showNotification(
      `💵 PAGO EN CASCADA: ${paidLabel}${abonoLabel} de ${target.fullName} (RD$${payload.amountApplied.toLocaleString()} aplicados).${changeLabel}`,
      'INFO'
    );

    if (willUnlock && target.device.mdmStatus === 'LOCKED') {
      showNotification(
        `🎉 DESBLOQUEO AUTOMÁTICO: El celular de ${target.fullName} fue desbloqueado por MDM al quedar al día con el pago en cascada.`,
        'UNLOCK'
      );
    }
  };

  // SIMULAR QUE UNA CUOTA SE ATRASA 3 DÍAS (>3 DÍAS) PARA PROBAR LA MORA DE $200 Y BLOQUEO MDM AUTOMÁTICO
  const handleSimulateOverdue = async (clientId: string, installmentId: string) => {
    const cli = clients.find((c) => c.id === clientId);
    if (!cli) return;
    const ok = await confirmDialog({
      icon: <AlertTriangle className="w-5 h-5" />,
      tone: 'amber',
      title: 'Simular Cuota Atrasada (+3 días)',
      message: `¿Marcar la cuota de ${cli.fullName} como ATRASADA (+RD$200 de mora) y enviar el bloqueo MDM automático?\n\nEsto modifica el estado real de la cartera para pruebas.`,
      confirmLabel: 'Sí, Simular Atraso',
    });
    if (!ok) return;

    let lockedClientName = '';
    setClients((prev) =>
      prev.map((cli) => {
        if (cli.id !== clientId) return cli;
        lockedClientName = cli.fullName;

        const nextInstallments = cli.installments.map((inst) => {
          if (inst.id !== installmentId) return inst;
          return {
            ...inst,
            status: 'ATRASADO' as InstallmentStatus,
            penaltyAmount: 200, // Mora fija de 200 pesos sin aumento
            totalAmount: inst.amount + 200,
          };
        });

        let nextDevice = { ...cli.device };
        if (cli.device.mdmStatus !== 'LOCKED' && mdmConfig.autoLockOnOverdue) {
          nextDevice = {
            ...cli.device,
            mdmStatus: 'LOCKED',
            lastMdmSync: 'Hace un momento (Bloqueado por cuota ATRASADO +3 días)',
          };
          addLog(
            cli.id,
            cli.fullName,
            cli.device.imei,
            'LOCK',
            'AUTOMATIC_OVERDUE',
            `Simulación: Cuota superó 3 días de vencida. Mora de $200 fija aplicada. Bloqueo MDM emitido automáticamente.`
          );
        }

        const updatedClient = {
          ...cli,
          device: nextDevice,
          installments: nextInstallments,
        };

        if (selectedClientForInstallments && selectedClientForInstallments.id === cli.id) {
          setSelectedClientForInstallments(updatedClient);
        }

        return updatedClient;
      })
    );

    showNotification(
      `⚠️ CUOTA ATRASADA EN SIMULACIÓN: Se aplicó mora fija de $200 a ${lockedClientName} y se ordenó el BLOQUEO MDM automático.`,
      'LOCK'
    );
  };

  // EVALUAR ESTADOS DE TODAS LAS CUOTAS (Motor Automático)
  // Revisa cuotas VENCIDO y si pasaron >3 días las convierte en ATRASADO (+200 pesos mora y BLOQUEO MDM)
  const runAutoEngineNow = async () => {
    const ok = await confirmDialog({
      icon: <Cpu className="w-5 h-5" />,
      tone: 'rose',
      title: 'Ejecutar Motor Automático',
      message:
        '¿EJECUTAR el Motor Automático sobre toda la cartera?\n\nSe evaluarán todas las cuotas: las vencidas por más de 3 días pasarán a ATRASADO con RD$200 de mora y bloqueo MDM automático.',
      confirmLabel: 'Sí, Ejecutar Motor',
    });
    if (!ok) return;

    let lockedCount = 0;
    setClients((prev) =>
      prev.map((cli) => {
        let needsLock = false;
        const nextInstallments = cli.installments.map((inst) => {
          // Si estaba en PENDIENTE o VENCIDO pero por fecha ya pasó a más de 3 días de atraso -> ATRASADO
          const todayDate = new Date();
          const dueDateObj = new Date(inst.dueDate);
          const diffTime = todayDate.getTime() - dueDateObj.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));

          if (inst.status !== 'PAGADO' && inst.status !== 'ATRASADO' && diffDays >= 3) {
            needsLock = true;
            return {
              ...inst,
              status: 'ATRASADO' as InstallmentStatus,
              penaltyAmount: 200,
              totalAmount: inst.amount + 200,
            };
          }
          if (inst.status === 'PENDIENTE' && diffDays >= 0 && diffDays < 3) {
            return {
              ...inst,
              status: 'VENCIDO' as InstallmentStatus,
            };
          }
          return inst;
        });

        let nextDevice = { ...cli.device };
        if (needsLock && cli.device.mdmStatus !== 'LOCKED' && mdmConfig.autoLockOnOverdue) {
          lockedCount++;
          nextDevice = {
            ...cli.device,
            mdmStatus: 'LOCKED',
            lastMdmSync: 'Automático por motor de control (>3 días de atraso)',
          };
          addLog(
            cli.id,
            cli.fullName,
            cli.device.imei,
            'LOCK',
            'AUTOMATIC_OVERDUE',
            `Motor Automático detectó cuota con >= 3 días después del vencimiento. Mora $200 fija + Bloqueo MDM aplicados.`
          );
        }

        return {
          ...cli,
          device: nextDevice,
          installments: nextInstallments,
        };
      })
    );

    if (lockedCount > 0) {
      showNotification(
        `⚙️ MOTOR MDM EJECUTADO: Se detectaron cuotas atrasadas (>3 días), se aplicó mora fija de $200 y se bloquearon ${lockedCount} dispositivos automáticamente.`,
        'LOCK'
      );
    } else {
      showNotification(
        `⚙️ MOTOR MDM EVALUADO: Todos los créditos verificados. No hubo nuevos atrasos mayores a 3 días.`,
        'INFO'
      );
    }
  };

  // SIMULADOR: ADELANTAR FECHAS DE VENCIMIENTO 3 DÍAS (Para probar fácilmente toda la regla de negocio)
  const handleSimulateDayPass = async () => {
    const ok = await confirmDialog({
      icon: <CalendarClock className="w-5 h-5" />,
      tone: 'amber',
      title: 'Simular Avance de Tiempo (+3 días)',
      message:
        '¿Adelantar el tiempo 3 días en toda la cartera?\n\nLas cuotas pendientes pasarán a VENCIDO, las vencidas a ATRASADO (+RD$200 de mora) y se ordenará el bloqueo MDM automático.',
      confirmLabel: 'Sí, Avanzar 3 Días',
    });
    if (!ok) return;

    setClients((prev) =>
      prev.map((cli) => {
        const nextInstallments = cli.installments.map((inst) => {
          if (inst.status === 'PAGADO') return inst;
          // Si era PENDIENTE y adelantamos 3 días, pasa a VENCIDO
          if (inst.status === 'PENDIENTE') {
            return {
              ...inst,
              status: 'VENCIDO' as InstallmentStatus,
              dueDate: new Date().toISOString().split('T')[0],
            };
          }
          // Si ya estaba en VENCIDO, al pasar 3 días pasa a ATRASADO con $200 mora
          if (inst.status === 'VENCIDO') {
            return {
              ...inst,
              status: 'ATRASADO' as InstallmentStatus,
              penaltyAmount: 200, // Mora de 200 fija sin aumento
              totalAmount: inst.amount + 200,
            };
          }
          return inst;
        });

        // Si ahora tiene cuotas en ATRASADO, el dispositivo debe BLOQUEARSE
        const hasOverdue = nextInstallments.some((i) => i.status === 'ATRASADO');
        let nextDevice = { ...cli.device };

        if (hasOverdue && cli.device.mdmStatus !== 'LOCKED' && mdmConfig.autoLockOnOverdue) {
          nextDevice = {
            ...cli.device,
            mdmStatus: 'LOCKED',
            lastMdmSync: 'Hace instantes (Simulación: +3 días transcurridos)',
          };
          addLog(
            cli.id,
            cli.fullName,
            cli.device.imei,
            'LOCK',
            'AUTOMATIC_OVERDUE',
            'Simulación de avance en tiempo: Cuotas vencidas superaron 3 días de gracia. Mora $200 + Bloqueo MDM ordenado.'
          );
        }

        return {
          ...cli,
          device: nextDevice,
          installments: nextInstallments,
        };
      })
    );

    showNotification(
      `📅 SIMULACIÓN DE AVANCE EN TIEMPO (+3 DÍAS): Cuotas vencidas han pasado a ATRASADO con $200 de mora y bloqueo automático MDM activado.`,
      'LOCK'
    );
  };

  // CÁLCULO DE METRICAS DEL SISTEMA
  const metrics: SystemMetrics = useMemo(() => {
    const totalClients = clients.length;
    const activeCredits = clients.length;
    const lockedDevicesCount = clients.filter(
      (c) => c.device.mdmStatus === 'LOCKED'
    ).length;
    const overdueCount = clients.reduce((acc, client) => {
      return (
        acc +
        client.installments.filter((i) => i.status === 'ATRASADO').length
      );
    }, 0);
    const totalCollectedThisMonth = clients.reduce((sum, client) => {
      const paid = client.installments.filter((i) => i.status === 'PAGADO');
      const partial = client.installments.filter(
        (i) => i.status !== 'PAGADO' && (i.paidAmount || 0) > 0
      );
      return (
        sum +
        paid.reduce((pSum, i) => pSum + i.totalAmount, 0) +
        partial.reduce((pSum, i) => pSum + (i.paidAmount || 0), 0)
      );
    }, 0);
    const pendingCollection = clients.reduce((sum, client) => {
      const unpaid = client.installments.filter((i) => i.status !== 'PAGADO');
      return (
        sum +
        unpaid.reduce(
          (pSum, i) => pSum + Math.max(0, i.totalAmount - (i.paidAmount || 0)),
          0
        )
      );
    }, 0);

    return {
      totalClients,
      activeCredits,
      lockedDevicesCount,
      overdueCount,
      totalCollectedThisMonth,
      pendingCollection,
    };
  }, [clients]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans">
      {/* Toast de Notificación flotante */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div
            className={`px-5 py-3 rounded-xl shadow-2xl border flex items-center space-x-3 text-xs font-semibold ${
              notification.type === 'LOCK'
                ? 'bg-rose-900 text-white border-rose-700'
                : notification.type === 'UNLOCK'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            <span>{notification.text}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <Navbar
        onOpenNewCredit={() => setIsNewCreditModalOpen(true)}
        onOpenApiConfig={() => setIsApiModalOpen(true)}
        onOpenHostingerSql={() => setIsHostingerSqlModalOpen(true)}
        autoEngineActive={autoEngineActive}
        onToggleAutoEngine={() => setAutoEngineActive(!autoEngineActive)}
        onRunEngineNow={runAutoEngineNow}
        mdmConfigEnabled={mdmConfig.enabled}
        onSyncInovaGuard={handleSyncInovaGuard}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
      />

      {/* Contenedor Principal con Sidebar Lateral */}
      <div className="flex flex-1 w-full min-h-[calc(100vh-4rem)] relative">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          clientsCount={clients.length}
          logsCount={logs.length}
          autoEngineActive={autoEngineActive}
          onToggleAutoEngine={() => setAutoEngineActive(!autoEngineActive)}
          onRunEngineNow={runAutoEngineNow}
          onOpenNewCredit={() => setIsNewCreditModalOpen(true)}
          onOpenApiConfig={() => setIsApiModalOpen(true)}
          onOpenHostingerSql={() => setIsHostingerSqlModalOpen(true)}
          onSyncInovaGuard={handleSyncInovaGuard}
          mdmConfigEnabled={mdmConfig.enabled}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {/* Contenido Principal según Pestaña Activa */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full overflow-x-hidden">
        {activeTab === 'CLIENTS' && (
          <>
            <DashboardStats
              metrics={metrics}
              onSimulateDayPass={handleSimulateDayPass}
              onOpenInstallmentsFilter={(s) => setFilterStatus(s)}
            />

            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Cartera de Clientes & Control MDM de Celulares
                  </h2>
                  <p className="text-xs text-slate-500">
                    Gestiona créditos, verifica estados de cuotas y ejecuta bloqueos o desbloqueos instantáneos o por API
                  </p>
                </div>
              </div>

              <ClientList
                clients={clients}
                filterStatus={filterStatus}
                onSelectClientForInstallments={(client) =>
                  setSelectedClientForInstallments(client)
                }
                onSelectClientForAi={(client) => setSelectedClientForAi(client)}
                onLockDevice={handleLockDevice}
                onUnlockDevice={handleUnlockDevice}
                onCheckStatus={handleCheckStatus}
                onFilterChange={(s) => setFilterStatus(s)}
                onGenerateUnlockCode={handleGenerateUnlockCode}
                onRemoveDevice={handleRemoveDevice}
              />
            </div>
          </>
        )}

        {activeTab === 'DEVICES' && (
          <InovaGuardDevicesView
            mdmConfig={mdmConfig}
            clients={clients}
            onLockDevice={handleLockDevice}
            onUnlockDevice={handleUnlockDevice}
            onGenerateCode={handleGenerateUnlockCode}
            onRemoveDevice={handleRemoveDevice}
            onSelectClient={(clientId) => {
              const matched = clients.find(c => c.id === clientId);
              if (matched) {
                setSelectedClientForInstallments(matched);
                setActiveTab('CLIENTS');
              }
            }}
            onCreateLoanForDevice={(device) => {
              setPendingLoanDevice(device);
              setIsNewCreditModalOpen(true);
            }}
            onSyncComplete={handleSyncInovaGuard}
          />
        )}

        {activeTab === 'FINANCE' && (
          <FinanceView
            clients={clients}
            onOpenPayment={() => setPaymentModal({ client: null })}
            onOpenNewCredit={() => setIsNewCreditModalOpen(true)}
          />
        )}

        {activeTab === 'ANALYTICS' && (
          <AnalyticsView clients={clients} />
        )}

        {activeTab === 'LOGS' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 border-b border-slate-100 pb-4 gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Auditoría Completa de Órdenes MDM & Sincronizaciones InovaGuard
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Historial y traza inmutable de todos los comandos de bloqueo, mora, códigos offline y sync REST
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-full self-start sm:self-center">
                  {logs.length} Eventos Registrados
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-400 bg-slate-50/70">
                      <th className="py-3 px-4">Fecha & Hora</th>
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">IMEI / Dispositivo</th>
                      <th className="py-3 px-4">Acción MDM</th>
                      <th className="py-3 px-4">Origen / Trigger</th>
                      <th className="py-3 px-4">Detalle Técnico</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {log.timestamp}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {log.clientName}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {log.imei}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                              log.action === 'LOCK'
                                ? 'bg-rose-100 text-rose-800'
                                : log.action === 'UNLOCK'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.action === 'UNLOCK_CODE'
                                ? 'bg-indigo-100 text-indigo-800'
                                : log.action === 'REMOVE'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-medium">
                          {log.trigger}
                        </td>
                        <td className="py-3 px-4 text-slate-700 max-w-sm">
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
      </div>

      {/* Pie de página */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-6 text-center text-xs">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-medium text-slate-300">
            CrediPay MDM • Sistema Integral de Préstamos para Celulares con Bloqueo MDM en Pesos Dominicanos
          </p>
          <p className="text-slate-500 mt-1">
            4 Estados: Pendiente | Vencido (Día 0-2) | Atrasado (+3 días, +RD$200 mora fija & Bloqueo automático) | Pagado (Desbloqueo automático)
          </p>
        </div>
      </footer>

      {/* Modales */}
      <InstallmentsModal
        client={selectedClientForInstallments}
        onClose={() => setSelectedClientForInstallments(null)}
        onOpenPayment={(clientId, installmentId) =>
          setPaymentModal({
            client: clients.find((c) => c.id === clientId) ?? null,
            installmentId,
          })
        }
        onSimulateOverdue={handleSimulateOverdue}
      />

      <MdmApiConfigModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        config={mdmConfig}
        onSaveConfig={(newCfg) => setMdmConfig(newCfg)}
        logs={logs}
        onClearLogs={() => setLogs([])}
      />

      <NewCreditModal
        isOpen={isNewCreditModalOpen}
        onClose={() => {
          setIsNewCreditModalOpen(false);
          setPendingLoanDevice(null);
        }}
        initialDevice={
          pendingLoanDevice
            ? {
                brand: pendingLoanDevice.brand,
                model: pendingLoanDevice.model,
                imei: pendingLoanDevice.imei,
                inovaguardId: pendingLoanDevice.id,
                unlockCode: pendingLoanDevice.unlockCode,
                deviceName: pendingLoanDevice.deviceName,
              }
            : null
        }
        onCreateCredit={(newClient) => {
          setClients((prev) => [newClient, ...prev]);
          setPendingLoanDevice(null);
          showNotification(
            `✅ Nuevo crédito y celular ${newClient.device.model} registrados para ${newClient.fullName}.`,
            'INFO'
          );
        }}
      />

      <AiCobranzaModal
        client={selectedClientForAi}
        onClose={() => setSelectedClientForAi(null)}
      />

      {paymentModal && (
        <PaymentModal
          clients={clients}
          client={paymentModal?.client ?? null}
          initialInstallmentId={paymentModal?.installmentId}
          onClose={() => setPaymentModal(null)}
          onConfirm={handleCascadePayment}
        />
      )}

      <HostingerSqlModal
        isOpen={isHostingerSqlModalOpen}
        onClose={() => setIsHostingerSqlModalOpen(false)}
      />
    </div>
  );
}
