import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  AlertTriangle,
  CalendarClock,
  Cpu,
  Loader2,
} from 'lucide-react';
import {
  ClientCredit,
  InstallmentStatus,
  MdmStatus,
  MdmApiConfig,
  MdmApiLog,
  SystemMetrics,
  InovaGuardDeviceItem,
  Installment,
  MobileDevice,
} from './types';
import { INITIAL_MDM_CONFIG } from './data/initialData';
import { Navbar, MainViewTab } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardStats } from './components/DashboardStats';
import { ClientList } from './components/ClientList';
import { InovaGuardDevicesView } from './components/InovaGuardDevicesView';
import { InstallmentsModal } from './components/InstallmentsModal';
import { MdmApiConfigModal } from './components/MdmApiConfigModal';
import { NewCreditModal } from './components/NewCreditModal';
import { AiCobranzaModal } from './components/AiCobranzaModal';
import { FinanceView } from './components/FinanceView';
import { AnalyticsView } from './components/AnalyticsView';
import { PaymentModal, CascadePaymentPayload } from './components/PaymentModal';
import { useConfirm } from './components/ConfirmDialog';
import { LoginScreen } from './components/LoginScreen';
import { SaaSAvView } from './components/SaaSAvView';
import { CollectionsView } from './components/CollectionsView';
import { SecurityModal } from './components/SecurityModal';
import { PlatformSidebar, PortalTab } from './components/PlatformSidebar';
import { PlatformPortalView } from './components/PlatformPortalView';
import { TenantFormModal } from './components/TenantFormModal';
import { PlanFormModal } from './components/PlanFormModal';
import {
  apiFetchMe,
  apiLogout,
  apiListClients,
  apiGetClient,
  apiCreateClient,
  apiCreateCredit,
  apiCreateDevice,
  apiPatchInstallment,
  apiCascadePayment,
  apiSyncDevice,
  apiGetMdmConfig,
  apiPutMdmConfig,
  apiGetDeviceEvents,
  apiListTenants,
  apiSwitchTenant,
  apiSwitchTenantExit,
  apiMdmSyncAll,
  apiListPlans,
  apiSubscriptionCurrent,
  apiChangePlan,
  apiRenewSubscription,
  apiBillingPayments,
  apiGetGateways,
  apiSetGateway,
  apiPlatformOverview,
  apiCollectionSummary,
  apiCollectionRun,
  apiCollectionReminders,
  apiCollectionSendReminder,
  apiCollectionRuns,
  apiGetTenantDetail,
  apiTogglePlan,
  apiDuplicatePlan,
  apiDeletePlan,
  errorMessage,
  type Session,
  type ClientFullRow,
  type DeviceEventRow,
  type TenantRow,
  type SubscriptionRow,
  type SubscriptionUsage,
  type PlanRow,
  type BillingPaymentRow,
  type GatewayRow,
  type PlatformTenantRow,
  type TenantDetailRow,
  type CollectionSummaryRow,
  type CollectionReminderRow,
  type CollectionRunRow,
} from './services/api';
import {
  lockInovaGuardDevice,
  unlockInovaGuardDevice,
  generateInovaGuardUnlockCode,
  removeInovaGuardDevice,
} from './services/inovaGuardApi';

// ---------------------------------------------------------------------------
// Helpers de mapeo servidor (snake_case + Date de mysql2) -> tipos del frontend
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

const toDateStr = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};

