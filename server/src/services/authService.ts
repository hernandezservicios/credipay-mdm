import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { ApiError, isValidPassword, randomHex, sha256 } from '../utils/http.js';
import { recordAudit, recordLoginAttempt, type UaInfo } from './auditService.js';

interface UserRow extends RowDataPacket {
  id: number;
  tenant_id: number | null;
  name: string;
  email: string;
  email_verified_at: Date | null;
  password_hash: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  must_change_password: number;
}

interface SessionRow extends RowDataPacket {
  id: string;
  user_id: number;
  tenant_id: number | null;
  csrf_token: string | null;
  expires_at: Date;
  is_remember: number;
}

interface TenantRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  status: string;
}

interface CountRow extends RowDataPacket {
  n: number;
}

const SESSION_LIFETIME_MINUTES = 8 * 60;
const REMEMBER_DAYS = 30;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  tenantId: number | null;
  emailVerifiedAt: Date | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
}

function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    tenantId: u.tenant_id,
    emailVerifiedAt: u.email_verified_at,
    status: u.status,
    mustChangePassword: u.must_change_password === 1,
    lastLoginAt: null,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
    [email]
  );
  return rows[0] ?? null;
}

export async function loadPermissions(userId: number, tenantId: number | null): Promise<string[]> {
  const [roleRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ? AND (ur.tenant_id = ? OR ur.tenant_id IS NULL)`,
    [userId, tenantId]
  );
  const [extraRows] = await pool.query<RowDataPacket[]>(
    `SELECT p.permission_key, up.granted
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = ? AND (up.tenant_id = ? OR up.tenant_id IS NULL)`,
    [userId, tenantId]
  );

  const set = new Set(roleRows.map((r) => r.permission_key as string));
  for (const row of extraRows) {
    if (row.granted === 1) set.add(row.permission_key as string);
    else set.delete(row.permission_key as string);
  }
  return [...set];
}

export async function getSessionUser(sessionToken: string): Promise<{
  session: SessionRow;
  user: UserRow;
  tenant: TenantRow | null;
} | null> {
  const id = sha256(sessionToken);
  const [rows] = await pool.query<SessionRow[]>(
    `SELECT s.*
       FROM sessions s
      WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()
      LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;
  const session = rows[0];

  const [userRows] = await pool.query<UserRow[]>(
    'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [session.user_id]
  );
  if (userRows.length === 0) return null;
  const user = userRows[0];
  if (user.status !== 'ACTIVE' && user.status !== 'PENDING') return null;

  let tenant: TenantRow | null = null;
  if (user.tenant_id !== null) {
    const [tenantRows] = await pool.query<TenantRow[]>(
      'SELECT id, name, slug, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [user.tenant_id]
    );
    tenant = tenantRows[0] ?? null;
    if (!tenant || tenant.status === 'SUSPENDED') return null;
  }

  await pool.query('UPDATE sessions SET last_activity_at = NOW() WHERE id = ?', [id]);
  return { session, user, tenant };
}

async function checkLockout(email: string, ip: string): Promise<number> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE email = ? AND success = 0 AND attempted_at > NOW() - INTERVAL ? MINUTE`,
    [email, LOCKOUT_MINUTES]
  );
  if ((rows[0]?.n ?? 0) < MAX_LOGIN_ATTEMPTS) return 0;
  const [oldest] = await pool.query<RowDataPacket[]>(
    `SELECT MIN(attempted_at) AS first_fail FROM login_attempts
      WHERE email = ? AND success = 0 AND attempted_at > NOW() - INTERVAL ? MINUTE`,
    [email, LOCKOUT_MINUTES]
  );
  const firstFail = oldest[0]?.first_fail as Date | undefined;
  if (!firstFail) return 0;
  const lockUntil = firstFail.getTime() + LOCKOUT_MINUTES * 60_000;
  return Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
}

export async function login(input: {
  email: string;
  password: string;
  remember: boolean;
  ua: UaInfo;
}): Promise<{ sessionToken: string; csrfToken: string; expiresAt: Date; user: PublicUser; permissions: string[] }> {
  const email = input.email.trim().toLowerCase();

  const lockoutSeconds = await checkLockout(email, input.ua.ip);
  if (lockoutSeconds > 0) {
    throw ApiError.tooManyRequests(
      `Demasiados intentos fallidos. Espere ${Math.ceil(lockoutSeconds / 60)} minuto(s).`
    );
  }

  const user = await findUserByEmail(email);
  const recordFail = async (reason: string) => {
    await recordLoginAttempt({
      userId: user?.id ?? null,
      email,
      ip: input.ua.ip,
      userAgent: input.ua.userAgent,
      success: false,
      reason,
    });
  };

  if (!user) {
    await recordFail('INVALID_CREDENTIALS');
    throw ApiError.unauthorized('Credenciales inválidas');
  }

  if (user.status === 'SUSPENDED') {
    await recordFail('SUSPENDED');
    throw ApiError.forbidden('account_suspended', 'La cuenta está suspendida');
  }

  if (user.status === 'PENDING' && !user.email_verified_at) {
    await recordFail('EMAIL_NOT_VERIFIED');
    throw ApiError.forbidden('email_not_verified', 'Verifique su correo electrónico antes de iniciar sesión');
  }

  const ok = await bcrypt.compare(input.password, user.password_hash);
  if (!ok) {
    await recordFail('INVALID_CREDENTIALS');
    throw ApiError.unauthorized('Credenciales inválidas');
  }

  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');

  const sessionToken = randomHex(32);
  const sessionId = sha256(sessionToken);
  const csrfToken = randomHex(32);
  const now = new Date();
  const expiresAt = input.remember
    ? new Date(now.getTime() + REMEMBER_DAYS * 24 * 60 * 60 * 1000)
    : new Date(now.getTime() + SESSION_LIFETIME_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO sessions
      (id, user_id, tenant_id, ip_address, user_agent, device_type, browser, os,
       is_remember, csrf_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      user.tenant_id,
      input.ua.ip,
      input.ua.userAgent,
      input.ua.parsed.deviceType,
      input.ua.parsed.browser,
      input.ua.parsed.os,
      input.remember ? 1 : 0,
      csrfToken,
      expiresAt,
    ]
  );

  await pool.query(
    'UPDATE users SET last_login_at = NOW(), last_login_ip = ?, last_login_user_agent = ? WHERE id = ?',
    [input.ua.ip, input.ua.userAgent, user.id]
  );

  await recordLoginAttempt({
    userId: user.id,
    email,
    ip: input.ua.ip,
    userAgent: input.ua.userAgent,
    success: true,
  });
  await recordAudit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: String(user.id),
    metadata: { ip: input.ua.ip, browser: input.ua.parsed.browser, os: input.ua.parsed.os },
  });

  const permissions = await loadPermissions(user.id, user.tenant_id);
  return {
    sessionToken,
    csrfToken,
    expiresAt,
    user: toPublicUser(user),
    permissions,
  };
}

export async function logout(sessionToken: string, req?: { ip?: string }): Promise<void> {
  const sessionId = sha256(sessionToken);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT user_id, tenant_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId]
  );
  if (rows.length === 0) return;
  await pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL',
    [sessionId]
  );
  await recordAudit({
    tenantId: rows[0].tenant_id as number | null,
    userId: rows[0].user_id as number,
    action: 'auth.logout',
    entityType: 'user',
    entityId: String(rows[0].user_id),
    metadata: { ip: req?.ip },
  });
}

export async function requestPasswordReset(emailRaw: string): Promise<string | null> {
  const email = emailRaw.trim().toLowerCase();
  const user = await findUserByEmail(email);
  if (!user) return null;

  await pool.query(
    'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
    [user.id]
  );

  const raw = randomHex(32);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [user.id, sha256(raw)]
  );
  await recordAudit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: String(user.id),
  });
  return raw;
}

export async function resetPassword(input: {
  token: string;
  email: string;
  newPassword: string;
}): Promise<void> {
  if (!isValidPassword(input.newPassword)) {
    throw ApiError.badRequest(
      'invalid_password',
      'La contraseña debe tener al menos 10 caracteres, letras y números'
    );
  }
  const email = input.email.trim().toLowerCase();
  const [rows] = await pool.query<
    (RowDataPacket & { id: number; user_id: number; expires_at: Date; used_at: Date | null })[]
  >(
    `SELECT * FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [sha256(input.token)]
  );
  const reset = rows[0];
  if (!reset) throw ApiError.badRequest('invalid_token', 'Enlace inválido o expirado');

  const [userRows] = await pool.query<UserRow[]>(
    'SELECT * FROM users WHERE id = ? AND email = ? LIMIT 1',
    [reset.user_id, email]
  );
  if (userRows.length === 0) throw ApiError.badRequest('invalid_token', 'Enlace inválido o expirado');
  const user = userRows[0];

  const hash = await bcrypt.hash(input.newPassword, 12);
  await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
    hash,
    user.id,
  ]);
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [reset.id]);
  await pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [user.id]
  );
  await recordAudit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: String(user.id),
  });
}

