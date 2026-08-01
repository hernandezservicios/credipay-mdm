import {
  MdmApiConfig,
  InovaGuardDeviceItem,
  InovaGuardBalance,
  InovaGuardLicence,
  InovaGuardStandardResponse,
} from '../types';

/**
 * Servicio de integración con InovaGuard MDM API
 * Base URL: https://dashboard.inovaguardapp.com/api/v1/customer
 * Documentación oficial (Postman):
 *   https://documenter.getpostman.com/view/49503810/2sBXcEkLjR
 *
 * NOTA: El API real devuelve respuestas PAGINADAS en /devices y campos
 * numéricos/planos. Este servicio normaliza todo a los tipos de la consola.
 */

// ---------------------------------------------------------------------------
// Mapeo del campo numérico `status` del API -> estado de la consola.
// Verificado con datos REALES de la cuenta (login fresco, 126 dispositivos):
//   - 1 = activo / desbloqueado (find devuelve locked=0/null)
//   - 2 = BLOQUEADO (find devuelve locked=1; los 7-8 dispositivos status=2
//         de la cuenta real tienen locked=1 en /devices/find/{id})
//   - 3 = bloqueado (legado de la cuenta demo; se conserva por seguridad)
// ---------------------------------------------------------------------------
const STATUS_MAP: Record<number, 'LOCKED' | 'UNLOCKED'> = {
  1: 'UNLOCKED',
  2: 'LOCKED',
  3: 'LOCKED',
};

// Marcador oficial de "sin asignar / disponible para financiar" en owner_name
const STOCK_OWNER_MARKER = 'DISPONIBLE PARA FINANCIAR';

// Token fresco obtenido por auto-login (los tokens Bearer expiran)
let cachedBearerToken: string | null = null;

// ---------------------------------------------------------------------------
// Caché en memoria de la "fotografía" completa (devices + balance + licences).
// Las lecturas reutilizan la caché (la vista entra sin recargar); cualquier
// acción mutadora o login la invalida para que la siguiente carga sea fresca.
// ---------------------------------------------------------------------------
interface InovaGuardSnapshot {
  devices: InovaGuardDeviceItem[];
  totalDevices: number;
  balance: InovaGuardBalance;
  licences: InovaGuardLicence[];
  isSimulated: boolean;
  fetchedAt: number;
}

let cachedSnapshot: InovaGuardSnapshot | null = null;
let snapshotDirty = true; // arranca sucio para forzar la primera carga real
let snapshotInFlight: Promise<InovaGuardSnapshot> | null = null;

// Caché persistente: la precarga sobrevive a recargas de página (F5)
const SNAPSHOT_STORAGE_KEY = 'credipay-mdm-inovaguard-snapshot';

function hydrateSnapshotFromStorage(): void {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as InovaGuardSnapshot;
      if (parsed && Array.isArray(parsed.devices) && parsed.balance && parsed.licences) {
        cachedSnapshot = parsed;
        snapshotDirty = true; // hidratado -> primer refresh silencioso consulta la red
      }
    }
  } catch {
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
  }
}

hydrateSnapshotFromStorage();

/** Marca la caché como obsoleta (debe llamarse tras acciones mutadoras). */
export function invalidateInovaGuardCache(): void {
  snapshotDirty = true;
}

/** Devuelve la fotografía cacheada si existe (lectura síncrona para render instantáneo). */
export function getInovaGuardCachedData(): {
  devices: InovaGuardDeviceItem[];
  totalDevices: number;
  balance: InovaGuardBalance;
  licences: InovaGuardLicence[];
  isSimulated: boolean;
} | null {
  if (!cachedSnapshot) return null;
  return {
    devices: cachedSnapshot.devices,
    totalDevices: cachedSnapshot.totalDevices,
    balance: cachedSnapshot.balance,
    licences: cachedSnapshot.licences,
    isSimulated: cachedSnapshot.isSimulated,
  };
}

