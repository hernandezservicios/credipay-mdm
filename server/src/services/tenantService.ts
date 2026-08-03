import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';

export interface TenantRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  currency_code: string;
  country_code: string;
  language_code: string;
  timezone: string;
}

export interface MdmConfig {
  provider: 'INOVAGUARD' | 'GENERIC';
  baseUrl: string;
  apiKey: string;
  appClient: string;
  secret: string;
  bearerToken: string;
  authLoginEndpoint: string;
  devicesEndpoint: string;
  lockEndpoint: string;
  unlockEndpoint: string;
  unlockCodeEndpoint: string;
  removeEndpoint: string;
  qrEndpoint: string;
  balanceEndpoint: string;
  statusEndpoint: string;
  enabled: boolean;
  autoLockOnOverdue: boolean;
  autoUnlockOnPaid: boolean;
  liveMode: boolean;
}

export const DEFAULT_MDM_CONFIG: MdmConfig = {
  provider: 'INOVAGUARD',
  baseUrl: 'https://dashboard.inovaguardapp.com/api/v1/customer',
  apiKey: '',
  appClient: '',
  secret: '',
  bearerToken: '',
  authLoginEndpoint: '/auth/login',
  devicesEndpoint: '/devices',
  lockEndpoint: '/devices/lock/{id}',
  unlockEndpoint: '/devices/unlock/{id}',
  unlockCodeEndpoint: '/devices/unlock-code/{id}',
  removeEndpoint: '/devices/remove/{id}',
  qrEndpoint: '/devices/qr-enrollment',
  balanceEndpoint: '/balance',
  statusEndpoint: '/devices/find/{id}',
  enabled: false,
  autoLockOnOverdue: true,
  autoUnlockOnPaid: true,
  liveMode: false,
};

export interface TenantSettingsRow extends RowDataPacket {
  tenant_id: number;
  mdm_config: string | Record<string, unknown> | null;
  theme: string | null;
  grace_days: number;
  overdue_penalty: string;
  receipt_prefix: string;
  invoice_prefix: string;
  notifications: string | null;
}

export async function getTenant(tenantId: number): Promise<TenantRow> {
  const [rows] = await pool.query<TenantRow[]>(
    'SELECT id, name, slug, domain, status, currency_code, country_code, language_code, timezone FROM tenants WHERE id = ?',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');
  return tenant;
}

export async function getTenantSettings(tenantId: number): Promise<TenantSettingsRow | null> {
  const [rows] = await pool.query<TenantSettingsRow[]>(
    'SELECT * FROM tenant_settings WHERE tenant_id = ?',
    [tenantId]
  );
  return rows[0] ?? null;
}

export function parseMdmConfigValue(
  value: string | Record<string, unknown> | null | undefined
): MdmConfig {
  if (!value) return { ...DEFAULT_MDM_CONFIG };
  try {
    const parsed =
      typeof value === 'string' ? (JSON.parse(value) as Partial<MdmConfig>) : value;
    return { ...DEFAULT_MDM_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_MDM_CONFIG };
  }
}

export async function getMdmConfig(tenantId: number): Promise<MdmConfig> {
  const row = await getTenantSettings(tenantId);
  if (!row?.mdm_config) return { ...DEFAULT_MDM_CONFIG };
  return parseMdmConfigValue(row.mdm_config);
}

export async function updateMdmConfig(
  tenantId: number,
  patch: Partial<MdmConfig>
): Promise<MdmConfig> {
  const current = await getMdmConfig(tenantId);
  const merged: MdmConfig = { ...current, ...patch };
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id, mdm_config) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE mdm_config = VALUES(mdm_config)`,
    [tenantId, JSON.stringify(merged)]
  );
  return merged;
}
