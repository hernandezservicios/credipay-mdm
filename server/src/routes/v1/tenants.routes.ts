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
import { getPlanById, nextPeriodEnd } from '../../services/planService.js';
import { DEFAULT_MDM_CONFIG, revokeTenantSessions } from '../../services/tenantService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect);

// ---------------------------------------------------------------------------
// Empresas (tenants) — gestión y cambio de empresa activa (Super Admin)
// NOTA: no usa requireTenant porque el Super Admin global aún no tiene
// tenant activo cuando recién inicia sesión.
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

async function uniqueSlug(base: string): Promise<string> {
  const candidate = base || 'empresa';
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT slug FROM tenants WHERE slug = ? OR slug LIKE ? LIMIT 1',
    [candidate, `${candidate}-%`]
  );
  if (rows.length === 0) return candidate;
  let n = 2;
  while (true) {
    const trySlug = `${candidate}-${n}`;
    const [chk] = await pool.query<RowDataPacket[]>(
      'SELECT slug FROM tenants WHERE slug = ? LIMIT 1',
      [trySlug]
    );
    if (chk.length === 0) return trySlug;
    n++;
  }
}

router.get('/', requirePermission('tenants.view'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede ver el catálogo de empresas'
    );
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.name, t.slug, t.domain, t.status, t.email, t.phone,
            t.currency_code, t.country_code, t.language_code, t.timezone,
            t.trial_ends_at, t.suspended_at, t.suspended_reason, t.activated_at,
            t.created_at,
            (SELECT pl.name FROM subscriptions s
              JOIN plans pl ON pl.id = s.plan_id
             WHERE s.tenant_id = t.id AND s.status = 'ACTIVE' LIMIT 1) AS plan_name,
            (SELECT COUNT(*) FROM clients c
             WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) AS client_count,
            (SELECT COUNT(*) FROM users u
             WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS user_count
       FROM tenants t
      WHERE t.deleted_at IS NULL
      ORDER BY t.id`,
    []
  );
  res.json({ data: rows });
});

router.get('/:id', requirePermission('tenants.view'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede consultar la información de empresas'
    );
  }
  const tenantId = Number(req.params.id);
  const [tenantRows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.name, t.slug, t.domain, t.status, t.email, t.phone,
            t.currency_code, t.country_code, t.language_code, t.timezone,
            t.logo_url, t.trial_ends_at, t.suspended_at, t.suspended_by,
            t.suspended_reason, t.activated_at, t.created_at, t.updated_at
       FROM tenants t
      WHERE t.id = ? AND t.deleted_at IS NULL
      LIMIT 1`,
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');

  const [settingsRows] = await pool.query<RowDataPacket[]>(
    'SELECT tenant_id, grace_days, overdue_penalty, receipt_prefix, invoice_prefix FROM tenant_settings WHERE tenant_id = ?',
    [tenantId]
  );
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.plan_id, pl.name AS plan_name, pl.billing_cycle, s.status,
            s.current_period_start, s.current_period_end, s.canceled_at,
            s.ends_at, s.auto_renew
       FROM subscriptions s
       JOIN plans pl ON pl.id = s.plan_id
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL
      ORDER BY s.id DESC LIMIT 1`,
    [tenantId]
  );
  const [adminRows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email, u.status, u.last_login_at
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = ? AND u.deleted_at IS NULL AND r.slug = 'ADMIN'
      ORDER BY u.id LIMIT 1`,
    [tenantId]
  );
  const [historyRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, event_type, description, data, created_at
       FROM subscription_history
      WHERE tenant_id = ?
      ORDER BY id DESC LIMIT 30`,
    [tenantId]
  );
  const [paymentsRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, amount, currency_code, status, payment_method, reference,
            description, paid_at, created_at
       FROM payments
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 10`,
    [tenantId]
  );
  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.old_values,
            al.new_values, al.created_at, COALESCE(u.name, 'Sistema') AS user_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
      WHERE al.tenant_id = ?
      ORDER BY al.id DESC LIMIT 20`,
    [tenantId]
  );

  res.json({
    data: {
      ...tenant,
      settings: settingsRows[0] ?? null,
      subscription: subRows[0] ?? null,
      admin: adminRows[0] ?? null,
      history: historyRows,
      payments: paymentsRows,
      auditLogs: auditRows,
    },
  });
});

// --- CREAR EMPRESA ----------------------------------------------------------

router.post('/', requirePermission('tenants.create'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede crear empresas'
    );
  }
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw ApiError.badRequest('invalid_name', 'El nombre de la empresa es obligatorio');

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest('invalid_email', 'Correo de la empresa inválido');
  }
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() || null : null;
  const slug = await uniqueSlug(typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(name));

  const status = body.status === 'TRIAL' || body.status === 'PENDING' ? body.status : 'ACTIVE';
  const planId = Number(body.planId);
  const hasPlan = Number.isInteger(planId) && planId > 0;
  const plan = hasPlan ? await getPlanById(planId) : null;
  const periodMonths =
    Number.isInteger(Number(body.periodMonths)) && Number(body.periodMonths) > 0
      ? Number(body.periodMonths)
      : null;

  const adminName = typeof body.adminName === 'string' ? body.adminName.trim() : null;
  const adminEmail =
    typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : null;
  if ((adminName && !adminEmail) || (!adminName && adminEmail)) {
    throw ApiError.badRequest('invalid_admin', 'Indica nombre y correo del administrador, o ninguno');
  }
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw ApiError.badRequest('invalid_admin_email', 'Correo del administrador inválido');
  }
  const generatedPassword =
    typeof body.adminPassword === 'string' && body.adminPassword.trim().length >= 8
      ? body.adminPassword
      : undefined;

  if (adminEmail) {
    const [dup] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [adminEmail]
    );
    if (dup.length > 0) {
      throw ApiError.badRequest('email_in_use', 'El correo del administrador ya está registrado');
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tRes] = await conn.query<ResultSetHeader>(
      `INSERT INTO tenants
        (name, slug, domain, status, email, phone, currency_code, country_code,
         language_code, timezone, trial_ends_at, activated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DO', 'es', 'America/Santo_Domingo', ?, NOW())`,
      [
        name,
        slug,
        domain,
        status,
        email,
        phone,
        body.currency_code === 'USD' ? 'USD' : 'DOP',
        status === 'TRIAL' ? new Date(Date.now() + 14 * 86400000) : null,
      ]
    );
    const tenantId = tRes.insertId;

    await conn.query(
      `INSERT INTO tenant_settings
        (tenant_id, mdm_config, theme, grace_days, overdue_penalty, receipt_prefix,
         invoice_prefix, notifications, billing_config)
       VALUES (?, ?, '{"mode":"light"}', 3, 200.00, 'REC', 'INV', ?, ?)`,
      [
        tenantId,
        JSON.stringify(DEFAULT_MDM_CONFIG),
        JSON.stringify({ whatsapp: false, sms: false, email: false }),
        JSON.stringify({ preferredGateway: null, gateways: [] }),
      ]
    );

    let subscriptionId: number | null = null;
    let storageMb = 0;
    if (plan) {
      const cycle = plan.billing_cycle;
      const start = new Date();
      const end = periodMonths
        ? new Date(start.getFullYear(), start.getMonth() + periodMonths, start.getDate())
        : nextPeriodEnd(cycle, start);
      const [subRes] = await conn.query<ResultSetHeader>(
        `INSERT INTO subscriptions
          (tenant_id, plan_id, status, starts_at, current_period_start, current_period_end, auto_renew)
         VALUES (?, ?, 'ACTIVE', NOW(), NOW(), ?, 1)`,
        [tenantId, plan.id, end]
      );
      subscriptionId = subRes.insertId;
      await conn.query(
        `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
         VALUES (?, ?, 'CREATED', ?, JSON_OBJECT('planSlug', ?, 'createdBySuperAdmin', TRUE))`,
        [subscriptionId, tenantId, `Suscripción inicial: ${plan.name} (${cycle})`, plan.slug]
      );
      storageMb = Number(plan.storage_mb) || 0;
      await conn.query(
        'INSERT INTO storage (tenant_id, used_bytes, quota_bytes) VALUES (?, 0, ?)',
        [tenantId, storageMb * 1048576]
      );
      await conn.query(
        `INSERT INTO payments
          (tenant_id, subscription_id, gateway_id, user_id, amount, currency_code,
           status, payment_method, reference, description, paid_at)
         VALUES (?, ?, NULL, ?, ?, ?, 'PAID', 'card', ?, ?, NOW())`,
        [
          tenantId,
          subscriptionId,
          req.auth!.userId,
          plan.price,
          plan.currency_code,
          `REC-SAAS-${String(tenantId).padStart(4, '0')}-0001`,
          `Pago inicial del plan (${plan.slug})`,
        ]
      );
    }

    let adminUserId: number | null = null;
    let plainPassword: string | null = null;
    if (adminName && adminEmail) {
      plainPassword = generatedPassword ?? randomPassword();
      const passwordHash = await bcrypt.hash(plainPassword as string, 12);
      const [uRes] = await conn.query<ResultSetHeader>(
        `INSERT INTO users
          (tenant_id, name, email, email_verified_at, password_hash, status, must_change_password)
         VALUES (?, ?, ?, NOW(), ?, 'ACTIVE', ?)`,
        [tenantId, adminName, adminEmail, passwordHash, generatedPassword ? 0 : 1]
      );
      adminUserId = uRes.insertId;
      const [roleRows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM roles WHERE slug = 'ADMIN' AND tenant_id IS NULL LIMIT 1"
      );
      if (roleRows[0]) {
        await conn.query(
          'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (?, ?, ?)',
          [adminUserId, roleRows[0].id, tenantId]
        );
      }
    }

    await conn.commit();

    void recordAudit(
      {
        tenantId,
        userId: req.auth!.userId,
        action: 'tenant.create',
        entityType: 'tenant',
        entityId: String(tenantId),
        newValues: { name, slug, status, planId: plan?.id ?? null, adminEmail },
      },
      req
    );
    void recordActivity(
      tenantId,
      req.auth!.userId,
      'TENANT',
      `Empresa "${name}" creada desde el panel global`,
      req
    );

    const payload: Record<string, unknown> = {
      data: {
        tenantId,
        name,
        slug,
        status,
        subscriptionId,
        adminUserId,
      },
    };
    if (plainPassword) {
      payload.dev_password = plainPassword;
    }
    res.status(201).json(payload);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// --- EDITAR EMPRESA ---------------------------------------------------------

router.patch('/:id', requirePermission('tenants.edit'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede editar empresas'
    );
  }
  const tenantId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, slug, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');

  const body = req.body ?? {};
  const fields: string[] = [];
  const values: unknown[] = [];
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  const setField = (key: string, value: unknown, rawOld: unknown) => {
    fields.push(`${key} = ?`);
    values.push(value);
    oldValues[key] = rawOld;
    newValues[key] = value;
  };

  if (typeof body.name === 'string' && body.name.trim()) {
    setField('name', body.name.trim(), tenant.name);
  }
  if (typeof body.email === 'string' && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw ApiError.badRequest('invalid_email', 'Correo de la empresa inválido');
    }
    setField('email', email, tenant.email);
  }
  if (typeof body.phone === 'string') {
    setField('phone', body.phone.trim() || null, tenant.phone);
  }
  if (typeof body.domain === 'string') {
    const domain = body.domain.trim().toLowerCase() || null;
    if (domain) {
      const [dup] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM tenants WHERE domain = ? AND id <> ? LIMIT 1',
        [domain, tenantId]
      );
      if (dup.length > 0) throw ApiError.badRequest('domain_in_use', 'El dominio ya está en uso');
    }
    setField('domain', domain, tenant.domain);
  }
  if (body.currency_code === 'USD' || body.currency_code === 'DOP') {
    setField('currency_code', body.currency_code, tenant.currency_code);
  }
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    setField('timezone', body.timezone.trim(), tenant.timezone);
  }
  if (typeof body.language_code === 'string' && /^[a-z]{2}$/.test(body.language_code)) {
    setField('language_code', body.language_code, tenant.language_code);
  }
  if (body.status === 'ACTIVE' || body.status === 'TRIAL' || body.status === 'PENDING') {
    if (body.status !== tenant.status) {
      setField('status', body.status, tenant.status);
      setField('activated_at', body.status === 'ACTIVE' ? new Date() : null, tenant.activated_at);
      if (body.status === 'TRIAL') {
        setField('trial_ends_at', new Date(Date.now() + 14 * 86400000), tenant.trial_ends_at);
      }
    }
  }

  if (fields.length === 0) {
    res.json({ data: { tenantId, updated: false } });
    return;
  }
  values.push(tenantId);
  await pool.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`, values);

  void recordAudit(
    {
      tenantId,
      userId: req.auth!.userId,
      action: 'tenant.update',
      entityType: 'tenant',
      entityId: String(tenantId),
      oldValues,
      newValues,
    },
    req
  );
  void recordActivity(
    tenantId,
    req.auth!.userId,
    'TENANT',
    `Datos de la empresa "${tenant.name}" actualizados`,
    req
  );

  res.json({ data: { tenantId, updated: true } });
});

// --- SUSPENDER / REACTIVAR --------------------------------------------------

router.post('/:id/suspend', requirePermission('tenants.suspend'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede suspender empresas'
    );
  }
  const tenantId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');
  if (tenant.status === 'SUSPENDED') {
    throw ApiError.badRequest('already_suspended', 'La empresa ya está suspendida');
  }
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 500)
      : null;

  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM subscriptions
      WHERE tenant_id = ? AND deleted_at IS NULL AND status IN ('TRIAL','ACTIVE','PAST_DUE')
      ORDER BY id DESC LIMIT 1`,
    [tenantId]
  );
  const sub = subRows[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tenants SET status = 'SUSPENDED', suspended_at = NOW(),
              suspended_by = ?, suspended_reason = ?
        WHERE id = ?`,
      [req.auth!.userId, reason, tenantId]
    );
    if (sub) {
      await conn.query("UPDATE subscriptions SET status = 'SUSPENDED', updated_at = NOW() WHERE id = ?", [
        sub.id,
      ]);
      await conn.query(
        `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
         VALUES (?, ?, 'SUSPENDED', ?, JSON_OBJECT('reason', ?, 'by', ?))`,
        [
          sub.id,
          tenantId,
          reason ? `Suspensión manual: ${reason}` : 'Suspensión manual por el Super Administrador',
          reason,
          req.auth!.userId,
        ]
      );
    }
    await revokeTenantSessions(tenantId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  void recordAudit(
    {
      tenantId,
      userId: req.auth!.userId,
      action: 'tenant.suspend',
      entityType: 'tenant',
      entityId: String(tenantId),
      newValues: { reason, subscriptionId: sub?.id ?? null },
    },
    req
  );
  void recordActivity(
    tenantId,
    req.auth!.userId,
    'TENANT',
    reason ? `Empresa "${tenant.name}" suspendida: ${reason}` : `Empresa "${tenant.name}" suspendida`,
    req
  );

  res.json({ data: { tenantId, status: 'SUSPENDED' } });
});

router.post('/:id/reactivate', requirePermission('tenants.suspend'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede reactivar empresas'
    );
  }
  const tenantId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');
  if (tenant.status !== 'SUSPENDED') {
    throw ApiError.badRequest('not_suspended', 'La empresa no está suspendida');
  }

  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.status, s.current_period_end
       FROM subscriptions s
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.status = 'SUSPENDED'
      ORDER BY s.id DESC LIMIT 1`,
    [tenantId]
  );
  const sub = subRows[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tenants SET status = 'ACTIVE', suspended_at = NULL, suspended_by = NULL,
              suspended_reason = NULL, activated_at = NOW()
        WHERE id = ?`,
      [tenantId]
    );
    if (sub) {
      await conn.query("UPDATE subscriptions SET status = 'ACTIVE', updated_at = NOW() WHERE id = ?", [
        sub.id,
      ]);
      await conn.query(
        `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
         VALUES (?, ?, 'REACTIVATED', ?, JSON_OBJECT('by', ?))`,
        [sub.id, tenantId, 'Empresa reactivada por el Super Administrador', req.auth!.userId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  void recordAudit(
    {
      tenantId,
      userId: req.auth!.userId,
      action: 'tenant.reactivate',
      entityType: 'tenant',
      entityId: String(tenantId),
      newValues: { subscriptionId: sub?.id ?? null },
    },
    req
  );
  void recordActivity(
    tenantId,
    req.auth!.userId,
    'TENANT',
    `Empresa "${tenant.name}" reactivada`,
    req
  );

  res.json({ data: { tenantId, status: 'ACTIVE' } });
});

// --- ELIMINAR (SOFT DELETE) -------------------------------------------------

router.delete('/:id', requirePermission('tenants.edit'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede eliminar empresas'
    );
  }
  const tenantId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');

  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM subscriptions
      WHERE tenant_id = ? AND deleted_at IS NULL AND status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED')
      ORDER BY id DESC LIMIT 1`,
    [tenantId]
  );
  const sub = subRows[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE tenants SET deleted_at = NOW(), status = ? WHERE id = ?', [
      'SUSPENDED',
      tenantId,
    ]);
    if (sub) {
      await conn.query("UPDATE subscriptions SET status = 'CANCELED', ends_at = NOW(), updated_at = NOW() WHERE id = ?", [
        sub.id,
      ]);
      await conn.query(
        `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
         VALUES (?, ?, 'CANCELED', ?, JSON_OBJECT('reason', 'tenant_deleted', 'by', ?))`,
        [sub.id, tenantId, 'Suscripción cancelada por eliminación de la empresa', req.auth!.userId]
      );
    }
    await revokeTenantSessions(tenantId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  void recordAudit(
    {
      tenantId,
      userId: req.auth!.userId,
      action: 'tenant.delete',
      entityType: 'tenant',
      entityId: String(tenantId),
      oldValues: { name: tenant.name },
    },
    req
  );
  void recordActivity(
    null,
    req.auth!.userId,
    'TENANT',
    `Empresa "${tenant.name}" eliminada (soft delete)`,
    req
  );

  res.json({ data: { tenantId, deleted: true } });
});

