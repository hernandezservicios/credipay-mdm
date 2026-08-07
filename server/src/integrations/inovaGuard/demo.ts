import type {
  InovaGuardBalance,
  InovaGuardDeviceItem,
  InovaGuardLicence,
  InovaGuardStandardResponse,
} from './types.js';

/**
 * Datos de respaldo simulados (identicos a los del frontend demo).
 * Solo se utilizan cuando la integracion esta en modo demo (mdm desactivado
 * o liveMode=false). En modo PRODUCCION no hay fallback (Fase C lo garantiza).
 */
export function fallbackDevices(): InovaGuardDeviceItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'DEMO-DEVICE-000001',
      deviceName: 'S24-Carlos-Mendoza',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra 256GB',
      imei: 'DEMO-IMEI-000001',
      status: 'LOCKED',
      lastSeen: now,
      assignedClientName: 'Carlos Andrés Mendoza',
      assignedClientId: 'CLI-001',
    },
    {
      id: 'DEMO-DEVICE-000002',
      deviceName: 'iPhone15-Mariana-V',
      brand: 'Apple',
      model: 'iPhone 15 Pro 128GB',
      imei: 'DEMO-IMEI-000002',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Mariana Valenzuela Ortiz',
      assignedClientId: 'CLI-002',
    },
    {
      id: 'DEMO-DEVICE-000003',
      deviceName: 'Redmi-Rodolfo-Pena',
      brand: 'Xiaomi',
      model: 'Redmi Note 13 Pro+ 5G',
      imei: 'DEMO-IMEI-000003',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Rodolfo Peña Castro',
      assignedClientId: 'CLI-003',
    },
    {
      id: 'DEMO-DEVICE-000004',
      deviceName: 'Edge50-Yomaira-R',
      brand: 'Motorola',
      model: 'Edge 50 Pro 512GB',
      imei: 'DEMO-IMEI-000004',
      status: 'LOCKED',
      lastSeen: now,
      assignedClientName: 'Yomaira Rosario Jiménez',
      assignedClientId: 'CLI-004',
    },
    {
      id: 'DEMO-DEVICE-000005',
      deviceName: 'Tecno-Spark20-Nuevo',
      brand: 'Tecno',
      model: 'Spark 20 Pro+ 256GB',
      imei: 'DEMO-IMEI-000005',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Dispositivo Nuevo (En Stock InovaGuard)',
      assignedClientId: '',
    },
  ];
}

export const FALLBACK_BALANCE: InovaGuardBalance = {
  added: 100,
  balance: 58,
  demo: 50,
  demo_used: 24,
  basic: 50,
  basic_used: 18,
  business: 0,
  business_used: 0,
  enterprise: 0,
  enterprise_used: 0,
};

export const FALLBACK_LICENCES: InovaGuardLicence[] = [
  { name: 'demo', type: 0, availables: 126 },
  { name: 'basic', type: 1, availables: 141 },
  { name: 'business', type: 2, availables: 0 },
  { name: 'enterprise', type: 3, availables: 0 },
  { name: 'iphone', type: 4, availables: 29 },
];

export function fallbackStandardResponse(message: string): InovaGuardStandardResponse {
  return { err: false, message };
}

export function fallbackDeviceItem(id: string): InovaGuardDeviceItem {
  return {
    id,
    deviceName: `InovaGuard-Device-#${id}`,
    brand: 'Samsung',
    model: 'Galaxy A55 5G',
    imei: 'DEMO-IMEI-000006',
    status: 'UNLOCKED',
    lastSeen: new Date().toISOString(),
  };
}

export function fallbackUnlockCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const FALLBACK_QR = {
  qrDataUrl:
    'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=INOVAGUARD-ENROLL-CLIENT-TEST-APP-CLIENT',
  enrollmentToken: 'ENROLL-TEST-APP-CLIENT',
};

export function nextLockDate(plusHours = 24): string {
  const nextLock = new Date(Date.now() + plusHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${nextLock.getFullYear()}-${pad(nextLock.getMonth() + 1)}-${pad(nextLock.getDate())}T${pad(
    nextLock.getHours()
  )}:${pad(nextLock.getMinutes())}`;
}