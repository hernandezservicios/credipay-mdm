import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { pool } from '../../db/pool.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import {
  getActiveSubscription,
  getPlanById,
  getSubscriptionUsage,
  listActivePlans,
  listPlanFeatures,
  nextPeriodEnd,
  type BillingCycle,
} from '../../services/planService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect);

/**
 * Resuelve el tenant sobre el que opera una acción de plataforma:
 *  - Usuario de tenant (ADMIN local): siempre su propio tenant.
 *  - Super Admin global (tenantId === null): exige tenantId en el body
 *    para operar sobre la empresa indicada.
 */
export function resolvePlatformTenantId(req: AuthRequest, bodyTenantId?: unknown): number {
  if (req.auth!.tenantId !== null) {
    return req.auth!.tenantId;
  }
  const tenantId = Number(bodyTenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw ApiError.badRequest('tenant_required', 'Indica el tenantId objetivo (Super Admin global)');
  }
  return tenantId;
}

// ---------------------------------------------------------------------------
// SaaS Comercial (Fase 5): planes, suscripción, facturación y pasarelas
// ---------------------------------------------------------------------------

router.get('/plans', requirePermission('subscriptions.view'), async (_req: AuthRequest, res) => {
  const plans = await listActivePlans();
  const features = await listPlanFeatures(plans.map((p) => p.id));
  const byPlan = new Map<number, typeof features>();
  for (const f of features) {
    const list = byPlan.get(f.plan_id) ?? [];
    list.push(f);
    byPlan.set(f.plan_id, list);
  }
  res.json({ data: plans.map((p) => ({ ...p, features: byPlan.get(p.id) ?? [] })) });
});

// --- CRUD DE PLANES (Super Admin global) ------------------------------------

const PLAN_FIELDS = [
  'name', 'slug', 'description', 'billing_cycle', 'price', 'setup_fee',
  'currency_code', 'max_users', 'max_clients', 'max_credits', 'max_devices',
  'storage_mb', 'api_rate_limit_per_min', 'max_webhooks', 'status',
  'is_default', 'sort_order',
] as const;

type PlanInput = Record<string, unknown>;

export function parsePlanInput(body: PlanInput): { fields: string[]; values: unknown[] } {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of PLAN_FIELDS) {
    if (key === 'status') continue;
    if (key === 'is_default') continue;
    if (key === 'name' || key === 'slug') continue;
    const raw = body[key];
    if (raw === undefined) continue;
    switch (key) {
      case 'description':
      case 'currency_code': {
        const v = typeof raw === 'string' ? raw.trim() : null;
        if (key === 'description' && !v) {
          fields.push(key); values.push(null);
        } else if (v) {
          fields.push(key); values.push(v);
        }
        break;
      }
      case 'billing_cycle': {
        const cycle = typeof raw === 'string' ? raw.toUpperCase() : '';
        if (['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'].includes(cycle)) {
          fields.push(key); values.push(cycle);
        }
        break;
      }
      case 'price':
      case 'setup_fee': {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) { fields.push(key); values.push(n); }
        break;
      }
      default: {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 0) { fields.push(key); values.push(n); }
      }
    }
  }
  return { fields, values };
}

async function assertPlanSlugFree(slug: string, excludeId?: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM plans WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
    [slug]
  );
  if (rows[0] && rows[0].id !== excludeId) {
    throw ApiError.badRequest('slug_in_use', 'Ya existe un plan con ese slug');
  }
}

