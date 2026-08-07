import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { assertPlanLimit } from '../../services/planService.js';
import {
  buildResetLink,
  requestPasswordReset,
  findUserByEmail,
} from '../../services/authService.js';
import { sendTransactionalEmail } from '../../services/emailService.js';
import { ApiError } from '../../utils/http.js';
import { env } from '../../config/env.js';

const router = Router();

router.use(authRequired, csrfProtect);

// ---------------------------------------------------------------------------
// Usuarios (Super Admin global): gestión de usuarios de la plataforma y de
// cada empresa. Permisos: users.view / users.create / users.edit / users.delete.
// ---------------------------------------------------------------------------

async function assertGlobal(req: AuthRequest): Promise<void> {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede gestionar usuarios de la plataforma'
    );
  }
}

const USER_FIELDS = ['name', 'email', 'phone', 'status', 'locale'] as const;

router.get('/', requirePermission('users.view'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const tenantFilter = Number(req.query.tenant_id);
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  let where = 'u.deleted_at IS NULL';
  const params: unknown[] = [];
  if (Number.isInteger(tenantFilter) && tenantFilter > 0) {
    where += ' AND u.tenant_id = ?';
    params.push(tenantFilter);
  }
  if (search) {
    where += ' AND (u.name LIKE ? OR u.email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.phone, u.status, u.email_verified_at,
            u.last_login_at, u.must_change_password, u.created_at,
            t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status,
            GROUP_CONCAT(DISTINCT r.slug ORDER BY r.slug SEPARATOR ',') AS role_slugs
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE ${where}
      GROUP BY u.id, u.tenant_id, u.name, u.email, u.phone, u.status,
               u.email_verified_at, u.last_login_at, u.must_change_password,
               u.created_at, t.name, t.slug, t.status
      ORDER BY t.id IS NOT NULL, t.name, u.name
      LIMIT 200`,
    params
  );
  res.json({ data: rows });
});

router.get('/:id', requirePermission('users.view'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const userId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.phone, u.status, u.email_verified_at,
            u.two_factor_enabled, u.must_change_password, u.locale, u.created_at, u.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ? AND u.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const [roleRows] = await pool.query<RowDataPacket[]>(
    `SELECT r.id, r.slug, r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?`,
    [userId]
  );
  res.json({ data: { ...user, roles: roleRows } });
});

router.get('/tenant/:tenantId/users', requirePermission('users.view'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const tenantId = Number(req.params.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw ApiError.badRequest('invalid_tenant', 'Tenant inválido');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.phone, u.status, u.last_login_at,
            u.must_change_password, u.created_at,
            GROUP_CONCAT(DISTINCT r.slug ORDER BY r.slug SEPARATOR ',') AS role_slugs
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = ? AND u.deleted_at IS NULL
      GROUP BY u.id, u.tenant_id, u.name, u.email, u.phone, u.status,
               u.last_login_at, u.must_change_password, u.created_at
      ORDER BY u.name`,
    [tenantId]
  );
  res.json({ data: rows });
});

