import type { MdmConfig } from '../../services/tenantService.js';

export type { MdmConfig };

export type InovaGuardStatus = 'LOCKED' | 'UNLOCKED';

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

export interface RawInovaDevice {
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

export interface InovaGuardSnapshot {
  devices: InovaGuardDeviceItem[];
  totalDevices: number;
  balance: InovaGuardBalance;
  licences: InovaGuardLicence[];
  isSimulated: boolean;
  fetchedAt: number;
}

const STATUS_MAP: Record<number, InovaGuardStatus> = {
  1: 'UNLOCKED',
  2: 'LOCKED',
  3: 'LOCKED',
};

const STOCK_OWNER_MARKER = 'DISPONIBLE PARA FINANCIAR';

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

export function normalizeDevice(raw: RawInovaDevice): InovaGuardDeviceItem {
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