import type { MdmConfig } from './tenantService.js';

/**
 * Servicio de integración con InovaGuard MDM API (proxy server-side, Fase 2).
 * Portado del cliente del frontend (src/services/inovaGuardApi.ts) para que
 * los secretos (appClient, secret, bearerToken) nunca viajen al navegador.
 * Base URL: https://dashboard.inovaguardapp.com/api/v1/customer
 * Documentación oficial (Postman):
 *   https://documenter.getpostman.com/view/49503810/2sBXcEkLjR
 */

export type InovaGuardStatus = 'LOCKED' | 'UNLOCKED';

// Mapeo del campo numérico `status` del API -> estado de la consola.
//   - 1 = activo / desbloqueado
//   - 2 = BLOQUEADO
//   - 3 = bloqueado (legado de la cuenta demo)
const STATUS_MAP: Record<number, InovaGuardStatus> = {
  1: 'UNLOCKED',
  2: 'LOCKED',
  3: 'LOCKED',
};

// Marcador oficial de "sin asignar / disponible para financiar" en owner_name
const STOCK_OWNER_MARKER = 'DISPONIBLE PARA FINANCIAR';

export interface InovaGuardDeviceItem {
  id: string;
  deviceName: string;
  brand: string;
  model: string;
  imei: string;
  status: InovaGuardStatus;
  lastSeen: string;
  assignedClientName?: string;
  assignedClientId?: string;
  unlockCode?: string;
  dueDate?: string;
  serie?: string;
  licenceType?: number;
  ownerPhone?: string;
  ownerEmail?: string;
  ownerAddress?: string;
}

export interface InovaGuardBalance {
  added: number;
  balance: number;
  demo: number;
  demo_used: number;
  basic: number;
  basic_used: number;
  business: number;
  business_used: number;
  enterprise: number;
  enterprise_used: number;
}

export interface InovaGuardLicence {
  name: string;
  type: number;
  availables: number;
}

export interface InovaGuardStandardResponse {
  err: boolean;
  message: string;
  code?: string;
  token?: string;
}

interface RawInovaDevice {
  id: number | string;
  imei?: string | null;
  licence_type?: number | null;
  code?: string | null;
  brand?: string | null;
  model?: string | null;
  serie?: string | null;
  status?: number | null;
  owner_identifier?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  owner_address?: string | null;
  due_date?: string | null;
}

function clean(value: string | number | null | undefined): string {
  if (value == null) return '';
  const v = String(value).trim();
  return v === '-' || v === '' ? '' : v;
}

function isAssignedOwner(ownerName: string | null | undefined): boolean {
  const name = clean(ownerName);
  if (!name) return false;
  return name.toUpperCase() !== STOCK_OWNER_MARKER;
}