router.post('/', requirePermission('users.create'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const body = req.body ?? {};
  const tenantId = Number(body.tenant_id);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name) throw ApiError.badRequest('invalid_name', 'El nombre es obligatorio');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest('invalid_email', 'Correo inválido');
  }
  if (Number.isInteger(tenantId) && tenantId < 0) {
    throw ApiError.badRequest('invalid_tenant', 'tenant_id inválido');
  }
  const [dup] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  if (dup.length > 0) throw ApiError.badRequest('email_in_use', 'El correo ya está registrado');

  const dbTenantId = tenantId > 0 ? tenantId : null;
  // SaaS (FASE 4): respetar el límite max_users del plan del tenant destino.
  if (dbTenantId !== null) {
    await assertPlanLimit(dbTenantId, 'users');
  }
  const roleSlugs =
    (Array.isArray(body.roles)
      ? body.roles.filter((r: unknown): r is string => typeof r === 'string')
      : []).map((s: string) => s.toUpperCase());
  if (roleSlugs.length > 0 && dbTenantId === null && roleSlugs.some((r: string) => r !== 'SUPER_ADMIN')) {
    throw ApiError.badRequest('invalid_roles', 'Un usuario global solo puede tener rol SUPER_ADMIN');
  }
  const [roleRows] = await pool.query<RowDataPacket[]>(
    roleSlugs.length > 0
      ? `SELECT id, slug FROM roles WHERE slug IN (${roleSlugs.map(() => '?').join(', ')}) AND tenant_id IS NULL`
      : 'SELECT id, slug FROM roles WHERE 1 = 0',
    roleSlugs
  );

  const password =
    typeof body.password === 'string' && body.password.trim().length >= 8
      ? body.password.trim()
      : null;
  const plain = password ?? randomPassword();
  const hash = await bcrypt.hash(plain, 12);
  const status = body.status === 'PENDING' || body.status === 'INACTIVE' ? body.status : 'ACTIVE';

  const [insertRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO users
      (tenant_id, name, email, email_verified_at, password_hash, status, must_change_password, phone, locale)
     VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
    [
      dbTenantId,
      name,
      email,
      hash,
      status,
      password ? 0 : 1,
      typeof body.phone === 'string' ? body.phone.trim() || null : null,
      body.locale === 'en' ? 'en' : 'es',
    ]
  );
  const userId = insertRes.insertId;

  for (const r of roleRows) {
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)',
      [userId, r.id, dbTenantId]
    );
  }

  void recordAudit(
    { tenantId: dbTenantId, userId: req.auth!.userId, action: 'user.create', entityType: 'user', entityId: String(userId), newValues: { name, email, tenantId: dbTenantId, roles: roleSlugs } },
    req
  );
  void recordActivity(dbTenantId, req.auth!.userId, 'USERS', `Usuario "${name}" creado desde la plataforma`, req);

  if (!password && env.NODE_ENV !== 'production') {
    res.status(201).json({ data: { userId, name, email, status }, dev_password: plain });
    return;
  }
  res.status(201).json({ data: { userId, name, email, status } });
});

router.patch('/:id', requirePermission('users.edit'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const userId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const body = req.body ?? {};
  const fields: string[] = [];
  const values: unknown[] = [];
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const key of USER_FIELDS) {
    if (key === 'email' && typeof body.email === 'string') {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw ApiError.badRequest('invalid_email', 'Correo inválido');
      }
      const [dup] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
        [email, userId]
      );
      if (dup.length > 0) throw ApiError.badRequest('email_in_use', 'El correo ya está registrado');
      fields.push('email = ?'); values.push(email); oldValues.email = user.email; newValues.email = email;
      continue;
    }
    if (key === 'name' && typeof body.name === 'string' && body.name.trim()) {
      fields.push('name = ?'); values.push(body.name.trim()); oldValues.name = user.name; newValues.name = body.name.trim();
      continue;
    }
    if (key === 'phone' && typeof body.phone === 'string') {
      fields.push('phone = ?'); values.push(body.phone.trim() || null); oldValues.phone = user.phone; newValues.phone = body.phone;
      continue;
    }
    if (key === 'status' && (body.status === 'ACTIVE' || body.status === 'INACTIVE' || body.status === 'SUSPENDED')) {
      if (body.status !== user.status) {
        fields.push('status = ?'); values.push(body.status); oldValues.status = user.status; newValues.status = body.status;
      }
    }
    if (key === 'locale' && (body.locale === 'es' || body.locale === 'en')) {
      fields.push('locale = ?'); values.push(body.locale); oldValues.locale = user.locale; newValues.locale = body.locale;
    }
  }

  if (Array.isArray(body.roles)) {
    const roleSlugs = body.roles.filter((r: unknown): r is string => typeof r === 'string' && /^[A-Z_]+$/.test(r));
    const [roleRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, slug FROM roles WHERE slug IN (?) AND tenant_id IS NULL',
      [roleSlugs]
    );
    await pool.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    for (const r of roleRows) {
      await pool.query('INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [
        userId,
        r.id,
        user.tenant_id,
      ]);
    }
    newValues.roles = roleSlugs;
  }

  if (fields.length > 0) {
    values.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
  }

  void recordAudit(
    { tenantId: user.tenant_id, userId: req.auth!.userId, action: 'user.update', entityType: 'user', entityId: String(userId), oldValues, newValues },
    req
  );
  void recordActivity(user.tenant_id, req.auth!.userId, 'USERS', `Usuario "${user.name}" actualizado`, req);
  res.json({ data: { userId, updated: true } });
});