/** Carga (o reutiliza) la fotografía completa compartida entre los getters. */
async function loadSnapshot(
  config: MdmApiConfig,
  force: boolean
): Promise<InovaGuardSnapshot> {
  if (!force && !snapshotDirty && cachedSnapshot) {
    return cachedSnapshot;
  }
  if (!snapshotInFlight) {
    snapshotInFlight = Promise.all([
      fetchDevicesList(config),
      fetchBalanceList(config),
      fetchLicencesList(config),
    ])
      .then(([devRes, balRes, licRes]) => {
        cachedSnapshot = {
          devices: devRes.devices,
          totalDevices: devRes.totalDevices,
          balance: balRes.balance,
          licences: licRes.licences,
          isSimulated:
            devRes.isSimulated || balRes.isSimulated || licRes.isSimulated,
          fetchedAt: Date.now(),
        };
        snapshotDirty = false;
        try {
          localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(cachedSnapshot));
        } catch {
          // almacenamiento lleno o bloqueado -> la caché sigue en memoria
        }
        return cachedSnapshot;
      })
      .finally(() => {
        snapshotInFlight = null;
      });
  }
  return snapshotInFlight;
}

// ---------------------------------------------------------------------------
// Helpers de normalización
// ---------------------------------------------------------------------------

// Limpia valores "-" / vacíos / nulos que devuelve el API
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
// Login real (POST /auth/login) y cache del token
// ---------------------------------------------------------------------------