function normalizeDevice(raw: RawInovaDevice): InovaGuardDeviceItem {
  const brand = clean(raw.brand);
  const model = clean(raw.model);
  const ownerName = clean(raw.owner_name);
  const assigned = isAssignedOwner(raw.owner_name);
  const baseName = [brand, model].filter(Boolean).join(' ') || `Dispositivo #${raw.id}`;

  return {
    id: String(raw.id),
    deviceName: assigned && ownerName ? `${baseName} - ${ownerName}` : baseName,
    brand: brand || 'Desconocido',
    model: model || 'N/D',
    imei: clean(raw.imei) || clean(raw.serie) || 'N/D',
    status: STATUS_MAP[Number(raw.status)] ?? 'UNLOCKED',
    lastSeen: clean(raw.due_date)
      ? new Date(`${raw.due_date}T00:00:00`).toISOString()
      : new Date().toISOString(),
    assignedClientName: assigned ? ownerName : undefined,
    assignedClientId: assigned ? clean(raw.owner_identifier) || undefined : undefined,
    unlockCode: clean(raw.code) || undefined,
    dueDate: clean(raw.due_date) || undefined,
    serie: clean(raw.serie) || undefined,
    licenceType: raw.licence_type != null ? Number(raw.licence_type) : undefined,
    ownerPhone: clean(raw.owner_phone) || undefined,
    ownerEmail: clean(raw.owner_email) || undefined,
    ownerAddress: clean(raw.owner_address) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Tokens Bearer por tenant (expiran; se renuevan con auto-login)
// ---------------------------------------------------------------------------
const tokens = new Map<number, string>();

async function loginRaw(tenantId: number, cfg: MdmConfig): Promise<string | null> {
  if (!cfg.enabled || !cfg.liveMode || !cfg.appClient) return null;
  try {
    const response = await fetch(
      `${cfg.baseUrl}${cfg.authLoginEndpoint || '/auth/login'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client: cfg.appClient, secret: cfg.secret }),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: string };
    return typeof data.token === 'string' && data.token ? data.token : null;
  } catch {
    return null;
  }
}

interface FetchResult<T> {
  data: T;
  isSimulated: boolean;
  error?: string;
}

async function fetchInovaGuard<T>(
  tenantId: number,
  cfg: MdmConfig,
  endpoint: string,
  options: RequestInit = {},
  fallbackData: T,
  allowAuthRetry = true
): Promise<FetchResult<T>> {
  const url = endpoint.startsWith('http') ? endpoint : `${cfg.baseUrl}${endpoint}`;

  // MDM desactivado o modo simulación -> no tocar la red
  if (!cfg.enabled || !cfg.liveMode) {
    return { data: fallbackData, isSimulated: true };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    const token = tokens.get(tenantId) || cfg.bearerToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let response = await fetch(url, { ...options, headers });

    // Token expirado -> auto-login y reintento único
    if ((response.status === 401 || response.status === 403) && allowAuthRetry) {
      const freshToken = await loginRaw(tenantId, cfg);
      if (freshToken) {
        tokens.set(tenantId, freshToken);
        invalidateInovaGuardCache(tenantId);
        response = await fetch(url, {
          ...options,
          headers: { ...headers, Authorization: `Bearer ${freshToken}` },
        });
      }
    }

    if (!response.ok) {
      return { data: fallbackData, isSimulated: true, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('image') || contentType.includes('octet-stream')) {
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        data: { bufferBase64: buf.toString('base64') } as unknown as T,
        isSimulated: false,
      };
    }

    const data = (await response.json()) as T;
    return { data, isSimulated: false };
  } catch (err) {
    return {
      data: fallbackData,
      isSimulated: true,
      error: err instanceof Error ? err.message : 'Error de conexión HTTP',
    };
  }
}

// ---------------------------------------------------------------------------
// Caché de la "fotografía" completa (devices + balance + licences) por tenant
// ---------------------------------------------------------------------------
interface InovaGuardSnapshot {
  devices: InovaGuardDeviceItem[];
  totalDevices: number;
  balance: InovaGuardBalance;
  licences: InovaGuardLicence[];
  isSimulated: boolean;
  fetchedAt: number;
}

const SNAPSHOT_TTL_MS = 60_000;

const snapshots = new Map<number, InovaGuardSnapshot>();
const dirty = new Set<number>();
const inFlight = new Map<number, Promise<InovaGuardSnapshot>>();

export function invalidateInovaGuardCache(tenantId: number): void {
  dirty.add(tenantId);
}

async function loadSnapshot(
  tenantId: number,
  cfg: MdmConfig,
  force: boolean
): Promise<InovaGuardSnapshot> {
  const cached = snapshots.get(tenantId);
  const isFresh = cached && Date.now() - cached.fetchedAt < SNAPSHOT_TTL_MS;
  if (!force && isFresh && !dirty.has(tenantId)) return cached!;

  if (!inFlight.has(tenantId)) {
    const promise = Promise.all([
      fetchDevicesList(tenantId, cfg),
      fetchBalanceList(tenantId, cfg),
      fetchLicencesList(tenantId, cfg),
    ]).then(([devRes, balRes, licRes]) => {
      const snapshot: InovaGuardSnapshot = {
        devices: devRes.devices,
        totalDevices: devRes.totalDevices,
        balance: balRes.balance,
        licences: licRes.licences,
        isSimulated: devRes.isSimulated || balRes.isSimulated || licRes.isSimulated,
        fetchedAt: Date.now(),
      };
      snapshots.set(tenantId, snapshot);
      dirty.delete(tenantId);
      return snapshot;
    });
    inFlight.set(tenantId, promise);
  }
  return inFlight.get(tenantId)!;
}

// ---------------------------------------------------------------------------
// Datos de respaldo simulados (idénticos a los del frontend demo)
// ---------------------------------------------------------------------------
function fallbackDevices(): InovaGuardDeviceItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: '3168',
      deviceName: 'S24-Carlos-Mendoza',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra 256GB',
      imei: '358921098234101',
      status: 'LOCKED',
      lastSeen: now,
      assignedClientName: 'Carlos Andrés Mendoza',
      assignedClientId: 'CLI-001',
    },
    {
      id: '4177',
      deviceName: 'iPhone15-Mariana-V',
      brand: 'Apple',
      model: 'iPhone 15 Pro 128GB',
      imei: '354891098234882',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Mariana Valenzuela Ortiz',
      assignedClientId: 'CLI-002',
    },
    {
      id: '5102',
      deviceName: 'Redmi-Rodolfo-Pena',
      brand: 'Xiaomi',
      model: 'Redmi Note 13 Pro+ 5G',
      imei: '868123069182374',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Rodolfo Peña Castro',
      assignedClientId: 'CLI-003',
    },
    {
      id: '2891',
      deviceName: 'Edge50-Yomaira-R',
      brand: 'Motorola',
      model: 'Edge 50 Pro 512GB',
      imei: '351928374650192',
      status: 'LOCKED',
      lastSeen: now,
      assignedClientName: 'Yomaira Rosario Jiménez',
      assignedClientId: 'CLI-004',
    },
    {
      id: '6019',
      deviceName: 'Tecno-Spark20-Nuevo',
      brand: 'Tecno',
      model: 'Spark 20 Pro+ 256GB',
      imei: '869102938475610',
      status: 'UNLOCKED',
      lastSeen: now,
      assignedClientName: 'Dispositivo Nuevo (En Stock InovaGuard)',
      assignedClientId: '',
    },
  ];
}

const FALLBACK_BALANCE: InovaGuardBalance = {
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

const FALLBACK_LICENCES: InovaGuardLicence[] = [
  { name: 'demo', type: 0, availables: 126 },
  { name: 'basic', type: 1, availables: 141 },
  { name: 'business', type: 2, availables: 0 },
  { name: 'enterprise', type: 3, availables: 0 },
  { name: 'iphone', type: 4, availables: 29 },
];

// ---------------------------------------------------------------------------
// Listar dispositivos (GET /devices) — paginado en el API real
// ---------------------------------------------------------------------------
async function fetchDevicesList(tenantId: number, cfg: MdmConfig): Promise<{
  devices: InovaGuardDeviceItem[];
  isSimulated: boolean;
  totalDevices: number;
}> {
  const collected: InovaGuardDeviceItem[] = [];
  let isSimulated = false;
  let nextUrl: string | null = `${cfg.baseUrl}${cfg.devicesEndpoint || '/devices'}?per_page=100`;

  for (let page = 0; nextUrl && page < 50; page++) {
    const res: FetchResult<{
      data?: RawInovaDevice[];
      next_page_url?: string | null;
    }> = await fetchInovaGuard(
      tenantId,
      cfg,
      nextUrl,
      { method: 'GET' },
      { data: [] },
      true
    );

    if (res.isSimulated) isSimulated = true;

    const payload = res.data;
    if (Array.isArray(payload)) {
      payload.forEach((raw: RawInovaDevice) => collected.push(normalizeDevice(raw)));
      break;
    }
    const items = Array.isArray(payload?.data) ? payload.data : [];
    items.forEach((raw: RawInovaDevice) => collected.push(normalizeDevice(raw)));
    nextUrl = payload?.next_page_url || null;
    if (!items.length) break;
  }

  // Si el API no respondió nada real, devolver los datos demo de respaldo
  if (collected.length === 0) {
    return { devices: fallbackDevices(), isSimulated: true, totalDevices: 5 };
  }

  const seen = new Set<string>();
  const devices = collected.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  return { devices, isSimulated, totalDevices: devices.length };
}

async function fetchBalanceList(tenantId: number, cfg: MdmConfig): Promise<{
  balance: InovaGuardBalance;
  isSimulated: boolean;
}> {
  const res = await fetchInovaGuard<Partial<InovaGuardBalance>>(
    tenantId,
    cfg,
    cfg.balanceEndpoint || '/balance',
    { method: 'GET' },
    FALLBACK_BALANCE
  );

  const b = res.data;
  const balance: InovaGuardBalance = {
    added: Number(b.added) || 0,
    balance: Number(b.balance) || 0,
    demo: Number(b.demo) || 0,
    demo_used: Number(b.demo_used) || 0,
    basic: Number(b.basic) || 0,
    basic_used: Number(b.basic_used) || 0,
    business: Number(b.business) || 0,
    business_used: Number(b.business_used) || 0,
    enterprise: Number(b.enterprise) || 0,
    enterprise_used: Number(b.enterprise_used) || 0,
  };

  return { balance, isSimulated: res.isSimulated };
}

async function fetchLicencesList(tenantId: number, cfg: MdmConfig): Promise<{
  licences: InovaGuardLicence[];
  isSimulated: boolean;
}> {
  const res = await fetchInovaGuard<InovaGuardLicence[]>(
    tenantId,
    cfg,
    '/licences',
    { method: 'GET' },
    FALLBACK_LICENCES
  );
  const licences = Array.isArray(res.data) && res.data.length ? res.data : FALLBACK_LICENCES;
  return { licences, isSimulated: res.isSimulated };
}

// ---------------------------------------------------------------------------
// Getters públicos con caché compartida
// ---------------------------------------------------------------------------
export async function getInovaGuardDevices(
  tenantId: number,
  cfg: MdmConfig,
  options?: { force?: boolean }
): Promise<{
  devices: InovaGuardDeviceItem[];
  isSimulated: boolean;
  totalDevices: number;
}> {
  const snapshot = await loadSnapshot(tenantId, cfg, !!options?.force);
  return {
    devices: snapshot.devices,
    isSimulated: snapshot.isSimulated,
    totalDevices: snapshot.totalDevices,
  };
}

export async function getInovaGuardBalance(
  tenantId: number,
  cfg: MdmConfig,
  options?: { force?: boolean }
): Promise<{ balance: InovaGuardBalance; isSimulated: boolean }> {
  const snapshot = await loadSnapshot(tenantId, cfg, !!options?.force);
  return { balance: snapshot.balance, isSimulated: snapshot.isSimulated };
}

export async function getInovaGuardLicences(
  tenantId: number,
  cfg: MdmConfig,
  options?: { force?: boolean }
): Promise<{ licences: InovaGuardLicence[]; isSimulated: boolean }> {
  const snapshot = await loadSnapshot(tenantId, cfg, !!options?.force);
  return { licences: snapshot.licences, isSimulated: snapshot.isSimulated };
}

// ---------------------------------------------------------------------------
// Comandos (mutaciones)
// ---------------------------------------------------------------------------
function commandUrl(cfg: MdmConfig, endpoint: string, id: string): string {
  return `${cfg.baseUrl}${endpoint.replace('{id}', encodeURIComponent(id))}`;
}

export async function findInovaGuardDevice(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ device: InovaGuardDeviceItem | null; isSimulated: boolean }> {
  const fallbackItem: InovaGuardDeviceItem = {
    id,
    deviceName: `InovaGuard-Device-#${id}`,
    brand: 'Samsung',
    model: 'Galaxy A55 5G',
    imei: '359182736451092',
    status: 'UNLOCKED',
    lastSeen: new Date().toISOString(),
  };
  const res = await fetchInovaGuard<{ err?: boolean; data?: RawInovaDevice }>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.statusEndpoint || '/devices/find/{id}', id),
    { method: 'GET' },
    { err: true, data: undefined },
    true
  );
  const raw = res.data?.data;
  if (res.isSimulated || !raw) return { device: fallbackItem, isSimulated: res.isSimulated };
  return { device: normalizeDevice(raw), isSimulated: false };
}

export async function lockInovaGuardDevice(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: 'Dispositivo bloqueado exitosamente mediante orden MDM InovaGuard.',
  };
  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.lockEndpoint || '/devices/lock/{id}', id),
    { method: 'GET' },
    fallbackResponse
  );
  if (!res.isSimulated) invalidateInovaGuardCache(tenantId);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de BLOQUEO ejecutado',
    isSimulated: res.isSimulated,
  };
}

