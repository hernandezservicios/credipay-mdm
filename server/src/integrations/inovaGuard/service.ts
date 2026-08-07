import type { MdmConfig } from '../../services/tenantService.js';
import {
  commandUrl,
  fetchInovaGuard,
  invalidateTenantTokens,
  type FetchResult,
} from './client.js';
import {
  fallbackDevices,
  FALLBACK_BALANCE,
  FALLBACK_LICENCES,
  fallbackDeviceItem,
  fallbackUnlockCode,
  FALLBACK_QR,
} from './demo.js';
import {
  type InovaGuardBalance,
  type InovaGuardDeviceItem,
  type InovaGuardLicence,
  type InovaGuardSnapshot,
  type InovaGuardStandardResponse,
  type RawInovaDevice,
  normalizeDevice,
} from './types.js';

export type {
  InovaGuardBalance,
  InovaGuardDeviceItem,
  InovaGuardLicence,
  InovaGuardSnapshot,
  InovaGuardStandardResponse,
  InovaGuardStatus,
  MdmConfig,
} from './types.js';
export type { FetchResult } from './client.js';

// ---------------------------------------------------------------------------
// Caché de la "fotografía" completa (devices + balance + licences) por tenant
// ---------------------------------------------------------------------------
const SNAPSHOT_TTL_MS = 60_000;

const snapshots = new Map<number, InovaGuardSnapshot>();
const dirty = new Set<number>();
const inFlight = new Map<number, Promise<InovaGuardSnapshot>>();
// FASE 7: generación por tenant. Se incrementa en invalidateTenant(); si un
// snapshot en curso (inflight) termina con una generación vieja, se descarta
// para no repoblar la caché después de una rotación de credenciales.
const generations = new Map<number, number>();

export function invalidateInovaGuardCache(tenantId: number): void {
  dirty.add(tenantId);
}

// FASE 7: rotación de credenciales / invalidación total del tenant.
// Limpia: Bearer Token, Refresh Token (si existiera), Snapshot, Dirty,
// Reintentos en vuelo (inflight) e información sincronizada temporal en caché.
// Solo afecta al tenant indicado; los demás tenants quedan intactos.
export function invalidateTenant(tenantId: number): void {
  invalidateTenantTokens(tenantId);
  snapshots.delete(tenantId);
  dirty.delete(tenantId);
  inFlight.delete(tenantId);
  generations.set(tenantId, (generations.get(tenantId) ?? 0) + 1);
}

async function loadSnapshot(
  tenantId: number,
  cfg: MdmConfig,
  force: boolean
): Promise<InovaGuardSnapshot> {
  const cached = snapshots.get(tenantId);
  const generation = generations.get(tenantId) ?? 0;
  const isFresh = cached && Date.now() - cached.fetchedAt < SNAPSHOT_TTL_MS;
  if (!force && isFresh && !dirty.has(tenantId)) return cached!;

  if (!inFlight.has(tenantId)) {
    const refresh = () => invalidateInovaGuardCache(tenantId);
    const promise = Promise.all([
      fetchDevicesList(tenantId, cfg, refresh),
      fetchBalanceList(tenantId, cfg, refresh),
      fetchLicencesList(tenantId, cfg, refresh),
    ]).then(([devRes, balRes, licRes]) => {
      const snapshot: InovaGuardSnapshot = {
        devices: devRes.devices,
        totalDevices: devRes.totalDevices,
        balance: balRes.balance,
        licences: licRes.licences,
        isSimulated: devRes.isSimulated || balRes.isSimulated || licRes.isSimulated,
        fetchedAt: Date.now(),
      };
      // FASE 7: si hubo invalidación (nueva generación) mientras se resolvía,
      // el resultado es obsoleto y NO debe repoblar la caché.
      if ((generations.get(tenantId) ?? 0) === generation) {
        snapshots.set(tenantId, snapshot);
        dirty.delete(tenantId);
      }
      return snapshot;
    });
    inFlight.set(tenantId, promise);
  }
  return inFlight.get(tenantId)!;
}