router.post('/plans', requirePermission('subscriptions.manage'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global puede gestionar el catálogo de planes');
  }
  const body = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw ApiError.badRequest('invalid_name', 'El nombre del plan es obligatorio');
  const slug = typeof body.slug === 'string' && body.slug.trim()
    ? body.slug.trim().toLowerCase()
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw ApiError.badRequest('invalid_slug', 'Slug inválido');
  await assertPlanSlugFree(slug);

  const { fields, values } = parsePlanInput(body);
  const cols = ['name', 'slug', ...fields];
  const vals = [name, slug, ...values];

  const [insertRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO plans (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals
  );
  const planId = insertRes.insertId;

  if (Array.isArray(body.features)) {
    for (const f of body.features) {
      if (!f || typeof f.feature_key !== 'string' || !f.feature_key.trim()) continue;
      await pool.query(
        `INSERT INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
         VALUES (?, ?, ?, ?, ?)`,
        [
          planId,
          f.feature_key.trim(),
          typeof f.feature_name === 'string' && f.feature_name.trim() ? f.feature_name.trim() : f.feature_key.trim(),
          f.feature_value != null ? String(f.feature_value) : null,
          f.is_enabled === 0 ? 0 : 1,
        ]
      );
    }
  }

  void recordAudit(
    { tenantId: null, userId: req.auth!.userId, action: 'plan.create', entityType: 'plan', entityId: String(planId), newValues: { name, slug } },
    req
  );
  void recordActivity(null, req.auth!.userId, 'BILLING', `Plan "${name}" creado en el catálogo`, req);
  res.status(201).json({ data: { planId, name, slug } });
});

router.patch('/plans/:id', requirePermission('subscriptions.manage'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global puede gestionar planes');
  }
  const planId = Number(req.params.id);
  const plan = await getPlanById(planId);
  const body = req.body ?? {};

  if (typeof body.slug === 'string' && body.slug.trim()) {
    await assertPlanSlugFree(body.slug.trim().toLowerCase(), planId);
  }

  const { fields, values } = parsePlanInput(body);
  if (fields.length > 0) {
    const sets = fields.map((f) => `${f} = ?`).join(', ');
    values.push(planId);
    await pool.query(`UPDATE plans SET ${sets}, updated_at = NOW() WHERE id = ?`, values);
  }

  if (Array.isArray(body.features)) {
    await pool.query('DELETE FROM plan_features WHERE plan_id = ?', [planId]);
    for (const f of body.features) {
      if (!f || typeof f.feature_key !== 'string' || !f.feature_key.trim()) continue;
      await pool.query(
        `INSERT INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
         VALUES (?, ?, ?, ?, ?)`,
        [
          planId,
          f.feature_key.trim(),
          typeof f.feature_name === 'string' && f.feature_name.trim() ? f.feature_name.trim() : f.feature_key.trim(),
          f.feature_value != null ? String(f.feature_value) : null,
          f.is_enabled === 0 ? 0 : 1,
        ]
      );
    }
  }

  void recordAudit(
    { tenantId: null, userId: req.auth!.userId, action: 'plan.update', entityType: 'plan', entityId: String(planId), newValues: { name: plan.name } },
    req
  );
  void recordActivity(null, req.auth!.userId, 'BILLING', `Plan "${plan.name}" actualizado`, req);
  res.json({ data: { planId, updated: true } });
});

router.post('/plans/:id/toggle', requirePermission('subscriptions.manage'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global puede gestionar planes');
  }
  const planId = Number(req.params.id);
  const plan = await getPlanById(planId);
  const next = plan.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  await pool.query("UPDATE plans SET status = ?, updated_at = NOW() WHERE id = ?", [next, planId]);
  void recordAudit(
    { tenantId: null, userId: req.auth!.userId, action: 'plan.toggle', entityType: 'plan', entityId: String(planId), oldValues: { status: plan.status }, newValues: { status: next } },
    req
  );
  void recordActivity(null, req.auth!.userId, 'BILLING', `Plan "${plan.name}" ${next === 'ACTIVE' ? 'activado' : 'desactivado'}`, req);
  res.json({ data: { planId, status: next } });
});