const toDateTimeStr = (v: unknown): string => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v as string | number);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}:${pad2(d.getSeconds())}`;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const mapClient = (row: ClientFullRow): ClientCredit => {
  const credit = row.credits?.[0];
  const dev = row.devices?.[0];
  const installments: Installment[] = (row.installments ?? [])
    .filter((ci) => ci.status !== 'CANCELADO')
    .map((ci) => ({
      id: String(ci.id),
      clientId: String(row.id),
      number: num(ci.installment_number),
      amount: num(ci.amount),
      dueDate: toDateStr(ci.due_date),
      status: (['PENDIENTE', 'VENCIDO', 'ATRASADO', 'PAGADO'].includes(ci.status)
        ? ci.status
        : 'PENDIENTE') as InstallmentStatus,
      penaltyAmount: num(ci.penalty_amount),
      totalAmount: num(ci.total_amount),
      paidAmount: num(ci.paid_amount) || undefined,
      paidDate: toDateStr(ci.paid_date) || undefined,
      paymentRef: ci.payment_reference || undefined,
    }));

  const device: MobileDevice = dev
    ? {
        id: String(dev.id),
        inovaguardId: dev.inovaguard_id || undefined,
        unlockCode: dev.unlock_code || undefined,
        deviceName: dev.device_name || undefined,
        brand: dev.brand || 'N/D',
        model: dev.model || 'N/D',
        imei: dev.imei || 'N/D',
        serialNumber: dev.serial_number || '',
        mdmStatus: (['UNLOCKED', 'LOCKED', 'PENDING_LOCK', 'PENDING_UNLOCK'].includes(
          dev.mdm_status
        )
          ? dev.mdm_status
          : 'UNLOCKED') as MdmStatus,
        lastMdmSync: dev.last_mdm_sync_note
          ? dev.last_mdm_sync_note
          : dev.last_mdm_sync_at
          ? `Sincronizado: ${toDateTimeStr(dev.last_mdm_sync_at)}`
          : 'Sin sincronización MDM',
        remoteLockSupported: !!dev.remote_lock_supported,
      }
    : {
        id: `DEV-${row.id}`,
        brand: '—',
        model: '—',
        imei: '—',
        serialNumber: '',
        mdmStatus: 'UNLOCKED' as MdmStatus,
        lastMdmSync: 'Sin dispositivo registrado',
        remoteLockSupported: false,
      };

  return {
    id: String(row.id),
    fullName: row.full_name,
    cedulaOrId: row.cedula_or_id || '—',
    phone: row.phone || '—',
    email: row.email || '',
    address: row.address || '',
    avatarUrl: row.avatar_url || undefined,
    creditStartDate: toDateStr(credit?.start_date),
    totalCreditAmount: num(credit?.total_amount),
    monthlyInstallmentAmount: num(credit?.monthly_amount),
    totalInstallmentsCount: num(credit?.installments_count) || installments.length,
    device,
    installments,
    notes: row.notes || undefined,
  };
};

const ACTION_MAP: Record<string, MdmApiLog['action']> = {
  LOCK: 'LOCK',
  UNLOCK: 'UNLOCK',
  UNLOCK_CODE: 'UNLOCK_CODE',
  REMOVE: 'REMOVE',
  PAYMENT_REC: 'PAYMENT_REC',
  SYNC_DEVICES: 'SYNC_DEVICES',
  STATUS_CHECK: 'STATUS_CHECK',
  LOGIN: 'LOGIN',
  BALANCE: 'BALANCE',
  QR_ENROLLMENT: 'QR_ENROLLMENT',
  CONFIG_UPDATE: 'CONFIG_UPDATE',
};

const TRIGGER_MAP: Record<string, MdmApiLog['trigger']> = {
  AUTOMATIC_PAYMENT: 'AUTOMATIC_PAYMENT',
  AUTOMATIC_OVERDUE: 'AUTOMATIC_OVERDUE',
  MANUAL: 'MANUAL_OPERATOR',
  SYSTEM_SYNC: 'SYSTEM_SYNC',
};

const mapEvent = (e: DeviceEventRow): MdmApiLog => ({
  id: String(e.id),
  timestamp: toDateTimeStr(e.created_at),
  clientId: e.client_id != null ? String(e.client_id) : '—',
  clientName: e.client_name || e.device_name || '—',
  imei: e.imei || '—',
  action: ACTION_MAP[e.action] ?? 'STATUS_CHECK',
  trigger: TRIGGER_MAP[e.trigger_source ?? ''] ?? 'MANUAL_OPERATOR',
  status: e.status === 'FAILED' ? 'FAILED' : e.status === 'SIMULATED' ? 'SIMULATED' : 'SUCCESS',
  details: e.details || '',
});

export default function App() {
  const confirmDialog = useConfirm();

  // Sesión y RBAC
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Empresas (tenants) — selector del Super Admin global
  const [tenants, setTenants] = useState<TenantRow[]>([]);

  // Datos del tenant (Fase 3: servidos por la API)
  const [clients, setClients] = useState<ClientCredit[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [mdmConfig, setMdmConfig] = useState<MdmApiConfig>(INITIAL_MDM_CONFIG);
  const [logs, setLogs] = useState<MdmApiLog[]>([]);

  // Estados de interfaz y modales
  const [activeTab, setActiveTab] = useState<MainViewTab>('CLIENTS');
  const [portalTab, setPortalTab] = useState<PortalTab>('OVERVIEW');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem('credipay-theme');
    return saved === 'dark';
  });

  const toggleDark = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      window.localStorage.setItem('credipay-theme', next ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO'
  >('ALL');
  const [autoEngineActive, setAutoEngineActive] = useState(true);
  const [selectedClientForInstallments, setSelectedClientForInstallments] =
    useState<ClientCredit | null>(null);
  const [selectedClientForAi, setSelectedClientForAi] = useState<ClientCredit | null>(null);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [isNewCreditModalOpen, setIsNewCreditModalOpen] = useState(false);
  const [pendingLoanDevice, setPendingLoanDevice] = useState<InovaGuardDeviceItem | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    client: ClientCredit | null;
    installmentId?: string;
  } | null>(null);

  // Toast / Banner de notificación para feedback de acciones
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

  const has = (perm: string) => session?.permissions.includes(perm) ?? false;

  const guard = (perm: string, fn: () => void) => () => {
    if (!has(perm)) {
      showNotification(`⛔ Acción denegada: falta el permiso "${perm}"`, 'LOCK');
      return;
    }
    fn();
  };

  // ---------------------------------------------------------------------------
  // Carga de datos desde la API
  // ---------------------------------------------------------------------------

  const reloadMdmConfig = useCallback(async () => {
    if (!has('mdm.config')) return;
    if (session?.activeTenantId === null) return;
    try {
      const res = await apiGetMdmConfig();
      setMdmConfig(res.data);
    } catch (err) {
      console.warn('No se pudo cargar la configuración MDM:', err);
    }
  }, [session]);

  const reloadClients = useCallback(async () => {
    if (session?.activeTenantId === null) return;
    setClientsLoading(true);
    try {
      const list = await apiListClients({ perPage: 200 });
      const full = await Promise.all(list.data.map((c) => apiGetClient(c.id)));
      const mapped = full.map((res) => mapClient(res.data));
      setClients(mapped);
      setSelectedClientForInstallments((prev) =>
        prev ? (mapped.find((c) => c.id === prev.id) ?? null) : null
      );
    } catch (err) {
      console.warn('No se pudieron cargar los clientes:', err);
    } finally {
      setClientsLoading(false);
    }
  }, [session]);

  const reloadLogs = useCallback(async () => {
    if (session?.activeTenantId === null) return;
    try {
      const res = await apiGetDeviceEvents({ perPage: 200 });
      setLogs(res.data.map(mapEvent));
    } catch (err) {
      console.warn('No se pudieron cargar los eventos MDM:', err);
    }
  }, [session]);

  const reloadAll = useCallback(async () => {
    await Promise.all([reloadMdmConfig(), reloadClients(), reloadLogs()]);
  }, [reloadMdmConfig, reloadClients, reloadLogs]);

  const reloadTenants = useCallback(async () => {
    try {
      const res = await apiListTenants();
      setTenants(res.data);
    } catch (err) {
      console.warn('No se pudieron cargar las empresas:', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // SaaS Comercial (Fase 5): suscripción, planes, pagos y plataforma
  // ---------------------------------------------------------------------------

  const [saasSubscription, setSaasSubscription] = useState<SubscriptionRow | null>(null);
  const [saasUsage, setSaasUsage] = useState<SubscriptionUsage>({
    clients: 0,
    credits: 0,
    devices: 0,
    users: 0,
  });
  const [saasPlans, setSaasPlans] = useState<PlanRow[]>([]);
  const [saasPayments, setSaasPayments] = useState<BillingPaymentRow[]>([]);
  const [saasGateways, setSaasGateways] = useState<GatewayRow[]>([]);
  const [saasPreferredGateway, setSaasPreferredGateway] = useState<string | null>(null);
  const [platformTenants, setPlatformTenants] = useState<PlatformTenantRow[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [tenantDetail, setTenantDetail] = useState<TenantDetailRow | null>(null);
  const [tenantModal, setTenantModal] = useState<{ mode: 'create' | 'edit'; id: number | null } | null>(null);
  const [planModal, setPlanModal] = useState<{ mode: 'create' | 'edit'; plan: PlanRow | null } | null>(null);
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummaryRow | null>(null);
  const [collectionReminders, setCollectionReminders] = useState<CollectionReminderRow[]>([]);
  const [collectionRuns, setCollectionRuns] = useState<CollectionRunRow[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);

  const reloadSaas = useCallback(async () => {
    if (!has('subscriptions.view') || session?.activeTenantId === null) return;
    try {
      const [sub, plans, payments, gateways] = await Promise.all([
        apiSubscriptionCurrent(),
        apiListPlans(),
        apiBillingPayments(),
        apiGetGateways(),
      ]);
      setSaasSubscription(sub.data.subscription);
      setSaasUsage(sub.data.usage);
      setSaasPlans(plans.data);
      setSaasPayments(payments.data);
      setSaasGateways(gateways.data.gateways);
      setSaasPreferredGateway(gateways.data.config.preferredGateway);
    } catch (err) {
      console.warn('No se pudo cargar la suscripción:', err);
    }
  }, [session]);

  const reloadPlatform = useCallback(async () => {
    if (!has('subscriptions.view') || !session?.isGlobal) return;
    setPlatformLoading(true);
    try {
      const res = await apiPlatformOverview();
      setPlatformTenants(res.data);
    } catch (err) {
      console.warn('No se pudo cargar el panel de plataforma:', err);
    } finally {
      setPlatformLoading(false);
    }
  }, [session]);

  const loadPortalPlans = useCallback(async () => {
    try {
      const res = await apiListPlans();
      setSaasPlans(res.data);
    } catch (err) {
      console.warn('No se pudieron cargar los planes de la plataforma:', err);
    }
  }, []);

  // Panel Super Admin: abrir edición de empresa (carga detalle completo)
  const handleEditTenant = useCallback(
    async (tenantId: number) => {
      try {
        const res = await apiGetTenantDetail(tenantId);
        setTenantDetail(res.data);
        setTenantModal({ mode: 'edit', id: tenantId });
      } catch (err) {
        showNotification(`❌ No se pudo cargar la empresa: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [showNotification]
  );

  const handleTenantSaved = useCallback(
    (message: string) => {
      showNotification(message, 'INFO');
      setTenantDetail(null);
      setTenantModal(null);
      void reloadTenants();
      void reloadPlatform();
    },
    [showNotification, reloadTenants, reloadPlatform]
  );

  const handlePlanSaved = useCallback(
    (message: string) => {
      showNotification(message, 'INFO');
      setPlanModal(null);
      void loadPortalPlans();
    },
    [showNotification, loadPortalPlans]
  );

  const handleTogglePlan = useCallback(
    async (plan: PlanRow) => {
      try {
        const res = await apiTogglePlan(plan.id);
        showNotification(
          `✅ Plan "${plan.name}" ${res.data.status === 'ACTIVE' ? 'activado' : 'desactivado'}.`,
          'INFO'
        );
        void loadPortalPlans();
      } catch (err) {
        showNotification(`❌ No se pudo cambiar el estado del plan: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [showNotification, loadPortalPlans]
  );

  const handleDuplicatePlan = useCallback(
    async (plan: PlanRow) => {
      try {
        const res = await apiDuplicatePlan(plan.id);
        showNotification(`✅ Plan duplicado como "${res.data.name}".`, 'INFO');
        void loadPortalPlans();
      } catch (err) {
        showNotification(`❌ No se pudo duplicar el plan: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [showNotification, loadPortalPlans]
  );

  const handleDeletePlan = useCallback(
    async (plan: PlanRow) => {
      const ok = await confirmDialog({
        title: `Eliminar plan "${plan.name}"`,
        message: 'Se eliminará del catálogo (soft delete). No se puede eliminar si está asignado a empresas activas.',
        tone: 'rose',
        confirmLabel: 'Eliminar plan',
      });
      if (!ok) return;
      try {
        await apiDeletePlan(plan.id);
        showNotification(`🗑️ Plan "${plan.name}" eliminado.`, 'INFO');
        void loadPortalPlans();
      } catch (err) {
        showNotification(`❌ No se pudo eliminar el plan: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [confirmDialog, showNotification, loadPortalPlans]
  );

  const handleNewTenant = useCallback(() => {
    setTenantDetail(null);
    setTenantModal({ mode: 'create', id: null });
  }, []);

  const handleNewPlan = useCallback(() => {
    setPlanModal({ mode: 'create', plan: null });
  }, []);

  const handleEditPlan = useCallback((plan: PlanRow) => {
    setPlanModal({ mode: 'edit', plan });
  }, []);

  const reloadCollection = useCallback(async () => {
    if (!has('collection.view') || session?.activeTenantId === null) return;
    try {
      const [summary, reminders, runs] = await Promise.all([
        apiCollectionSummary(),
        apiCollectionReminders('ALL', 100),
        apiCollectionRuns(),
      ]);
      setCollectionSummary(summary.data);
      setCollectionReminders(reminders.data);
      setCollectionRuns(runs.data);
    } catch (err) {
      console.warn('No se pudo cargar el motor de cobranza:', err);
    }
  }, [session]);

  const handleCollectionRun = useCallback(async () => {
    setCollectionLoading(true);
    try {
      const res = await apiCollectionRun('MANUAL');
      showNotification(
        `🤖 Motor de cobranza ejecutado: ${res.data.total} recordatorio(s) generados.`,
        'INFO'
      );
      await reloadCollection();
    } catch (err) {
      showNotification(`❌ No se pudo ejecutar el motor: ${errorMessage(err)}`, 'LOCK');
    } finally {
      setCollectionLoading(false);
    }
  }, [reloadCollection]);

  const handleCollectionSend = useCallback(
    async (id: number) => {
      try {
        const res = await apiCollectionSendReminder(id);
        showNotification(
          `💬 Recordatorio enviado a ${res.data.full_name} (${res.data.status}).`,
          'INFO'
        );
        await reloadCollection();
      } catch (err) {
        showNotification(`❌ No se pudo enviar: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [reloadCollection]
  );

  const handleCollectionRefresh = useCallback(() => {
    void reloadCollection();
  }, [reloadCollection]);

  const handleChangePlan = useCallback(
    async (planId: number) => {
      try {
        const res = await apiChangePlan(planId);
        showNotification(`✅ Plan actualizado: ${res.data.planName}.`, 'INFO');
        await reloadSaas();
      } catch (err) {
        showNotification(`❌ No se pudo cambiar el plan: ${errorMessage(err)}`, 'LOCK');
      }
    },
    [reloadSaas]
  );

  const handleRenewSubscription = useCallback(async () => {
    try {
      const res = await apiRenewSubscription();
      showNotification(
        `✅ Pago de renovación registrado para ${res.data.planName} (vigente hasta ${new Date(
          res.data.periodEnd
        ).toLocaleDateString('es-DO')}).`,
        'INFO'
      );
      await reloadSaas();
    } catch (err) {
      showNotification(`❌ No se pudo renovar: ${errorMessage(err)}`, 'LOCK');
    }
  }, [reloadSaas]);

  const handleSetGateway = useCallback(
    async (code: string | null) => {
      try {
        const res = await apiSetGateway(code);
        setSaasPreferredGateway(res.data.preferredGateway);
        showNotification(
          res.data.preferredGateway
            ? `✅ Pasarela preferida: ${res.data.preferredGateway}.`
            : 'Pasarela preferida limpiada.',
          'INFO'
        );
      } catch (err) {
        showNotification(`❌ No se pudo configurar la pasarela: ${errorMessage(err)}`, 'LOCK');
      }
    },
    []
  );

  const handleSelectTab = useCallback(
    (tab: MainViewTab) => {
      setActiveTab(tab);
      if (tab === 'LOGS') void reloadLogs();
      if (tab === 'BILLING') void reloadSaas();
      if (tab === 'COLLECTIONS') void reloadCollection();
    },
    [reloadLogs, reloadSaas, reloadCollection]
  );

  // AL ARRANCAR: validar la sesión existente (cookie httpOnly)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await apiFetchMe();
        if (!cancelled) setSession(s);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Al autenticarse: cargar configuración, cartera y auditoría
  useEffect(() => {
    if (!session) return;
    if (session.isGlobal) {
      void reloadTenants();
      void reloadPlatform();
      void loadPortalPlans();
    }
    if (session.activeTenantId === null) return;
    void reloadMdmConfig();
    void reloadClients();
    void reloadLogs();
    void reloadSaas();
    void reloadCollection();
  }, [session, reloadTenants, reloadPlatform, loadPortalPlans, reloadMdmConfig, reloadClients, reloadLogs, reloadSaas, reloadCollection]);

  // ---------------------------------------------------------------------------
  // Sesión
  // ---------------------------------------------------------------------------

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch (err) {
      console.warn('Error al cerrar sesión:', err);
    }
    setSession(null);
    setClients([]);
    setLogs([]);
    setTenants([]);
  };

  // CAMBIAR DE EMPRESA (Super Admin global) — el servidor actualiza la sesión
  const handleSwitchTenant = async (tenantId: number) => {
    await apiSwitchTenant(tenantId);
    setSession((prev) => (prev ? { ...prev, activeTenantId: tenantId } : prev));
    setActiveTab('CLIENTS');
    setPortalTab('OVERVIEW');
    await reloadAll();
  };

  // VOLVER A LA PLATAFORMA (Super Admin global) — limpia la empresa activa
  const handleExitTenant = async () => {
    try {
      await apiSwitchTenantExit();
      setSession((prev) => (prev ? { ...prev, activeTenantId: null } : prev));
      setActiveTab('CLIENTS');
      setPortalTab('OVERVIEW');
      await Promise.all([reloadTenants(), reloadPlatform(), loadPortalPlans()]);
      showNotification('🏢 De vuelta a la plataforma.', 'INFO');
    } catch (err) {
      showNotification(`❌ No se pudo volver a la plataforma: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // ---------------------------------------------------------------------------
  // ACCIÓN MDM: BLOQUEAR CELULAR
  // ---------------------------------------------------------------------------
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
        const res = await lockInovaGuardDevice(mdmConfig, target.device.inovaguardId);
        showNotification(
          `🔒 MDM ${res.isSimulated ? 'LOCK (SIMULADO)' : 'LOCK EJECUTADO'}: Celular ${target.device.model} de ${target.fullName} bloqueado.`,
          'LOCK'
        );
      } catch (err) {
        showNotification(`❌ Error en el bloqueo: ${errorMessage(err)}`, 'LOCK');
      }
    } else {
      showNotification(`⚠️ El dispositivo de ${target.fullName} no tiene ID InovaGuard.`, 'INFO');
    }
    await reloadClients();
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
        const res = await unlockInovaGuardDevice(mdmConfig, target.device.inovaguardId);
        showNotification(
          `🔓 MDM ${res.isSimulated ? 'UNLOCK (SIMULADO)' : 'UNLOCK EJECUTADO'}: Celular ${target.device.model} de ${target.fullName} desbloqueado.`,
          'UNLOCK'
        );
      } catch (err) {
        showNotification(`❌ Error en el desbloqueo: ${errorMessage(err)}`, 'LOCK');
      }
    } else {
      showNotification(`⚠️ El dispositivo de ${target.fullName} no tiene ID InovaGuard.`, 'INFO');
    }
    await reloadClients();
    void reloadLogs();
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

    if (!target.device.inovaguardId) {
      showNotification(`⚠️ El dispositivo de ${target.fullName} no tiene ID InovaGuard.`, 'INFO');
      return;
    }

    try {
      const res = await generateInovaGuardUnlockCode(mdmConfig, target.device.inovaguardId);
      if (res.code) {
        setClients((prev) =>
          prev.map((cli) =>
            cli.id === clientId
              ? {
                  ...cli,
                  device: {
                    ...cli.device,
                    lastUnlockCode: res.code,
                    lastMdmSync: `Código generado: ${res.code}`,
                  },
                }
              : cli
          )
        );
        showNotification(
          `🔑 CÓDIGO OFFLINE GENERADO (#${res.code}): Puedes dar este código al cliente para desbloqueo manual sin internet.`,
          'INFO'
        );
      } else {
        showNotification(`⚠️ ${res.message}`, 'INFO');
      }
    } catch (err) {
      showNotification(`❌ Error al generar el código: ${errorMessage(err)}`, 'LOCK');
    }
    await reloadClients();
    void reloadLogs();
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

    if (target.device.inovaguardId) {
      try {
        const res = await removeInovaGuardDevice(mdmConfig, target.device.inovaguardId);
        showNotification(
          `🗑️ DISPOSITIVO DESVINCULADO: ${res.isSimulated ? '(SIMULADO) ' : ''}El celular ${target.device.model} fue eliminado de la consola MDM.`,
          'INFO'
        );
      } catch (err) {
        showNotification(`❌ Error al desvincular: ${errorMessage(err)}`, 'LOCK');
      }
    } else {
      showNotification(`⚠️ El dispositivo de ${target.fullName} no tiene ID InovaGuard.`, 'INFO');
    }
    await reloadClients();
  };

  // ACCIÓN MDM: SYNC INVENTARIO INOVAGUARD (reconciliación server-side SYSTEM_SYNC)
  const handleSyncInovaGuard = async () => {
    showNotification('🔄 Sincronizando inventario InovaGuard con el servidor...', 'INFO');
    try {
      const res = await apiMdmSyncAll();
      const r = res.data;
      await reloadAll();
      showNotification(
        r.simulated
          ? `⚠️ SYNC SIMULADO: La API no respondió; se procesaron ${r.total} dispositivos demo (${r.created} creados, ${r.updated} actualizados). Revisa las credenciales en la configuración MDM.`
          : `✅ SYNC INVENTARIO COMPLETO: ${r.total} dispositivo(s) procesados, ${r.created} creados, ${r.updated} actualizados, ${r.matchedClients} vinculados a clientes.`,
        'INFO'
      );
    } catch (err) {
      showNotification(`❌ Error al sincronizar con InovaGuard: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // ACCIÓN: CHECK STATUS API (sync puntual del dispositivo)
  const handleCheckStatus = async (clientId: string) => {
    const cli = clients.find((c) => c.id === clientId);
    if (!cli) return;
    const devId = Number(cli.device.id);
    if (cli.device.inovaguardId && Number.isInteger(devId)) {
      try {
        const res = await apiSyncDevice(devId);
        await reloadClients();
        showNotification(
          res.data.isSimulated
            ? `⚠️ Status MDM (SIMULADO): ${cli.device.model} (IMEI: ${cli.device.imei}).`
            : `✅ Conexión API Externa OK: El dispositivo ${cli.device.model} (IMEI: ${cli.device.imei}) responde correctamente.`,
          'INFO'
        );
        return;
      } catch (err) {
        showNotification(`❌ Error al verificar el dispositivo: ${errorMessage(err)}`, 'LOCK');
        return;
      }
    }
    showNotification(
      `🌐 Conexión API Externa OK: El dispositivo ${cli.device.model} (IMEI: ${cli.device.imei}) responde correctamente.`,
      'INFO'
    );
  };

  // ---------------------------------------------------------------------------
  // REGISTRAR PAGO EN CASCADA (el servidor distribuye, desbloquea y audita)
  // ---------------------------------------------------------------------------
  const handleCascadePayment = async (payload: CascadePaymentPayload) => {
    try {
      const result = await apiCascadePayment({
        clientId: Number(payload.clientId),
        amount: payload.amountApplied,
        method: payload.method,
        bank: payload.bank,
        received: payload.received,
        change: payload.change,
      });
      await reloadAll();

      const d = result.data as {
        amountApplied?: number;
        change?: number;
        unlock?: { success?: boolean; simulated?: boolean; message?: string } | null;
      };
      const applied = d.amountApplied ?? payload.amountApplied;
      const change = d.change ?? payload.change;
      const fullyPaidNumbers = payload.affected
        .filter((a) => a.becamePaid)
        .map((a) => a.installment.number);
      const abonoNumbers = payload.affected
        .filter((a) => !a.becamePaid)
        .map((a) => a.installment.number);

      let msg = `💵 PAGO EN CASCADA REGISTRADO: RD$${applied.toLocaleString()} aplicados a ${payload.clientName}.`;
      if (fullyPaidNumbers.length > 0) {
        msg += ` Cuota${fullyPaidNumbers.length > 1 ? 's' : ''} ${fullyPaidNumbers
          .map((n) => `#${n}`)
          .join(', ')} pagada${fullyPaidNumbers.length > 1 ? 's' : ''}.`;
      }
      if (abonoNumbers.length > 0) {
        msg += ` Abono${abonoNumbers.length > 1 ? 's' : ''} en cuota${abonoNumbers.length > 1 ? 's' : ''} ${abonoNumbers
          .map((n) => `#${n}`)
          .join(', ')}.`;
      }
      if (change > 0) msg += ` Vuelto a entregar: RD$${change.toLocaleString()}.`;
      showNotification(msg, 'INFO');

      if (d.unlock?.success) {
        showNotification(
          `🎉 DESBLOQUEO AUTOMÁTICO: El celular de ${payload.clientName} fue desbloqueado por MDM al quedar al día con el pago en cascada.`,
          'UNLOCK'
        );
      }
    } catch (err) {
      showNotification(`❌ Error al registrar el pago: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // SIMULAR QUE UNA CUOTA SE ATRASA 3 DÍAS (persistido vía API)
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

    try {
      await apiPatchInstallment(Number(installmentId), {
        status: 'ATRASADO',
        penaltyAmount: 200,
      });
      let locked = false;
      if (
        mdmConfig.autoLockOnOverdue &&
        cli.device.mdmStatus !== 'LOCKED' &&
        cli.device.inovaguardId
      ) {
        try {
          const res = await lockInovaGuardDevice(mdmConfig, cli.device.inovaguardId);
          locked = !res.err;
        } catch {
          locked = false;
        }
      }
      await reloadAll();
      showNotification(
        `⚠️ CUOTA ATRASADA EN SIMULACIÓN: Mora fija de RD$200 aplicada a ${cli.fullName}${
          locked ? ' y BLOQUEO MDM automático enviado.' : '.'
        }`,
        'LOCK'
      );
    } catch (err) {
      showNotification(`❌ Error al simular el atraso: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // MOTOR AUTOMÁTICO: evaluar toda la cartera (PENDIENTE->VENCIDO->ATRASADO + lock)
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

    const DAY = 24 * 3600 * 1000;
    const patches: { id: number; status: string; penaltyAmount?: number }[] = [];
    const locks: { inovaguardId: string }[] = [];

    for (const cli of clients) {
      let needsLock = false;
      for (const inst of cli.installments) {
        const due = new Date(`${inst.dueDate}T00:00:00`).getTime();
        const diffDays = Math.floor((Date.now() - due) / DAY);

        if (inst.status !== 'PAGADO' && inst.status !== 'ATRASADO' && diffDays >= 3) {
          patches.push({ id: Number(inst.id), status: 'ATRASADO', penaltyAmount: 200 });
          needsLock = true;
        } else if (inst.status === 'PENDIENTE' && diffDays >= 0 && diffDays < 3) {
          patches.push({ id: Number(inst.id), status: 'VENCIDO' });
        }
      }
      if (
        needsLock &&
        cli.device.mdmStatus !== 'LOCKED' &&
        mdmConfig.autoLockOnOverdue &&
        cli.device.inovaguardId
      ) {
        locks.push({ inovaguardId: cli.device.inovaguardId });
      }
    }

    try {
      await Promise.all(
        patches.map((p) =>
          apiPatchInstallment(p.id, { status: p.status, penaltyAmount: p.penaltyAmount })
        )
      );
      let lockedCount = 0;
      for (const l of locks) {
        try {
          const res = await lockInovaGuardDevice(mdmConfig, l.inovaguardId);
          if (!res.err) lockedCount++;
        } catch {
          // falla individual no detiene el motor
        }
      }
      await reloadAll();
      if (lockedCount > 0 || patches.length > 0) {
        showNotification(
          `⚙️ MOTOR MDM EJECUTADO: ${patches.length} cuota(s) actualizada(s), ${lockedCount} dispositivo(s) bloqueado(s) automáticamente.`,
          lockedCount > 0 ? 'LOCK' : 'INFO'
        );
      } else {
        showNotification(
          `⚙️ MOTOR MDM EVALUADO: Todos los créditos verificados. No hubo nuevos atrasos mayores a 3 días.`,
          'INFO'
        );
      }
    } catch (err) {
      showNotification(`❌ Error del motor automático: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // SIMULADOR: ADELANTAR FECHAS DE VENCIMIENTO 3 DÍAS
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

    const patches: { id: number; status: string; penaltyAmount?: number }[] = [];
    const locks: { inovaguardId: string }[] = [];

    for (const cli of clients) {
      let hasOverdue = false;
      for (const inst of cli.installments) {
        if (inst.status === 'PAGADO') continue;
        if (inst.status === 'PENDIENTE') {
          patches.push({ id: Number(inst.id), status: 'VENCIDO' });
        } else if (inst.status === 'VENCIDO') {
          patches.push({ id: Number(inst.id), status: 'ATRASADO', penaltyAmount: 200 });
          hasOverdue = true;
        } else if (inst.status === 'ATRASADO') {
          hasOverdue = true;
        }
      }
      if (
        hasOverdue &&
        cli.device.mdmStatus !== 'LOCKED' &&
        mdmConfig.autoLockOnOverdue &&
        cli.device.inovaguardId
      ) {
        locks.push({ inovaguardId: cli.device.inovaguardId });
      }
    }

    try {
      await Promise.all(
        patches.map((p) =>
          apiPatchInstallment(p.id, { status: p.status, penaltyAmount: p.penaltyAmount })
        )
      );
      let lockedCount = 0;
      for (const l of locks) {
        try {
          const res = await lockInovaGuardDevice(mdmConfig, l.inovaguardId);
          if (!res.err) lockedCount++;
        } catch {
          // continúa con el resto
        }
      }
      await reloadAll();
      showNotification(
        `📅 SIMULACIÓN DE AVANCE EN TIEMPO (+3 DÍAS): Cuotas actualizadas (${patches.length}) y ${lockedCount} bloqueo(s) MDM automático(s) aplicados.`,
        lockedCount > 0 ? 'LOCK' : 'INFO'
      );
    } catch (err) {
      showNotification(`❌ Error en la simulación: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // ---------------------------------------------------------------------------
  // NUEVO CRÉDITO (cliente -> crédito -> dispositivo)
  // ---------------------------------------------------------------------------
  const handleCreateCredit = async (newClient: ClientCredit) => {
    try {
      const client = await apiCreateClient({
        fullName: newClient.fullName,
        cedulaOrId: newClient.cedulaOrId !== '—' ? newClient.cedulaOrId : undefined,
        phone: newClient.phone !== '—' ? newClient.phone : undefined,
        email: newClient.email,
        address: newClient.address,
        notes: newClient.notes,
      });
      await apiCreateCredit({
        clientId: client.data.id,
        totalAmount: newClient.totalCreditAmount,
        monthlyAmount: newClient.monthlyInstallmentAmount,
        installmentsCount: newClient.totalInstallmentsCount,
      });
      const dev = newClient.device;
      if (dev.imei && dev.imei !== '—') {
        await apiCreateDevice({
          clientId: client.data.id,
          brand: dev.brand,
          model: dev.model,
          imei: dev.imei,
          serialNumber: dev.serialNumber,
          inovaguardId: dev.inovaguardId,
          unlockCode: dev.unlockCode,
          deviceName: dev.deviceName,
          mdmStatus: 'UNLOCKED',
        });
      }
      setPendingLoanDevice(null);
      await reloadAll();
      showNotification(
        `✅ Nuevo crédito y celular ${dev.model} registrados para ${newClient.fullName}.`,
        'INFO'
      );
    } catch (err) {
      showNotification(`❌ Error al crear el crédito: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // ---------------------------------------------------------------------------
  // CONFIGURACIÓN MDM (se guarda en el servidor — los secretos no viven en el navegador)
  // ---------------------------------------------------------------------------
  const handleSaveMdmConfig = async (cfg: MdmApiConfig) => {
    try {
      const res = await apiPutMdmConfig(cfg);
      setMdmConfig(res.data);
      showNotification('✅ Configuración MDM guardada en el servidor.', 'INFO');
    } catch (err) {
      showNotification(`❌ Error al guardar la configuración MDM: ${errorMessage(err)}`, 'LOCK');
    }
  };

  // ---------------------------------------------------------------------------
  // Métricas del sistema
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-800 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 dark:text-slate-400">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onAuthenticated={(s) => setSession(s)} />;
  }

  const isPortalMode = session.isGlobal && session.activeTenantId === null;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-800 dark:bg-slate-950 text-slate-800 dark:text-slate-100 dark:text-slate-200 flex flex-col font-sans">
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
        mode={isPortalMode ? 'portal' : 'tenant'}
        onExitTenant={!isPortalMode && session.isGlobal ? handleExitTenant : undefined}
        onOpenNewCredit={guard('credits.create', () => setIsNewCreditModalOpen(true))}
        onOpenApiConfig={guard('mdm.config', () => setIsApiModalOpen(true))}
        autoEngineActive={autoEngineActive}
        onToggleAutoEngine={() => setAutoEngineActive(!autoEngineActive)}
        onRunEngineNow={guard('installments.edit', runAutoEngineNow)}
        mdmConfigEnabled={mdmConfig.enabled}
        onSyncInovaGuard={guard('devices.view', handleSyncInovaGuard)}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        userName={session.user.name}
        userEmail={session.user.email}
        onLogout={handleLogout}
        tenants={tenants}
        activeTenantId={session.activeTenantId}
        isGlobal={session.isGlobal}
        onSwitchTenant={handleSwitchTenant}
        onReloadTenants={reloadTenants}
        onOpenSecurity={() => setIsSecurityModalOpen(true)}
        dark={dark}
        onToggleDark={toggleDark}
      />

      {/* Contenedor Principal con Sidebar Lateral */}
      <div className="flex flex-1 w-full min-h-[calc(100vh-4rem)] relative">
        {isPortalMode ? (
          <PlatformSidebar
            activeTab={portalTab}
            onSelectTab={setPortalTab}
            onOpenSecurity={() => setIsSecurityModalOpen(true)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            isOpenMobile={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />
        ) : (
        <Sidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          clientsCount={clients.length}
          logsCount={logs.length}
          autoEngineActive={autoEngineActive}
          onToggleAutoEngine={() => setAutoEngineActive(!autoEngineActive)}
          onRunEngineNow={guard('installments.edit', runAutoEngineNow)}
          onOpenNewCredit={guard('credits.create', () => setIsNewCreditModalOpen(true))}
          onOpenApiConfig={guard('mdm.config', () => setIsApiModalOpen(true))}
          onSyncInovaGuard={guard('devices.view', handleSyncInovaGuard)}
          mdmConfigEnabled={mdmConfig.enabled}
          permissions={session.permissions}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isOpenMobile={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />
        )}

        {/* Contenido Principal según Pestaña Activa */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full overflow-x-hidden">
          {isPortalMode ? (
            <PlatformPortalView
              tab={portalTab}
              tenants={platformTenants}
              loading={platformLoading}
              plans={saasPlans}
              onReload={() => void reloadPlatform()}
              onReloadPlans={loadPortalPlans}
              onEnter={(id) => void handleSwitchTenant(id)}
              onEditTenant={(id) => void handleEditTenant(id)}
              onNewTenant={handleNewTenant}
              onNewPlan={handleNewPlan}
              onEditPlan={handleEditPlan}
              onTogglePlan={(p) => void handleTogglePlan(p)}
              onDuplicatePlan={(p) => void handleDuplicatePlan(p)}
              onDeletePlan={(p) => void handleDeletePlan(p)}
              onNotify={(text, type) => showNotification(text, type)}
            />
          ) : (
          <>
          {clientsLoading && clients.length === 0 && activeTab === 'CLIENTS' && (
            <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-500 dark:text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-600 mb-3" />
              <p className="text-sm font-medium">Cargando cartera de clientes desde el servidor...</p>
            </div>
          )}
          {activeTab === 'CLIENTS' && !(clientsLoading && clients.length === 0) && (
            <>
              <DashboardStats
                metrics={metrics}
                onSimulateDayPass={guard('installments.edit', handleSimulateDayPass)}
                onOpenInstallmentsFilter={(s) => setFilterStatus(s)}
              />

              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Cartera de Clientes & Control MDM de Celulares
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
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
              <div className="bg-white rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-4 gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Auditoría Completa de Órdenes MDM & Sincronizaciones InovaGuard
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Historial y traza inmutable de todos los comandos de bloqueo, mora, códigos offline y sync REST
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-full self-start sm:self-center">
                    {logs.length} Eventos Registrados
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-900/70">
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
                          <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {log.timestamp}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                            {log.clientName}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
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
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                              }`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 font-medium">
                            {log.trigger}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300 max-w-sm">
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

          {activeTab === 'BILLING' && session.activeTenantId !== null && (
            <SaaSAvView
              subscription={saasSubscription}
              usage={saasUsage}
              plans={saasPlans}
              payments={saasPayments}
              gateways={saasGateways}
              preferredGateway={saasPreferredGateway}
              permits={{
                manage: has('subscriptions.manage'),
                renew: has('billing.manage'),
              }}
              onChangePlan={handleChangePlan}
              onRenew={handleRenewSubscription}
              onSetGateway={handleSetGateway}
            />
          )}

          {activeTab === 'COLLECTIONS' && session.activeTenantId !== null && (
            <CollectionsView
              summary={collectionSummary}
              reminders={collectionReminders}
              runs={collectionRuns}
              loading={collectionLoading}
              permits={{
                run: has('collection.run'),
                send: has('collection.send'),
              }}
              onRun={handleCollectionRun}
              onSend={handleCollectionSend}
              onRefresh={handleCollectionRefresh}
            />
          )}
          </>
          )}
        </main>
      </div>

      {/* Pie de página */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-6 text-center text-xs">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-medium text-slate-300">
            CrediPay MDM • Sistema Integral de Préstamos para Celulares con Bloqueo MDM en Pesos Dominicanos
          </p>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
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
        onSaveConfig={handleSaveMdmConfig}
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
        onCreateCredit={handleCreateCredit}
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

      {isSecurityModalOpen && <SecurityModal onClose={() => setIsSecurityModalOpen(false)} />}

      {tenantModal && (
        <TenantFormModal
          isOpen
          tenant={tenantModal.mode === 'edit' ? tenantDetail : null}
          plans={saasPlans}
          onClose={() => {
            setTenantModal(null);
            setTenantDetail(null);
          }}
          onSaved={handleTenantSaved}
        />
      )}

      {planModal && (
        <PlanFormModal
          isOpen
          plan={planModal.plan}
          onClose={() => setPlanModal(null)}
          onSaved={handlePlanSaved}
        />
      )}
    </div>
  );
}
