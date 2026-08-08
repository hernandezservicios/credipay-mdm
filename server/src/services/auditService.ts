import type { Request } from 'express';
import { pool } from '../db/pool.js';
import { getClientIp, parseUserAgent } from '../utils/http.js';

interface AuditInput {
  tenantId: number | null;
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
}

interface RequestMeta {
  tenantId: number | null;
  userId: number | null;
}

export function requestMeta(req: Request, override?: Partial<RequestMeta>): RequestMeta {
  const auth = (req as Request & { auth?: RequestMeta }).auth;
  return {
    tenantId: override?.tenantId ?? auth?.tenantId ?? null,
    userId: override?.userId ?? auth?.userId ?? null,
  };
}

// FASE 9 (auditoría): los valores de auditoría nunca persisten secretos en claro.
const SENSITIVE_KEYS = new Set([
  'apiKey', 'secret', 'token', 'bearerToken', 'appClient', 'password',
  'password_hash', 'currentPassword', 'newPassword', 'dev_password',
  'webhookSecret', 'publishableKey', 'sellerId', 'merchantCode', 'MYSQL_PWD',
]);

function sanitizeAuditValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValues);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '********' : sanitizeAuditValues(val);
    }
    return out;
  }
  return value;
}

export async function recordAudit(input: AuditInput, req?: Request): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs
        (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values,
         ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId,
        input.userId,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.oldValues ? JSON.stringify(sanitizeAuditValues(input.oldValues)) : null,
        input.newValues ? JSON.stringify(sanitizeAuditValues(input.newValues)) : null,
        req ? getClientIp(req) : null,
        req ? (req.headers['user-agent'] as string | undefined) ?? null : null,
        input.metadata ? JSON.stringify(sanitizeAuditValues(input.metadata)) : null,
      ]
    );
  } catch (err) {
    console.error('No se pudo registrar auditoría:', err);
  }
}

export async function recordActivity(
  tenantId: number | null,
  userId: number | null,
  activityType: string,
  description: string,
  req?: Request
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO activity_logs
        (tenant_id, user_id, activity_type, description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        userId,
        activityType,
        description,
        req ? getClientIp(req) : null,
        req ? (req.headers['user-agent'] as string | undefined) ?? null : null,
      ]
    );
  } catch (err) {
    console.error('No se pudo registrar actividad:', err);
  }
}

export async function recordLoginAttempt(input: {
  userId: number | null;
  email: string | null;
  ip: string;
  userAgent: string | null;
  success: boolean;
  reason?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO login_attempts (user_id, email, ip_address, user_agent, success, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.userId, input.email, input.ip, input.userAgent, input.success ? 1 : 0, input.reason ?? null]
    );
  } catch (err) {
    console.error('No se pudo registrar intento de login:', err);
  }
}

export interface UaInfo {
  ip: string;
  userAgent: string | null;
  parsed: { browser: string; os: string; deviceType: string };
}

export function uaInfo(req: Request): UaInfo {
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;
  return {
    ip: getClientIp(req),
    userAgent,
    parsed: parseUserAgent(userAgent ?? undefined),
  };
}