router.post('/plans/:id/duplicate', requirePermission('subscriptions.manage'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global puede gestionar planes');
  }
  const planId = Number(req.params.id);
  const plan = await getPlanById(planId);
  const [featRows] = await pool.query<RowDataPacket[]>(
    'SELECT feature_key, feature_name, feature_value, is_enabled FROM plan_features WHERE plan_id = ?',
    [planId]
  );
  const baseSlug = `${plan.slug}-copia`;
  let slug = baseSlug;
  let n = 2;
  while (true) {
    const [chk] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM plans WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
      [slug]
    );
    if (chk.length === 0) break;
    slug = `${baseSlug}-${n}`;
    n++;
  }
  const name = `${plan.name} (copia)`;

  const [cloneRes] = await pool.query<ResultSetHeader>(
    `INSERT INTO plans (name, slug, description, billing_cycle, price, setup_fee, currency_code,
       max_users, max_clients, max_credits, max_devices, storage_mb, api_rate_limit_per_min,
       max_webhooks, status, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INACTIVE', 0, ?)`,
    [
      name, slug, plan.description, plan.billing_cycle, plan.price, plan.setup_fee, plan.currency_code,
      plan.max_users, plan.max_clients, plan.max_credits, plan.max_devices, plan.storage_mb,
      plan.api_rate_limit_per_min, plan.max_webhooks, plan.sort_order + 1,
    ]
  );
  const newPlanId = cloneRes.insertId;
  for (const f of featRows) {
    await pool.query(
      `INSERT INTO plan_features (plan_id, feature_key, feature_name, feature_value, is_enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [newPlanId, f.feature_key, f.feature_name, f.feature_value, f.is_enabled]
    );
  }
  void recordAudit(
    { tenantId: null, userId: req.auth!.userId, action: 'plan.duplicate', entityType: 'plan', entityId: String(newPlanId), newValues: { fromPlanId: planId, name } },
    req
  );
  void recordActivity(null, req.auth!.userId, 'BILLING', `Plan "${plan.name}" duplicado como "${name}"`, req);
  res.status(201).json({ data: { planId: newPlanId, name, slug } });
});

router.delete('/plans/:id', requirePermission('subscriptions.manage'), async (req: AuthRequest, res) => {
  if (req.auth!.userTenantId !== null) {
    throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global puede eliminar planes');
  }
  const planId = Number(req.params.id);
  const plan = await getPlanById(planId);
  const [used] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM subscriptions
      WHERE plan_id = ? AND deleted_at IS NULL AND status IN ('TRIAL','ACTIVE','PAST_DUE')`,
    [planId]
  );
  if (Number(used[0]?.total) > 0) {
    throw ApiError.badRequest('plan_in_use', 'El plan está asignado a empresas activas. Desactívalo en lugar de eliminarlo.');
  }
  await pool.query('UPDATE plans SET deleted_at = NOW(), status = ?, updated_at = NOW() WHERE id = ?', [
    'INACTIVE',
    planId,
  ]);
  void recordAudit(
    { tenantId: null, userId: req.auth!.userId, action: 'plan.delete', entityType: 'plan', entityId: String(planId), oldValues: { name: plan.name } },
    req
  );
  void recordActivity(null, req.auth!.userId, 'BILLING', `Plan "${plan.name}" eliminado (soft delete)`, req);
  res.json({ data: { planId, deleted: true } });
});

// --- SUSCRIPCIÓN ------------------------------------------------------------

router.get(
  '/subscriptions/current',
  requireTenant,
  requirePermission('subscriptions.view'),
  async (req: TenantRequest, res) => {
    const tenantId = req.ctx!.tenantId;
    const [subscription, usage] = await Promise.all([
      getActiveSubscription(tenantId),
      getSubscriptionUsage(tenantId),
    ]);
    res.json({ data: { subscription, usage } });
  }
);