export async function unlockInovaGuardDevice(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: 'Dispositivo desbloqueado exitosamente tras el pago. Acceso restaurado.',
  };
  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.unlockEndpoint || '/devices/unlock/{id}', id),
    { method: 'GET' },
    fallbackResponse
  );
  if (!res.isSimulated) invalidateInovaGuardCache(tenantId);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de DESBLOQUEO ejecutado',
    isSimulated: res.isSimulated,
  };
}

export async function generateInovaGuardUnlockCode(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ err: boolean; message: string; code?: string; isSimulated: boolean }> {
  const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: 'Código de desbloqueo temporal generado por InovaGuard.',
    code: randomCode,
  };

  const nextLock = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextLockDate = `${nextLock.getFullYear()}-${pad(nextLock.getMonth() + 1)}-${pad(
    nextLock.getDate()
  )}T${pad(nextLock.getHours())}:${pad(nextLock.getMinutes())}`;

  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.unlockCodeEndpoint || '/devices/unlock-code/{id}', id),
    { method: 'POST', body: JSON.stringify({ next_lock_date: nextLockDate }) },
    fallbackResponse
  );

  if (!res.isSimulated) invalidateInovaGuardCache(tenantId);

  return {
    err: !!res.data.err,
    message: res.data.message || 'Código generado',
    code: res.data.code || randomCode,
    isSimulated: res.isSimulated,
  };
}

