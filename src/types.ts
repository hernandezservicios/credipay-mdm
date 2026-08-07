export type InstallmentStatus = 'PENDIENTE' | 'VENCIDO' | 'ATRASADO' | 'PAGADO';

export type MdmStatus = 'UNLOCKED' | 'LOCKED' | 'PENDING_LOCK' | 'PENDING_UNLOCK';

export interface Installment {
  id: string;
  clientId: string;
  number: number;           // Cuota #1, #2, etc.
  amount: number;           // Monto base de la cuota en pesos
  dueDate: string;          // Fecha de vencimiento (YYYY-MM-DD)
  status: InstallmentStatus;
  penaltyAmount: number;    // 0 o 200 pesos si está ATRASADO (3+ días)
  totalAmount: number;      // amount + penaltyAmount
  paidAmount?: number;      // Abono acumulado en pagos en cascada (parcial)
  paidDate?: string;        // Fecha en que se pagó
  paymentRef?: string;
}

export interface MobileDevice {
  id: string;
  inovaguardId?: string;    // ID interno de InovaGuard (oculto en la UI, ej. "4177")
  unlockCode?: string;      // Código de enrolamiento visible en la plataforma (ej. "735208")
  deviceName?: string;      // Nombre descriptivo del dispositivo en MDM (ej. "S24-Carlos-Mendoza")
  brand: string;
  model: string;
  imei: string;
  serialNumber: string;
  mdmStatus: MdmStatus;
  lastMdmSync: string;
  remoteLockSupported: boolean;
  lastUnlockCode?: string;  // Código offline generado (ej. "53645")
}

export interface ClientCredit {
  id: string;
  fullName: string;
  cedulaOrId: string;
  phone: string;
  email: string;
  address: string;
  avatarUrl?: string;
  creditStartDate: string;
  totalCreditAmount: number;
  monthlyInstallmentAmount: number;
  totalInstallmentsCount: number;
  device: MobileDevice;
  installments: Installment[];
  notes?: string;
}

export interface MdmApiConfig {
  provider: 'INOVAGUARD' | 'GENERIC';
  baseUrl: string;
  apiKey: string;
  appClient: string;        // InovaGuard app client (formato UUID)
  secret: string;           // InovaGuard secret (nunca valores reales en el repo)
  bearerToken: string;      // Token autenticado vía /auth/login
  authLoginEndpoint: string;
  devicesEndpoint: string;
  lockEndpoint: string;     // /devices/lock/{id}
  unlockEndpoint: string;   // /devices/unlock/{id}
  unlockCodeEndpoint: string; // /devices/unlock-code/{id}
  removeEndpoint: string;   // /devices/remove/{id}
  qrEndpoint: string;       // /devices/qr-enrollment
  balanceEndpoint: string;  // /balance
  statusEndpoint: string;
  enabled: boolean;
  autoLockOnOverdue: boolean; // Automático al pasar 3 días (ATRASADO)
  autoUnlockOnPaid: boolean;  // Automático al pagar cuota
  liveMode: boolean;          // Intentar HTTP real con fallback de simulación PRO
}

export interface MdmApiLog {
  id: string;
  timestamp: string;
  clientId: string;
  clientName: string;
  imei: string;
  action: 'LOCK' | 'UNLOCK' | 'STATUS_CHECK' | 'UNLOCK_CODE' | 'REMOVE' | 'SYNC_DEVICES' | 'LOGIN' | 'BALANCE' | 'QR_ENROLLMENT' | 'CONFIG_UPDATE' | 'PAYMENT_REC';
  trigger: 'AUTOMATIC_OVERDUE' | 'AUTOMATIC_PAYMENT' | 'MANUAL_OPERATOR' | 'SYSTEM_SYNC';
  status: 'SUCCESS' | 'FAILED' | 'SIMULATED';
  details: string;
}

export interface SystemMetrics {
  totalClients: number;
  activeCredits: number;
  lockedDevicesCount: number;
  overdueCount: number;
  totalCollectedThisMonth: number;
  pendingCollection: number;
}

// Interfaz para balance de InovaGuard API
export interface InovaGuardBalance {
  added: number;             // Total de licencias agregadas a la cuenta
  balance: number;           // Licencias disponibles para usar
  demo: number;
  demo_used: number;
  basic: number;
  basic_used: number;
  business: number;
  business_used: number;
  enterprise: number;
  enterprise_used: number;
}

// Disponibilidad de licencias por tipo de plan (GET /licences)
export interface InovaGuardLicence {
  name: string;              // demo | basic | business | enterprise | iphone
  type: number;              // 0 | 1 | 2 | 3 | 4
  availables: number;
}

// Interfaz para dispositivos entrantes de InovaGuard API (GET /devices)
export interface InovaGuardDeviceItem {
  id: string;               // e.g. "4177" or "3168"
  deviceName: string;
  brand: string;
  model: string;
  imei: string;
  status: 'LOCKED' | 'UNLOCKED';
  lastSeen: string;
  assignedClientName?: string;
  assignedClientId?: string;
  unlockCode?: string;      // Campo "code" del API: PIN temporal de desbloqueo
  dueDate?: string;         // Campo "due_date": vencimiento de licencia/plan
  serie?: string;           // Número de serie físico del equipo
  licenceType?: number;     // 0=demo, 1=basic, 2=business, 3=enterprise, 4=iphone
  ownerPhone?: string;
  ownerEmail?: string;
  ownerAddress?: string;
}

// Interfaz de respuesta estándar JSON de InovaGuard
export interface InovaGuardStandardResponse {
  err: boolean;
  message: string;
  code?: string;            // Para unlock-code
  token?: string;           // Para auth login
}