router.post(
  '/subscriptions/change',
  requirePermission('subscriptions.manage'),
  async (req: AuthRequest, res) => {
    const tenantId = resolvePlatformTenantId(req, req.body?.tenantId);
    const planId = Number(req.body?.planId);
    if (!Number.isInteger(planId) || planId <= 0) {
      res.status(400).json({ error: 'invalid_plan', message: 'Plan inválido' });
      return;
    }
    const plan = await getPlanById(planId);
    const current = await getActiveSubscription(tenantId);
    if (!current) {
      res.status(409).json({ error: 'no_subscription', message: 'Sin suscripción activa' });
      return;
    }
    if (plan.id === current.plan_id) {
      res.status(400).json({ error: 'same_plan', message: 'Ya estás en este plan' });
      return;
    }

    // No permitir bajar a un plan cuyos límites ya supera el uso actual.
    const usage = await getSubscriptionUsage(tenantId);
    const underLimit =
      (plan.max_clients === 0 || usage.clients <= plan.max_clients) &&
      (plan.max_credits === 0 || usage.credits <= plan.max_credits) &&
      (plan.max_devices === 0 || usage.devices <= plan.max_devices) &&
      (plan.max_users === 0 || usage.users <= plan.max_users);
    if (!underLimit) {
      throw ApiError.forbidden(
        'plan_usage_exceeds_limits',
        'El uso actual supera los límites del plan seleccionado. Libera recursos o elige un plan superior.'
      );
    }

    await pool.query(
      'UPDATE subscriptions SET plan_id = ?, updated_at = NOW() WHERE id = ?',
      [plan.id, current.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'PLAN_CHANGED', ?, JSON_OBJECT('from_plan', ?, 'to_plan', ?, 'planSlug', ?))`,
      [
        current.subscription_id,
        tenantId,
        `Plan cambiado de "${current.plan_name}" a "${plan.name}"`,
        current.plan_name,
        plan.name,
        plan.slug,
      ]
    );
    void recordAudit(
      {
        tenantId,
        userId: req.auth!.userId,
        action: 'SUBSCRIPTION_PLAN_CHANGED',
        entityType: 'subscription',
        entityId: String(current.subscription_id),
        newValues: { planId: plan.id, planName: plan.name },
      },
      req as AuthRequest
    );
    void recordActivity(
      tenantId,
      req.auth!.userId,
      'BILLING',
      `Suscripción actualizada a: ${plan.name} (${plan.billing_cycle})`,
      req as AuthRequest
    );
    res.json({ data: { subscriptionId: current.subscription_id, planId: plan.id, planName: plan.name } });
  }
);

router.post(
  '/subscriptions/renew',
  requirePermission('billing.manage'),
  async (req: AuthRequest, res) => {
    const tenantId = resolvePlatformTenantId(req, req.body?.tenantId);
    const current = await getActiveSubscription(tenantId);
    if (!current) {
      res.status(409).json({ error: 'no_subscription', message: 'Sin suscripción activa' });
      return;
    }
    if (current.status !== 'ACTIVE' && current.status !== 'TRIAL' && current.status !== 'PAST_DUE') {
      res.status(409).json({ error: 'subscription_not_active', message: 'El plan no está activo' });
      return;
    }

    const now = new Date();
    const previousEnd = new Date(current.current_period_end);
    const nextEnd = nextPeriodEnd(current.billing_cycle, previousEnd.getTime() > now.getTime() ? previousEnd : now);

    const [insertRes] = await pool.query<ResultSetHeader>(
      `INSERT INTO payments
        (tenant_id, subscription_id, gateway_id, user_id, amount, currency_code,
         status, payment_method, reference, description, paid_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'PAID', ?, ?, ?, NOW())`,
      [
        tenantId,
        current.subscription_id,
        req.auth!.userId,
        current.price,
        current.currency_code,
        'card',
        `REC-SAAS-${String(Date.now()).slice(-8)}`,
        `Renovación ${current.plan_name} (${current.billing_cycle})`,
      ]
    );
    await pool.query(
      `UPDATE subscriptions
          SET status = 'ACTIVE', current_period_start = NOW(), current_period_end = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [nextEnd, current.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'PAYMENT_SUCCEEDED', ?, JSON_OBJECT('amount', ?, 'periodEnd', ?))`,
      [
        current.subscription_id,
        tenantId,
        `Pago de renovación recibido (${current.plan_name}, ciclo ${current.billing_cycle})`,
        current.price,
        nextEnd.toISOString(),
      ]
    );
    void recordAudit(
      {
        tenantId,
        userId: req.auth!.userId,
        action: 'SUBSCRIPTION_RENEWED',
        entityType: 'subscription',
        entityId: String(current.subscription_id),
        newValues: { paymentId: insertRes.insertId, periodEnd: nextEnd.toISOString() },
      },
      req as AuthRequest
    );
    void recordActivity(
      tenantId,
      req.auth!.userId,
      'BILLING',
      `Suscripción renovada hasta ${nextEnd.toLocaleDateString('es-DO')}`,
      req as AuthRequest
    );
    res.json({
      data: { paymentId: insertRes.insertId, planName: current.plan_name, periodEnd: nextEnd.toISOString() },
    });
  }
);

// --- OPERACIONES DE PLATAFORMA (Super Admin global) -------------------------

router.post(
  '/subscriptions/cancel',
  requirePermission('subscriptions.manage'),
  async (req: AuthRequest, res) => {
    const tenantId = resolvePlatformTenantId(req, req.body?.tenantId);
    const current = await getActiveSubscription(tenantId);
    if (!current) {
      res.status(409).json({ error: 'no_subscription', message: 'Sin suscripción activa' });
      return;
    }
    await pool.query(
      `UPDATE subscriptions
          SET status = 'CANCELED', canceled_at = NOW(), ends_at = current_period_end,
              updated_at = NOW()
        WHERE id = ?`,
      [current.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'CANCELED', ?, JSON_OBJECT('reason', 'manual_superadmin'))`,
      [current.subscription_id, tenantId, `Suscripción cancelada (${current.plan_name}). Vigente hasta ${current.current_period_end.toISOString()}`]
    );
    void recordAudit(
      { tenantId, userId: req.auth!.userId, action: 'SUBSCRIPTION_CANCELED', entityType: 'subscription', entityId: String(current.subscription_id), newValues: { planName: current.plan_name } },
      req as AuthRequest
    );
    void recordActivity(tenantId, req.auth!.userId, 'BILLING', `Suscripción cancelada (${current.plan_name})`, req as AuthRequest);
    res.json({ data: { subscriptionId: current.subscription_id, status: 'CANCELED' } });
  }
);

