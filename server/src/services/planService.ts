import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';

// ---------------------------------------------------------------------------
// SaaS Comercial (Fase 5): planes, suscripción activa, uso y límites por plan
// ---------------------------------------------------------------------------

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export interface PlanRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  billing_cycle: BillingCycle;
  price: string;
  setup_fee: string;
  currency_code: string;
  max_users: number;
  max_clients: number;
  max_credits: number;
  max_devices: number;
  storage_mb: number;
  api_rate_limit_per_min: number;
  max_webhooks: number;
  status: string;
  is_default: number;
  sort_order: number;
}

export interface PlanFeatureRow extends RowDataPacket {
  plan_id: number;
  feature_key: string;
  feature_name: string;
  feature_value: string | null;
  is_enabled: number;
}

export interface ActiveSubscriptionRow extends RowDataPacket {
  subscription_id: number;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED' | 'EXPIRED';
  starts_at: Date;
  current_period_start: Date;
  current_period_end: Date;
  canceled_at: Date | null;
  ends_at: Date | null;
  auto_renew: number;
  plan_id: number;
  plan_name: string;
  plan_slug: string;
  billing_cycle: BillingCycle;
  price: string;
  setup_fee: string;
  currency_code: string;
  description: string | null;
  max_users: number;
  max_clients: number;
  max_credits: number;
  max_devices: number;
  storage_mb: number;
  api_rate_limit_per_min: number;
  max_webhooks: number;
}

export interface SubscriptionUsage {
  clients: number;
  credits: number;
  devices: number;
  users: number;
}

export type PlanResource = 'clients' | 'credits' | 'devices' | 'users';

const RESOURCE_COLUMN: Record<PlanResource, keyof ActiveSubscriptionRow> = {
  clients: 'max_clients',
  credits: 'max_credits',
  devices: 'max_devices',
  users: 'max_users',
};

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMI_ANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

export async function listActivePlans(): Promise<PlanRow[]> {
  const [rows] = await pool.query<PlanRow[]>(
    `SELECT id, name, slug, description, billing_cycle, price, setup_fee, currency_code,
            max_users, max_clients, max_credits, max_devices, storage_mb,
            api_rate_limit_per_min, max_webhooks, status, is_default, sort_order
       FROM plans
      WHERE status = 'ACTIVE' AND deleted_at IS NULL
      ORDER BY sort_order, id`,
    []
  );
  return rows;
}

export async function listPlanFeatures(planIds: number[]): Promise<PlanFeatureRow[]> {
  if (planIds.length === 0) return [];
  const [rows] = await pool.query<PlanFeatureRow[]>(
    `SELECT plan_id, feature_key, feature_name, feature_value, is_enabled
       FROM plan_features
      WHERE plan_id IN (?)
      ORDER BY plan_id, feature_name`,
    [planIds]
  );
  return rows;
}

export async function getPlanById(planId: number): Promise<PlanRow> {
  const [rows] = await pool.query<PlanRow[]>(
    `SELECT id, name, slug, description, billing_cycle, price, setup_fee, currency_code,
            max_users, max_clients, max_credits, max_devices, storage_mb,
            api_rate_limit_per_min, max_webhooks, status, is_default, sort_order
       FROM plans
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [planId]
  );
  const plan = rows[0];
  if (!plan) throw ApiError.notFound('Plan no encontrado');
  return plan;
}

/**
 * Devuelve la suscripción vigente (TRIAL/ACTIVE/PAST_DUE) del tenant con el plan
 * asociado, o null si no tiene una (tenant recién creado sin plan asignado).
 */
export async function getActiveSubscription(tenantId: number): Promise<ActiveSubscriptionRow | null> {
  const [rows] = await pool.query<ActiveSubscriptionRow[]>(
    `SELECT s.id AS subscription_id, s.status, s.starts_at,
            s.current_period_start, s.current_period_end, s.canceled_at, s.ends_at,
            s.auto_renew,
            pl.id AS plan_id, pl.name AS plan_name, pl.slug AS plan_slug,
            pl.billing_cycle, pl.price, pl.setup_fee, pl.currency_code,
            pl.description,
            pl.max_users, pl.max_clients, pl.max_credits, pl.max_devices,
            pl.storage_mb, pl.api_rate_limit_per_min, pl.max_webhooks
       FROM subscriptions s
       JOIN plans pl ON pl.id = s.plan_id
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL
        AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')
      ORDER BY s.id DESC
      LIMIT 1`,
    [tenantId]
  );
  return rows[0] ?? null;
}

export async function getSubscriptionUsage(tenantId: number): Promise<SubscriptionUsage> {
  const [[clientRows], [creditRows], [deviceRows], [userRows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM clients WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]
    ),
    pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM credits WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]
    ),
    pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM devices WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]
    ),
    pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM users WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]
    ),
  ]);
  return {
    clients: clientRows[0].total,
    credits: creditRows[0].total,
    devices: deviceRows[0].total,
    users: userRows[0].total,
  };
}

function parseNum(value: string | number): number {
  return typeof value === 'number' ? value : Number(value) || 0;
}

/**
 * Valida que el tenant no exceda el límite del plan para un recurso.
 * Lanza 403 plan_limit_reached si el uso actual (incluyendo el nuevo registro)
 * supera el tope configurado en el plan activo.
 */
export async function assertPlanLimit(
  tenantId: number,
  resource: PlanResource,
  extra = 1
): Promise<void> {
  const subscription = await getActiveSubscription(tenantId);
  if (!subscription) return;
  const maxKey = RESOURCE_COLUMN[resource];
  const max = parseNum(subscription[maxKey]);
  if (max <= 0) return; // 0 = ilimitado
  const usage = await getSubscriptionUsage(tenantId);
  const current = usage[resource];
  if (current + extra > max) {
    throw ApiError.forbidden(
      'plan_limit_reached',
      `Límite del plan alcanzado: ${resource} (${current} de ${max}). Actualiza tu plan para continuar.`
    );
  }
}

export function nextPeriodEnd(cycle: BillingCycle, from: Date): Date {
  const end = new Date(from);
  switch (cycle) {
    case 'MONTHLY':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'QUARTERLY':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'SEMI_ANNUAL':
      end.setMonth(end.getMonth() + 6);
      break;
    case 'ANNUAL':
      end.setFullYear(end.getFullYear() + 1);
      break;
  }
  return end;
}
