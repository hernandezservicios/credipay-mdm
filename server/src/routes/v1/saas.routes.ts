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
  requireTenant,
  requirePermission('subscriptions.manage'),
  async (req: TenantRequest, res) => {
    const tenantId = req.ctx!.tenantId;
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
  requireTenant,
  requirePermission('billing.manage'),
  async (req: TenantRequest, res) => {
    const tenantId = req.ctx!.tenantId;
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
              t.currency_code,
              s.id AS subscription_id, s.status AS subscription_status,
              s.current_period_start, s.current_period_end, s.canceled_at, s.auto_renew,
              pl.name AS plan_name, pl.slug AS plan_slug, pl.billing_cycle,
              pl.price, pl.max_clients, pl.max_devices, pl.max_users,
              (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL) AS client_count
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