router.post(
  '/subscriptions/extend',
  requirePermission('subscriptions.manage'),
  async (req: AuthRequest, res) => {
    const tenantId = resolvePlatformTenantId(req, req.body?.tenantId);
    const current = await getActiveSubscription(tenantId);
    if (!current) {
      res.status(409).json({ error: 'no_subscription', message: 'Sin suscripción activa' });
      return;
    }
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw ApiError.badRequest('invalid_days', 'Días debe ser un entero entre 1 y 365');
    }
    const previousEnd = new Date(current.current_period_end);
    const now = new Date();
    const base = previousEnd.getTime() > now.getTime() ? previousEnd : now;
    const newEnd = new Date(base.getTime() + days * 86400000);
    await pool.query(
      `UPDATE subscriptions
          SET status = 'ACTIVE', current_period_end = ?, updated_at = NOW()
        WHERE id = ?`,
      [newEnd, current.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'RENEWED', ?, JSON_OBJECT('daysAdded', ?, 'periodEnd', ?))`,
      [
        current.subscription_id,
        tenantId,
        `Período extendido ${days} día(s) (${current.plan_name})`,
        days,
        newEnd.toISOString(),
      ]
    );
    void recordAudit(
      { tenantId, userId: req.auth!.userId, action: 'SUBSCRIPTION_EXTENDED', entityType: 'subscription', entityId: String(current.subscription_id), newValues: { days, periodEnd: newEnd.toISOString() } },
      req as AuthRequest
    );
    void recordActivity(tenantId, req.auth!.userId, 'BILLING', `Suscripción extendida ${days} día(s)`, req as AuthRequest);
    res.json({ data: { subscriptionId: current.subscription_id, periodEnd: newEnd.toISOString() } });
  }
);

// --- FACTURACIÓN ------------------------------------------------------------

router.get(
  '/billing/payments',
  requireTenant,
  requirePermission('billing.view'),
  async (req: TenantRequest, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.amount, p.currency_code, p.status, p.payment_method,
              p.reference, p.description, p.paid_at, p.created_at,
              pl.name AS plan_name
         FROM payments p
         LEFT JOIN subscriptions s ON s.id = p.subscription_id
         LEFT JOIN plans pl ON pl.id = s.plan_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT 25`,
      [req.ctx!.tenantId]
    );
    res.json({ data: rows });
  }
);

// --- PASARELAS --------------------------------------------------------------