// ---------------------------------------------------------------------------
// Listar dispositivos (GET /devices) — paginado en el API real
// ---------------------------------------------------------------------------
async function fetchDevicesList(tenantId: number, cfg: MdmConfig, onAuthRefresh: () => void): Promise<{
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
      true,
      onAuthRefresh
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

async function fetchBalanceList(tenantId: number, cfg: MdmConfig, onAuthChanged: () => void): Promise<{
  balance: InovaGuardBalance;
  isSimulated: boolean;
}> {
  const res = await fetchInovaGuard<Partial<InovaGuardBalance>>(
    tenantId,
    cfg,
    cfg.balanceEndpoint || '/balance',
    { method: 'GET' },
    FALLBACK_BALANCE,
    true,
    onAuthChanged
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

async function fetchLicencesList(tenantId: number, cfg: MdmConfig, onAuthChanged: () => void): Promise<{
  licences: InovaGuardLicence[];
  isSimulated: boolean;
}> {
  const res = await fetchInovaGuard<InovaGuardLicence[]>(
    tenantId,
    cfg,
    '/licences',
    { method: 'GET' },
    FALLBACK_LICENCES,
    true,
    onAuthChanged
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
export async function findInovaGuardDevice(
  tenantId: number,
  cfg: MdmConfig,
  id: string
): Promise<{ device: InovaGuardDeviceItem | null; isSimulated: boolean }> {
  const res = await fetchInovaGuard<{ err?: boolean; data?: RawInovaDevice }>(
    tenantId,
    cfg,
    commandUrl(cfg, cfg.statusEndpoint || '/devices/find/{id}', id),
    { method: 'GET' },
    { err: true, data: undefined },
    true
  );
  // P0: en entorno real un error de red/API NO debe devolver un dispositivo demo
  if (res.error && cfg.enabled && cfg.liveMode) {
    return { device: null, isSimulated: false };
  }
  const raw = res.data?.data;
  if (res.isSimulated || !raw) {
    return { device: fallbackDeviceItem(id), isSimulated: res.isSimulated };
  }
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
  if (res.error) {
    // P0: no simular exito cuando la red/API falla en entorno real
    return { err: true, message: res.error, isSimulated: false };
  }
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
  if (res.error) {
    // P0: no simular exito cuando la red/API falla en entorno real
    return { err: true, message: res.error, isSimulated: false };
  }
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
  const randomCode = fallbackUnlockCode();
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

  if (res.error) {
    // P0: no simular exito cuando la red/API falla en entorno real
    return { err: true, message: res.error, isSimulated: false };
  }

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
  if (res.error) {
    // P0: no simular exito cuando la red/API falla en entorno real
    return { err: true, message: res.error, isSimulated: false };
  }
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
  const res = await fetchInovaGuard<
    { bufferBase64?: string } | { qrUrl?: string; enrollmentToken?: string }
  >(
    tenantId,
    cfg,
    cfg.qrEndpoint || '/devices/qr-enrollment',
    { method: 'GET' },
    FALLBACK_QR
  );

  if (res.isSimulated) return { ...FALLBACK_QR, isSimulated: true };

  const data = res.data as { bufferBase64?: string; qrUrl?: string; enrollmentToken?: string };
  if (data.bufferBase64) {
    return {
      qrDataUrl: `data:image/png;base64,${data.bufferBase64}`,
      enrollmentToken: `ENROLL-${cfg.appClient.slice(0, 8).toUpperCase()}`,
      isSimulated: false,
    };
  }
  return {
    qrDataUrl: data.qrUrl || FALLBACK_QR.qrDataUrl,
    enrollmentToken: data.enrollmentToken || FALLBACK_QR.enrollmentToken,
    isSimulated: false,
  };
}