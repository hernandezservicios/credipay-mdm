import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto.js';
import { invalidateTenant } from '../integrations/inovaGuard/index.js';

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

// FASE 6 (Seguridad AES-256-GCM): campos sensibles que nunca se guardan en claro.
const MDM_SECRET_KEYS = ['apiKey', 'appClient', 'secret', 'bearerToken'] as const;

function encryptMdmSecrets(config: MdmConfig): MdmConfig {
  const out: MdmConfig = { ...config };
  for (const key of MDM_SECRET_KEYS) {
    const value = out[key];
    if (typeof value === 'string' && value && !isEncrypted(value)) {
      out[key] = encrypt(value);
    }
  }
  return out;
}

function decryptMdmSecrets(config: MdmConfig): MdmConfig {
  const out: MdmConfig = { ...config };
  for (const key of MDM_SECRET_KEYS) {
    const value = out[key];
    if (typeof value === 'string' && isEncrypted(value)) {
      // FASE 9 (auditoría): si el descifrado falla (clave rotada o valor corrupto)
      // devolvemos cadena vacía en vez de romper todo el flujo de configuración.
      try {
        out[key] = decrypt(value);
      } catch {
        out[key] = '';
      }
    }
  }
  return out;
}

export function encryptMdmConfigForTest(config: MdmConfig): MdmConfig {
  return encryptMdmSecrets(config);
}

export function decryptMdmConfigForTest(config: MdmConfig): MdmConfig {
  return decryptMdmSecrets(config);
}

export async function getMdmConfig(tenantId: number): Promise<MdmConfig> {
  const row = await getTenantSettings(tenantId);
  if (!row?.mdm_config) return { ...DEFAULT_MDM_CONFIG };
  // FASE 6: los valores legados en claro (sin prefijo enc:v1:) se devuelven tal
  // cual; el siguiente updateMdmConfig los re-cifra automáticamente.
  return decryptMdmSecrets(parseMdmConfigValue(row.mdm_config));
}

export async function updateMdmConfig(
  tenantId: number,
  patch: Partial<MdmConfig>
): Promise<MdmConfig> {
  const current = await getMdmConfig(tenantId);
  const merged: MdmConfig = { ...current, ...patch };
  // FASE 7: si cambió alguna credencial InovaGuard, se rotan e invalidan todos
  // los estados cacheados del tenant (token, snapshot, inflight, dirty) para
  // forzar un nuevo login y nueva fotografía sin reiniciar el servidor.
  const credentialsChanged = MDM_SECRET_KEYS.some((key) => current[key] !== merged[key]);
  // FASE 6: las credenciales se cifran ANTES de persistir.
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id, mdm_config) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE mdm_config = VALUES(mdm_config)`,
    [tenantId, JSON.stringify(encryptMdmSecrets(merged))]
  );
  if (credentialsChanged) {
    invalidateTenant(tenantId);
  }
  return merged;
}