function parseBillingConfig(value: string | Record<string, unknown> | null | undefined): {
  preferredGateway: string | null;
  gateways: Record<string, unknown>[];
} {
  if (!value) return { preferredGateway: null, gateways: [] };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return {
      preferredGateway: parsed.preferredGateway ?? null,
      gateways: Array.isArray(parsed.gateways) ? parsed.gateways : [],
    };
  } catch {
    return { preferredGateway: null, gateways: [] };
  }
}

router.get(
  '/billing/gateways',
  requireTenant,
  requirePermission('subscriptions.view'),
  async (req: TenantRequest, res) => {
    const [gateways] = await pool.query<RowDataPacket[]>(
      'SELECT id, code, name, is_active FROM payment_gateways ORDER BY name'
    );
    const [settings] = await pool.query<RowDataPacket[]>(
      'SELECT billing_config FROM tenant_settings WHERE tenant_id = ?',
      [req.ctx!.tenantId]
    );
    const config = parseBillingConfig(settings[0]?.billing_config);
    res.json({ data: { gateways, config } });
  }
);

router.post(
  '/billing/gateways',
  requireTenant,
  requirePermission('gateway.config'),
  async (req: TenantRequest, res) => {
    const code = typeof req.body?.preferredGateway === 'string' ? req.body.preferredGateway : null;
    if (code) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM payment_gateways WHERE code = ? AND is_active = 1',
        [code]
      );
      if (!rows[0]) {
        res.status(400).json({ error: 'invalid_gateway', message: 'Pasarela no válida' });
        return;
      }
    }
    const [settings] = await pool.query<RowDataPacket[]>(
      'SELECT billing_config FROM tenant_settings WHERE tenant_id = ?',
      [req.ctx!.tenantId]
    );
    const config = parseBillingConfig(settings[0]?.billing_config);
    config.preferredGateway = code ?? config.preferredGateway;
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, billing_config) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE billing_config = VALUES(billing_config)`,
      [req.ctx!.tenantId, JSON.stringify(config)]
    );
    void recordActivity(
      req.ctx!.tenantId,
      req.auth!.userId,
      'BILLING',
      code ? `Pasarela preferida configurada: ${code}` : 'Pasarela preferida limpiada',
      req as AuthRequest
    );
    res.json({ data: config });
  }
);

// --- SUPERVISIÓN DE PLATAFORMA (Super Admin global) -------------------------

router.get(
  '/platform/overview',
  requirePermission('subscriptions.view'),
  async (req: AuthRequest, res) => {
    if (req.auth!.userTenantId !== null) {
      throw ApiError.forbidden('tenant_switch_forbidden', 'Solo el Super Administrador global');
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id AS tenant_id, t.name, t.slug, t.status AS tenant_status,
              t.currency_code, t.suspended_at, t.suspended_reason,
              s.id AS subscription_id, s.status AS subscription_status,
              s.current_period_start, s.current_period_end, s.canceled_at, s.auto_renew,
              pl.name AS plan_name, pl.slug AS plan_slug, pl.billing_cycle,
              pl.price, pl.max_clients, pl.max_devices, pl.max_users,
              (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) AS client_count,
              (SELECT COUNT(*) FROM credits cr WHERE cr.tenant_id = t.id AND cr.deleted_at IS NULL) AS credit_count,
              (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id AND d.deleted_at IS NULL) AS device_count,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS user_count,
              (SELECT COUNT(*) FROM credit_installments ci
                WHERE ci.tenant_id = t.id AND ci.status = 'ATRASADO') AS overdue_installments,
              (SELECT COALESCE(SUM(pr.amount), 0) FROM payments_received pr
                WHERE pr.tenant_id = t.id AND pr.received_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS collected_month,
              (SELECT COALESCE(SUM(pr.amount), 0) FROM payments_received pr
                WHERE pr.tenant_id = t.id) AS collected_total
         FROM tenants t
         LEFT JOIN subscriptions s
           ON s.tenant_id = t.id AND s.deleted_at IS NULL
          AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')
         LEFT JOIN plans pl ON pl.id = s.plan_id
        WHERE t.deleted_at IS NULL
        ORDER BY t.id`,
      []
    );
    res.json({ data: rows });
  }
);

export default router;