export async function changePassword(input: {
  userId: number;
  tenantId: number | null;
  currentPassword: string;
  newPassword: string;
  currentSessionId: string;
}): Promise<void> {
  if (!isValidPassword(input.newPassword)) {
    throw ApiError.badRequest(
      'invalid_password',
      'La contraseña debe tener al menos 10 caracteres, letras y números'
    );
  }
  const [rows] = await pool.query<UserRow[]>(
    'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [input.userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.unauthorized();

  const ok = await bcrypt.compare(input.currentPassword, user.password_hash);
  if (!ok) throw ApiError.badRequest('invalid_current_password', 'La contraseña actual es incorrecta');

  const hash = await bcrypt.hash(input.newPassword, 12);
  await pool.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [hash, user.id]
  );
  await pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
    [user.id, input.currentSessionId]
  );
  await recordAudit({
    tenantId: input.tenantId,
    userId: input.userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: String(input.userId),
  });
}

export async function createEmailVerification(userId: number): Promise<string> {
  const raw = randomHex(32);
  await pool.query(
    'UPDATE email_verifications SET verified_at = NOW() WHERE user_id = ? AND verified_at IS NULL',
    [userId]
  );
  await pool.query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [userId, sha256(raw)]
  );
  return raw;
}

export async function verifyEmail(token: string): Promise<void> {
  const [rows] = await pool.query<
    (RowDataPacket & { id: number; user_id: number; expires_at: Date; verified_at: Date | null })[]
  >(
    'SELECT * FROM email_verifications WHERE token_hash = ? AND verified_at IS NULL AND expires_at > NOW() LIMIT 1',
    [sha256(token)]
  );
  const verification = rows[0];
  if (!verification) throw ApiError.badRequest('invalid_token', 'Enlace inválido o expirado');

  await pool.query('UPDATE email_verifications SET verified_at = NOW() WHERE id = ?', [
    verification.id,
  ]);
  await pool.query(
    `UPDATE users SET email_verified_at = NOW(),
       status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END
     WHERE id = ?`,
    [verification.user_id]
  );
  const [userRows] = await pool.query<RowDataPacket[]>(
    'SELECT tenant_id FROM users WHERE id = ?',
    [verification.user_id]
  );
  await recordAudit({
    tenantId: (userRows[0]?.tenant_id as number | null) ?? null,
    userId: verification.user_id,
    action: 'auth.email_verified',
    entityType: 'user',
    entityId: String(verification.user_id),
  });
}

export function buildResetLink(rawToken: string, email: string): string {
  return `${env.WEB_ORIGIN}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
}

export function buildVerificationLink(rawToken: string, email: string): string {
  return `${env.WEB_ORIGIN}/verify-email?token=${rawToken}&email=${encodeURIComponent(email)}`;
}
