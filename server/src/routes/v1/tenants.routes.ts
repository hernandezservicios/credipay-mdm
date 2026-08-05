import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { pool } from '../../db/pool.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect);

// ---------------------------------------------------------------------------
// Empresas (tenants) — gestión y cambio de empresa activa (Super Admin)
// NOTA: no usa requireTenant porque el Super Admin global aún no tiene
// tenant activo cuando recién inicia sesión.
// ---------------------------------------------------------------------------

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
            t.trial_ends_at, t.created_at,
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
            t.logo_url, t.trial_ends_at, t.created_at, t.updated_at
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

  res.json({
    data: {
      ...tenant,
      settings: settingsRows[0] ?? null,
      subscription: subRows[0] ?? null,
    },
  });
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

export default router;