async function loginRaw(config: MdmApiConfig): Promise<string | null> {
  try {
    const response = await fetch(
      `${config.baseUrl}${config.authLoginEndpoint || '/auth/login'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client: config.appClient, secret: config.secret }),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.token === 'string' && data.token ? data.token : null;
  } catch (err) {
    console.warn('[InovaGuard API] Error en /auth/login:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper de peticiones autenticadas con reintento ante 401/403 y fallback
// simulado confiable
// ---------------------------------------------------------------------------

interface FetchResult<T> {
  data: T;
  isSimulated: boolean;
  error?: string;
}

async function fetchInovaGuard<T>(
  endpointOrUrl: string,
  config: MdmApiConfig,
  options: RequestInit = {},
  fallbackData: T,
  allowAuthRetry = true
): Promise<FetchResult<T>> {
  const url = endpointOrUrl.startsWith('http')
    ? endpointOrUrl
    : `${config.baseUrl}${endpointOrUrl}`;

  // Si el MDM está desactivado, retornar simulación directa
  if (!config.enabled) {
    return { data: fallbackData, isSimulated: true };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    const token = cachedBearerToken || config.bearerToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let response = await fetch(url, { ...options, headers });

    // Token expirado -> auto-login y reintento único
    if ((response.status === 401 || response.status === 403) && allowAuthRetry) {
      const freshToken = await loginRaw(config);
      if (freshToken) {
        cachedBearerToken = freshToken;
        snapshotDirty = true; // token nuevo -> los datos cacheados pueden estar obsoletos
        response = await fetch(url, {
          ...options,
          headers: { ...headers, Authorization: `Bearer ${freshToken}` },
        });
      }
    }

    if (!response.ok) {
      console.warn(
        `[InovaGuard API] HTTP ${response.status} en ${url}. Usando simulación de respaldo.`
      );
      return { data: fallbackData, isSimulated: true, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('image') || contentType.includes('octet-stream')) {
      const blob = await response.blob();
      return { data: blob as unknown as T, isSimulated: false };
    }

    const data = await response.json();
    return { data: data as T, isSimulated: false };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error de conexión HTTP';
    console.warn(
      `[InovaGuard API] Fallo de red en ${url}: ${errorMsg}. Ejecutando simulación local.`
    );
    return { data: fallbackData, isSimulated: true, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Autenticación pública (para el modal de configuración)
// ---------------------------------------------------------------------------

export async function loginInovaGuard(config: MdmApiConfig): Promise<{
  token: string;
  err: boolean;
  message: string;
  isSimulated: boolean;
}> {
  const fresh = await loginRaw(config);
  if (fresh) {
    cachedBearerToken = fresh;
    snapshotDirty = true; // token renovado -> forzar recarga de datos reales
    return {
      token: fresh,
      err: false,
      message: 'Autenticado exitosamente con token InovaGuard Bearer',
      isSimulated: false,
    };
  }
  return {
    token: config.bearerToken,
    err: true,
    message: 'No se pudo renovar el token; usando el token existente de la configuración',
    isSimulated: true,
  };
}

// ---------------------------------------------------------------------------
// Listar dispositivos (GET /devices) — paginado en el API real
// Fetcher interno; el getter público usa la caché compartida.
// ---------------------------------------------------------------------------

async function fetchDevicesList(config: MdmApiConfig): Promise<{
  devices: InovaGuardDeviceItem[];
  isSimulated: boolean;
  totalDevices: number;
}> {
  const now = new Date().toISOString();
  const fallbackDevices: InovaGuardDeviceItem[] = [
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

  const collected: InovaGuardDeviceItem[] = [];
  let isSimulated = false;
  let nextUrl: string | null = `${config.baseUrl}${
    config.devicesEndpoint || '/devices'
  }?per_page=100`;

  for (let page = 0; nextUrl && page < 50; page++) {
    const res = await fetchInovaGuard<{
      data?: RawInovaDevice[];
      next_page_url?: string | null;
    }>(nextUrl, config, { method: 'GET' }, { data: [] }, true);

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
    return {
      devices: fallbackDevices,
      isSimulated: true,
      totalDevices: fallbackDevices.length,
    };
  }

  // Deduplicar por ID (defensivo ante paginaciones solapadas)
  const seen = new Set<string>();
  const devices = collected.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  return { devices, isSimulated, totalDevices: devices.length };
}

// ---------------------------------------------------------------------------
// Getters públicos con caché compartida (devices + balance + licences)
// ---------------------------------------------------------------------------

/**
 * Listar dispositivos (GET /devices) con caché en memoria.
 * Devuelve la caché si existe y no está obsoleta; con `{ force: true }`
 * consulta siempre el API y refresca toda la fotografía (balance + licences).
 */
export async function getInovaGuardDevices(
  config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{
  devices: InovaGuardDeviceItem[];
  isSimulated: boolean;
  totalDevices: number;
}> {
  const snapshot = await loadSnapshot(config, !!options?.force);
  return {
    devices: snapshot.devices,
    isSimulated: snapshot.isSimulated,
    totalDevices: snapshot.totalDevices,
  };
}

/**
 * Buscar un dispositivo específico (GET /devices/find/{id})
 */
export async function findInovaGuardDevice(
  config: MdmApiConfig,
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
    `/devices/find/${id}`,
    config,
    { method: 'GET' },
    { err: true, data: undefined },
    true
  );

  const raw = res.data?.data;
  if (res.isSimulated || !raw) {
    return { device: fallbackItem, isSimulated: res.isSimulated };
  }
  return { device: normalizeDevice(raw), isSimulated: false };
}

/**
 * Bloquear dispositivo en InovaGuard (GET /devices/lock/{id})
 */
export async function lockInovaGuardDevice(
  config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: `Dispositivo bloqueado exitosamente mediante orden MDM InovaGuard.`,
  };

  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    `/devices/lock/${id}`,
    config,
    { method: 'GET' },
    fallbackResponse
  );

  if (!res.isSimulated) invalidateInovaGuardCache(); // mutación real -> datos obsoletos

  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de BLOQUEO ejecutado',
    isSimulated: res.isSimulated,
  };
}

/**
 * Desbloquear dispositivo en InovaGuard (GET /devices/unlock/{id})
 */
export async function unlockInovaGuardDevice(
  config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: `Dispositivo desbloqueado exitosamente tras el pago. Acceso restaurado.`,
  };

  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    `/devices/unlock/${id}`,
    config,
    { method: 'GET' },
    fallbackResponse
  );

  if (!res.isSimulated) invalidateInovaGuardCache(); // mutación real -> datos obsoletos

  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de DESBLOQUEO ejecutado',
    isSimulated: res.isSimulated,
  };
}

/**
 * Generar código de desbloqueo offline (POST /devices/unlock-code/{id})
 * El API oficial exige el body { next_lock_date }.
 */
export async function generateInovaGuardUnlockCode(
  config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; code?: string; isSimulated: boolean }> {
  // Genera un código numérico aleatorio de 6 dígitos en la simulación
  const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: 'Código de desbloqueo temporal generado por InovaGuard.',
    code: randomCode,
  };

  // Próximo vencimiento de bloqueo: +24h (formato YYYY-MM-DDTHH:MM)
  const nextLock = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextLockDate = `${nextLock.getFullYear()}-${pad(nextLock.getMonth() + 1)}-${pad(
    nextLock.getDate()
  )}T${pad(nextLock.getHours())}:${pad(nextLock.getMinutes())}`;

  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    `/devices/unlock-code/${id}`,
    config,
    { method: 'POST', body: JSON.stringify({ next_lock_date: nextLockDate }) },
    fallbackResponse
  );

  if (!res.isSimulated) invalidateInovaGuardCache(); // next_lock_date cambia el estado real

  return {
    err: !!res.data.err,
    message: res.data.message || 'Código generado',
    code: res.data.code || randomCode,
    isSimulated: res.isSimulated,
  };
}

/**
 * Remover dispositivo del servidor MDM (GET /devices/remove/{id})
 */
export async function removeInovaGuardDevice(
  config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  const fallbackResponse: InovaGuardStandardResponse = {
    err: false,
    message: `Dispositivo desvinculado y removido de la plataforma InovaGuard.`,
  };

  const res = await fetchInovaGuard<InovaGuardStandardResponse>(
    `/devices/remove/${id}`,
    config,
    { method: 'GET' },
    fallbackResponse
  );

  if (!res.isSimulated) invalidateInovaGuardCache(); // dispositivo eliminado -> datos obsoletos

  return {
    err: !!res.data.err,
    message: res.data.message || 'Dispositivo removido de InovaGuard',
    isSimulated: res.isSimulated,
  };
}

/**
 * Consultar balance de licencias (GET /balance) — schema real del API
 * Fetcher interno; el getter público usa la caché compartida.
 */
async function fetchBalanceList(config: MdmApiConfig): Promise<{
  balance: InovaGuardBalance;
  isSimulated: boolean;
}> {
  const fallbackBalance: InovaGuardBalance = {
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

  const res = await fetchInovaGuard<Partial<InovaGuardBalance>>(
    config.balanceEndpoint || '/balance',
    config,
    { method: 'GET' },
    fallbackBalance
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

/**
 * Consultar balance de licencias (GET /balance) con caché compartida.
 */
export async function getInovaGuardBalance(
  config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{
  balance: InovaGuardBalance;
  isSimulated: boolean;
}> {
  const snapshot = await loadSnapshot(config, !!options?.force);
  return { balance: snapshot.balance, isSimulated: snapshot.isSimulated };
}

/**
 * Consultar disponibilidad de licencias por plan (GET /licences)
 * Fetcher interno; el getter público usa la caché compartida.
 */
async function fetchLicencesList(config: MdmApiConfig): Promise<{
  licences: InovaGuardLicence[];
  isSimulated: boolean;
}> {
  const fallbackLicences: InovaGuardLicence[] = [
    { name: 'demo', type: 0, availables: 126 },
    { name: 'basic', type: 1, availables: 141 },
    { name: 'business', type: 2, availables: 0 },
    { name: 'enterprise', type: 3, availables: 0 },
    { name: 'iphone', type: 4, availables: 29 },
  ];

  const res = await fetchInovaGuard<InovaGuardLicence[]>(
    '/licences',
    config,
    { method: 'GET' },
    fallbackLicences
  );

  const licences = Array.isArray(res.data) && res.data.length ? res.data : fallbackLicences;
  return { licences, isSimulated: res.isSimulated };
}

/**
 * Consultar disponibilidad de licencias por plan (GET /licences) con caché compartida.
 */
export async function getInovaGuardLicences(
  config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{
  licences: InovaGuardLicence[];
  isSimulated: boolean;
}> {
  const snapshot = await loadSnapshot(config, !!options?.force);
  return { licences: snapshot.licences, isSimulated: snapshot.isSimulated };
}

/**
 * Obtener QR de enrolamiento (GET /devices/qr-enrollment)
 * El API real devuelve una imagen PNG binaria -> se convierte a Object URL.
 */
export async function getInovaGuardQrEnrollment(config: MdmApiConfig): Promise<{
  qrUrl: string;
  enrollmentToken: string;
  isSimulated: boolean;
}> {
  const fallbackData = {
    qrUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=INOVAGUARD-ENROLL-CLIENT-D13CB763',
    enrollmentToken: 'ENROLL-D13C-B763-1998',
  };

  const res = await fetchInovaGuard<Blob | { qrUrl?: string; enrollmentToken?: string }>(
    config.qrEndpoint || '/devices/qr-enrollment',
    config,
    { method: 'GET' },
    fallbackData
  );

  if (res.isSimulated) {
    return { ...fallbackData, isSimulated: true };
  }

  if (res.data instanceof Blob) {
    return {
      qrUrl: URL.createObjectURL(res.data),
      enrollmentToken: `ENROLL-${config.appClient.slice(0, 8).toUpperCase()}`,
      isSimulated: false,
    };
  }

  const json = res.data as { qrUrl?: string; enrollmentToken?: string };
  return {
    qrUrl: json.qrUrl || fallbackData.qrUrl,
    enrollmentToken: json.enrollmentToken || fallbackData.enrollmentToken,
    isSimulated: false,
  };
}