router.post('/:id/switch', requirePermission('tenants.view'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede cambiar de empresa'
    );
  }
  const tenantId = Number(req.params.id);
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, status FROM tenants WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [tenantId]
  );
  const tenant = rows[0];
  if (!tenant) throw ApiError.notFound('Tenant no encontrado');
  if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
    throw ApiError.forbidden('tenant_suspended', 'El tenant está suspendido o pendiente');
  }

  // FASE 10 (auditoría SaaS): si la empresa tiene una suscripción vencida,
  // suspendida o cancelada, el Super Admin no puede "entrar" a operar con ella.
  const [subRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM subscriptions
      WHERE tenant_id = ? AND deleted_at IS NULL AND status IN
        ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','EXPIRED','CANCELED')
      ORDER BY id DESC LIMIT 1`,
    [tenantId]
  );
  const sub = subRows[0];
  if (sub && !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(String(sub.status))) {
    throw ApiError.forbidden(
      'subscription_inactive',
      `La suscripción de la empresa está ${String(sub.status).toLowerCase()}. Renueva o reactiva el plan antes de entrar.`
    );
  }

  await pool.query(
    'UPDATE sessions SET tenant_id = ? WHERE id = ? AND revoked_at IS NULL',
    [tenantId, req.auth!.sessionId]
  );

  void recordAudit(
    {
      tenantId,
      userId: req.auth!.userId,
      action: 'tenant.switch',
      entityType: 'tenant',
      entityId: String(tenantId),
      newValues: { tenantName: tenant.name },
    },
    req
  );
  void recordActivity(
    tenantId,
    req.auth!.userId,
    'TENANT',
    `Sesión cambiada a la empresa "${tenant.name}"`,
    req
  );

  res.json({ data: { tenantId, name: tenant.name } });
});

router.post('/exit', requirePermission('tenants.view'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden(
      'tenant_switch_forbidden',
      'Solo el Super Administrador global puede volver a la plataforma'
    );
  }

  await pool.query(
    'UPDATE sessions SET tenant_id = NULL WHERE id = ? AND revoked_at IS NULL',
    [req.auth!.sessionId]
  );

  void recordAudit(
    {
      tenantId: null,
      userId: req.auth!.userId,
      action: 'tenant.exit',
      entityType: 'tenant',
      entityId: undefined,
      newValues: { tenantName: 'Plataforma' },
    },
    req
  );
  void recordActivity(
    null,
    req.auth!.userId,
    'TENANT',
    'Sesión de plataforma restaurada (sin empresa activa)',
    req
  );

  res.json({ data: { tenantId: null } });
});

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default router;