router.post('/:id/status', requirePermission('users.edit'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const userId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, tenant_id, status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  if (!['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'].includes(req.body?.status)) {
    throw ApiError.badRequest('invalid_status', 'Estado inválido');
  }
  const next = req.body.status;
  if (next === user.status) {
    res.json({ data: { userId, status: next, changed: false } });
    return;
  }
  await pool.query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [next, userId]);
  await pool.query('UPDATE sessions SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [
    userId,
  ]);
  void recordAudit(
    { tenantId: user.tenant_id, userId: req.auth!.userId, action: 'user.status_changed', entityType: 'user', entityId: String(userId), oldValues: { status: user.status }, newValues: { status: next } },
    req
  );
  void recordActivity(user.tenant_id, req.auth!.userId, 'USERS', `Estado del usuario "${user.name}" → ${next}`, req);
  res.json({ data: { userId, status: next, changed: true } });
});

router.post('/:id/reset-password', requirePermission('users.edit'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const userId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, email, tenant_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('Usuario no encontrado');

  const raw = await requestPasswordReset(user.email);
  if (!raw) throw ApiError.notFound('No se pudo generar el enlace de restablecimiento');
  const link = buildResetLink(raw, user.email);
  if (env.NODE_ENV !== 'production') {
    await sendTransactionalEmail({
      to: user.email,
      templateKey: 'email.password_reset',
      vars: { nombre: user.name, link },
    }).catch(() => undefined);
  }
  await pool.query("UPDATE users SET must_change_password = 1, updated_at = NOW() WHERE id = ?", [userId]);

  void recordAudit(
    { tenantId: user.tenant_id, userId: req.auth!.userId, action: 'user.reset_password', entityType: 'user', entityId: String(userId) },
    req
  );
  void recordActivity(user.tenant_id, req.auth!.userId, 'USERS', `Contraseña del usuario "${user.name}" restablecida`, req);

  const payload: Record<string, unknown> = { data: { userId, ok: true } };
  if (env.NODE_ENV !== 'production') payload.dev_reset_link = link;
  res.json(payload);
});

router.delete('/:id', requirePermission('users.delete'), async (req: AuthRequest, res) => {
  await assertGlobal(req);
  const userId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, email, tenant_id, status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  if (user.email === 'admin@credipay.local') {
    throw ApiError.forbidden('cannot_delete_superadmin', 'El Super Administrador principal no puede eliminarse');
  }
  await pool.query('UPDATE users SET deleted_at = NOW(), status = ?, updated_at = NOW() WHERE id = ?', [
    'INACTIVE',
    userId,
  ]);
  await pool.query('UPDATE sessions SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [
    userId,
  ]);
  void recordAudit(
    { tenantId: user.tenant_id, userId: req.auth!.userId, action: 'user.delete', entityType: 'user', entityId: String(userId), oldValues: { name: user.name, email: user.email } },
    req
  );
  void recordActivity(user.tenant_id, req.auth!.userId, 'USERS', `Usuario "${user.name}" eliminado (soft delete)`, req);
  res.json({ data: { userId, deleted: true } });
});

export default router;

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}