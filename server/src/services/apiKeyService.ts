// ============================================================================
// CrediPay MDM - Fase 7
// apiKeyService.ts
// API keys para integraciones externas: llave `cpk_` mostrada una sola vez,
// almacenada como sha256 (nunca en claro). Autenticación vía X-API-Key.
// ============================================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError, sha256, randomHex } from '../utils/http.js';

const KEY_PREFIX = 'cpk_';
const MAX_ACTIVE_KEYS = 20;

export interface ApiKeyRow extends RowDataPacket {
  id: number;
  user_id: number;
  key_name: string;
  key_prefix: string;
  scopes: string[] | null;
  status: string;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export function generateApiKey(): { raw: string; printed: string } {
  const core = randomHex(24);
  const raw = `${KEY_PREFIX}${core}`;
  const groups = core.match(/.{1,4}/g) ?? [];
  return { raw, printed: `${KEY_PREFIX}${groups.join('-')}` };
}

export function hashApiKey(raw: string): string {
  return sha256(`${raw}|credipay-api-key`);
}

export async function createApiKey(input: {
  userId: number;
  tenantId: number | null;
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}): Promise<{ id: number; key: string; printed: string; prefix: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND status = \'ACTIVE\'',
    [input.userId]
  );
  if (Number(rows[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    throw ApiError.badRequest('too_many_keys', `Límite de API keys activas (${MAX_ACTIVE_KEYS}) alcanzado`);
  }
  const { raw, printed } = generateApiKey();
  const expires = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const [insertRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO api_keys (tenant_id, user_id, key_name, key_hash, key_prefix, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.userId,
      input.name.slice(0, 100),
      hashApiKey(raw),
      KEY_PREFIX,
      JSON.stringify(input.scopes ?? []),
      expires,
    ]
  );
  return { id: insertRes.insertId, key: raw, printed, prefix: KEY_PREFIX };
}

export async function listApiKeys(userId: number): Promise<ApiKeyRow[]> {
  const [rows] = await pool.query<ApiKeyRow[]>(
    `SELECT id, key_name, key_prefix, scopes, status, last_used_at, expires_at, created_at
       FROM api_keys
      WHERE user_id = ? AND status = 'ACTIVE'
      ORDER BY id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...r,
    scopes: Array.isArray(r.scopes)
      ? r.scopes
      : (() => {
          try {
            return JSON.parse(String(r.scopes ?? '[]')) as string[];
          } catch {
            return [];
          }
        })(),
  }));
}

export async function revokeApiKey(userId: number, keyId: number): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE api_keys SET status = 'REVOKED', updated_at = NOW()
      WHERE id = ? AND user_id = ? AND status = 'ACTIVE'`,
    [keyId, userId]
  );
  if (res.affectedRows === 0) {
    throw ApiError.notFound('API key no encontrada');
  }
}

export interface ApiKeyAuthResult {
  userId: number;
  tenantId: number | null;
  userTenantId: number | null;
  keyName: string;
  permissions: string[];
  keyId: number;
  rateLimitPerMin: number;
}

/** Valida la llave en el encabezado X-API-Key y devuelve el contexto. */
export async function authenticateApiKey(rawKey: string): Promise<ApiKeyAuthResult | null> {
  const key = rawKey.replace(/-/g, '');
  if (!key.startsWith(KEY_PREFIX)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id AS key_id, a.key_name, a.user_id, u.tenant_id AS user_tenant_id,
            a.expires_at, a.status, a.rate_limit_per_min
       FROM api_keys a
       JOIN users u ON u.id = a.user_id
      WHERE a.key_hash = ? AND a.status = 'ACTIVE'
      LIMIT 1`,
    [hashApiKey(key)]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'ACTIVE') return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  await pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [row.key_id]);
  const permissions = await loadApiKeyPermissions(Number(row.user_id), row.user_tenant_id as number | null);
  return {
    userId: Number(row.user_id),
    tenantId: row.user_tenant_id as number | null,
    userTenantId: row.user_tenant_id as number | null,
    keyName: row.key_name,
    permissions,
    keyId: Number(row.key_id),
    rateLimitPerMin: Number(row.rate_limit_per_min ?? 60),
  };
}

async function loadApiKeyPermissions(userId: number, tenantId: number | null): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ? AND (ur.tenant_id = ? OR ur.tenant_id IS NULL)`,
    [userId, tenantId]
  );
  return rows.map((r) => r.permission_key as string);
}