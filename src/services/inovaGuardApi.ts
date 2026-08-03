import {
  MdmApiConfig,
  InovaGuardDeviceItem,
  InovaGuardBalance,
  InovaGuardLicence,
} from '../types';
import {
  apiMdmBalance,
  apiMdmDevices,
  apiMdmFindDevice,
  apiMdmLicences,
  apiMdmLock,
  apiMdmQrEnrollment,
  apiMdmRemove,
  apiMdmUnlock,
  apiMdmUnlockCode,
} from './api';

/**
 * Servicio de integración con InovaGuard MDM API (Fase 3 — vía proxy).
 *
 * Desde la Fase 3 TODO el tráfico MDM pasa por el backend
 * (`server/src/services/inovaGuardService.ts`): las credenciales y el token
 * Bearer viven en la BD del tenant y NUNCA llegan al navegador. Este módulo
 * conserva la misma superficie pública que consumen las vistas, pero cada
 * función delega en los endpoints `/api/v1/mdm/*` del servidor.
 */

const SNAPSHOT_STORAGE_KEY = 'credipay-mdm-inovaguard-snapshot';

interface InovaGuardSnapshot {
  devices: InovaGuardDeviceItem[];
  totalDevices: number;
  balance: InovaGuardBalance;
  licences: InovaGuardLicence[];
  isSimulated: boolean;
  fetchedAt: number;
}

let cachedSnapshot: InovaGuardSnapshot | null = null;
let snapshotDirty = true;
let snapshotInFlight: Promise<InovaGuardSnapshot> | null = null;

function hydrateSnapshotFromStorage(): void {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as InovaGuardSnapshot;
      if (parsed && Array.isArray(parsed.devices) && parsed.balance && parsed.licences) {
        cachedSnapshot = parsed;
        snapshotDirty = true;
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

/** Devuelve la fotografía cacheada si existe (render instantáneo). */
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

/** Carga (o reutiliza) la fotografía completa consultando al servidor. */
async function loadSnapshot(force: boolean): Promise<InovaGuardSnapshot> {
  if (!force && !snapshotDirty && cachedSnapshot) {
    return cachedSnapshot;
  }
  if (!snapshotInFlight) {
    snapshotInFlight = Promise.all([
      apiMdmDevices(force),
      apiMdmBalance(force),
      apiMdmLicences(force),
    ])
      .then(([devRes, balRes, licRes]) => {
        cachedSnapshot = {
          devices: (devRes.data.devices as InovaGuardDeviceItem[]) ?? [],
          totalDevices: Number(devRes.data.totalDevices) || 0,
          balance: (balRes.data.balance as InovaGuardBalance) ?? null,
          licences: (licRes.data.licences as InovaGuardLicence[]) ?? [],
          isSimulated:
            devRes.data.isSimulated || balRes.data.isSimulated || licRes.data.isSimulated,
          fetchedAt: Date.now(),
        };
        snapshotDirty = false;
        try {
          localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(cachedSnapshot));
        } catch {
          // caché en memoria es suficiente
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
// Autenticación pública (el proxy gestiona el token en el servidor)
// ---------------------------------------------------------------------------

export async function loginInovaGuard(config: MdmApiConfig): Promise<{
  token: string;
  err: boolean;
  message: string;
  isSimulated: boolean;
}> {
  try {
    const res = await apiMdmBalance(true);
    return {
      token: config.bearerToken || '',
      err: false,
      message: res.data.isSimulated
        ? 'Conectado vía proxy (datos simulados)'
        : 'Conectado vía proxy del servidor (token gestionado en backend)',
      isSimulated: res.data.isSimulated,
    };
  } catch {
    return {
      token: config.bearerToken || '',
      err: true,
      message: 'No se pudo validar la conexión MDM a través del servidor',
      isSimulated: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Dispositivos, balance y licencias (GET)
// ---------------------------------------------------------------------------

export async function getInovaGuardDevices(
  _config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{
  devices: InovaGuardDeviceItem[];
  isSimulated: boolean;
  totalDevices: number;
}> {
  const snapshot = await loadSnapshot(!!options?.force);
  return {
    devices: snapshot.devices,
    isSimulated: snapshot.isSimulated,
    totalDevices: snapshot.totalDevices,
  };
}

export async function findInovaGuardDevice(
  _config: MdmApiConfig,
  id: string
): Promise<{ device: InovaGuardDeviceItem | null; isSimulated: boolean }> {
  const res = await apiMdmFindDevice(id);
  const device = res.data.device as InovaGuardDeviceItem | null;
  return { device, isSimulated: res.data.isSimulated };
}

export async function getInovaGuardBalance(
  _config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{ balance: InovaGuardBalance; isSimulated: boolean }> {
  const snapshot = await loadSnapshot(!!options?.force);
  return { balance: snapshot.balance, isSimulated: snapshot.isSimulated };
}

export async function getInovaGuardLicences(
  _config: MdmApiConfig,
  options?: { force?: boolean }
): Promise<{ licences: InovaGuardLicence[]; isSimulated: boolean }> {
  const snapshot = await loadSnapshot(!!options?.force);
  return { licences: snapshot.licences, isSimulated: snapshot.isSimulated };
}

export async function getInovaGuardQrEnrollment(_config: MdmApiConfig): Promise<{
  qrUrl: string;
  enrollmentToken: string;
  isSimulated: boolean;
}> {
  const res = await apiMdmQrEnrollment();
  return {
    qrUrl: res.data.qrDataUrl,
    enrollmentToken: res.data.enrollmentToken,
    isSimulated: res.data.isSimulated,
  };
}

// ---------------------------------------------------------------------------
// Comandos (POST)
// ---------------------------------------------------------------------------

export async function lockInovaGuardDevice(
  _config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  invalidateInovaGuardCache();
  const res = await apiMdmLock(id);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de BLOQUEO ejecutado',
    isSimulated: !!res.data.isSimulated,
  };
}

export async function unlockInovaGuardDevice(
  _config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  invalidateInovaGuardCache();
  const res = await apiMdmUnlock(id);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Comando de DESBLOQUEO ejecutado',
    isSimulated: !!res.data.isSimulated,
  };
}

export async function generateInovaGuardUnlockCode(
  _config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; code?: string; isSimulated: boolean }> {
  invalidateInovaGuardCache();
  const res = await apiMdmUnlockCode(id);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Código generado',
    code: res.data.code,
    isSimulated: !!res.data.isSimulated,
  };
}

export async function removeInovaGuardDevice(
  _config: MdmApiConfig,
  id: string
): Promise<{ err: boolean; message: string; isSimulated: boolean }> {
  invalidateInovaGuardCache();
  const res = await apiMdmRemove(id);
  return {
    err: !!res.data.err,
    message: res.data.message || 'Dispositivo removido de InovaGuard',
    isSimulated: !!res.data.isSimulated,
  };
}