export async function removeInovaGuardDevice(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: 'Dispositivo desvinculado y removido de la plataforma InovaGuard.',
  };
  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.removeEndpoint || '/devices/remove/{id}', id),
    { method: 'GET' },
    fallbackResponse
  );
  if (!res.isSimulated) invalidateInovaGuardCache(tenantId);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Dispositivo removido de InovaGuard',
    isSimulated: res.isSimulated,
  };
}

export async function getInovaGuardQrEnrollment(
  tenantId: number,
  cfg: MdmConfig
): Promise<{ qrDataUrl: string; enrollmentToken: string; isSimulated: boolean }> {
  const fallbackData = {
    qrDataUrl:
      'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=INOVAGUARD-ENROLL-CLIENT-D13CB763',
    enrollmentToken: 'ENROLL-D13C-B763-1998',
  };

  const res = await fetchInovaGuard<
    { bufferBase64?: string } | { qrUrl?: string; enrollmentToken?: string }
  >(
    tenantId,
    cfg,
    cfg.qrEndpoint || '/devices/qr-enrollment',
    { method: 'GET' },
    fallbackData
  );

  if (res.isSimulated) return { ...fallbackData, isSimulated: true };

  const data = res.data as { bufferBase64?: string; qrUrl?: string; enrollmentToken?: string };
  if (data.bufferBase64) {
    return {
      qrDataUrl: `data:image/png;base64,${data.bufferBase64}`,
      enrollmentToken: `ENROLL-${cfg.appClient.slice(0, 8).toUpperCase()}`,
      isSimulated: false,
    };
  }
  return {
    qrDataUrl: data.qrUrl || fallbackData.qrDataUrl,
    enrollmentToken: data.enrollmentToken || fallbackData.enrollmentToken,
    isSimulated: false,
  };
}
