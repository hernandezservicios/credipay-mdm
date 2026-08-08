// ============================================================================
// CrediPay MDM - Fase 8
// scheduler.ts
// Daemon de tareas automáticas (arrancado desde server.ts si está habilitado):
//  - Nexts diarios de cobranza por tenant (hora configurable).
//  - Respaldo automático diario (hora configurable).
//  - Procesa recordatorios de cobranza cuyo scheduled_at ya venció.
//  - Ejecuta la cola de jobs (incluye los reintentos de webhooks).
// ============================================================================

import type { RowDataPacket } from 'mysql2';
import { pool } from './db/pool.js';
import { env } from './config/env.js';
import { enqueueJob, jobPending, processPendingJobs } from './services/jobService.js';
import { getSettingBoolean, getSettingNumber } from './services/settingsService.js';
import { processDueReminders, runCollectionEngine } from './services/collectionService.js';
import { runBackup } from './services/backupService.js';
import { runOverdueEngine } from './services/loanService.js';
import { deliverDelivery } from './services/webhookService.js';
import { recordAudit } from './services/auditService.js';
import { revokeTenantSessions } from './services/tenantService.js';

const TICK_BASE_MS = 60_000;

let interval: NodeJS.Timeout | null = null;
let ticking = false;

interface JobHandlers {
  'collection.run_daily': (p: Record<string, unknown>) => Promise<void>;
  'backup.run_daily': (p: Record<string, unknown>) => Promise<void>;
  'webhook.deliver': (p: Record<string, unknown>) => Promise<void>;
}

const handlers: JobHandlers = {
  'collection.run_daily': async (p) => {
    const tenantId = Number(p.tenantId);
    if (!Number.isInteger(tenantId)) throw new Error('payload.tenantId inválido');
    await runCollectionEngine(tenantId, null, 'SCHEDULED');
  },
  'backup.run_daily': async () => {
    await runBackup('FULL', null);
  },
  'webhook.deliver': async (p) => {
    const deliveryId = Number(p.deliveryId);
    if (!Number.isInteger(deliveryId)) throw new Error('payload.deliveryId inválido');
    await deliverDelivery(deliveryId);
  },
};

/** Encola el job diario de cobranza por tenant activo si toca su hora. */
async function ensureDailyCollectionJobs(): Promise<void> {
  const hour = await getSettingNumber('scheduler.collection_hour', 9);
  if (new Date().getHours() !== hour) return;
  const [tenants] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM tenants WHERE status = 'ACTIVE' AND deleted_at IS NULL`
  );
  for (const t of tenants) {
    const id = Number(t.id);
    if (await jobPending('collection.run_daily', 'tenantId', id)) continue;
    await enqueueJob({
      jobName: 'collection.run_daily',
      queue: 'collection',
      payload: { tenantId: id },
      maxAttempts: 2,
    });
  }
}

/** Encola el respaldo diario si toca su hora y no hay uno pendiente. */
async function ensureDailyBackupJob(): Promise<void> {
  const hour = await getSettingNumber('backups.hour', 3);
  if (new Date().getHours() !== hour) return;
  if (await jobPending('backup.run_daily', null, '')) return;
  await enqueueJob({ jobName: 'backup.run_daily', queue: 'backups', maxAttempts: 3 });
}

/**
 * Motor de mora automática (diario): aplica penalizaciones
 * configurables por tenant (monto fijo o porcentaje sobre capital/
 * cuota/saldo, días de gracia, frecuencia y tope máximo) a las
 * cuotas vencidas, actualiza estados y bloquea dispositivos por mora.
 */
async function runDailyOverdueEngine(): Promise<void> {
  const [tenants] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM tenants WHERE status = 'ACTIVE' AND deleted_at IS NULL`
  );
  let totalPenalized = 0;
  let totalDefaulted = 0;
  for (const t of tenants) {
    try {
      const result = await runOverdueEngine(Number(t.id));
      totalPenalized += result.penalized;
      totalDefaulted += result.defaulted;
    } catch (err) {
      console.error(`[scheduler] motor de mora tenant ${t.id}:`, err);
    }
  }
  if (totalPenalized + totalDefaulted > 0) {
    console.log(
      `[scheduler] motor de mora: ${totalPenalized} cuota(s) penalizada(s), ${totalDefaulted} crédito(s) en default`
    );
  }
}

/**
 * Expiración automática de suscripciones (diaria):
 *  - ACTIVE con auto_renew=0 y período vencido  -> suscripción EXPIRED y el
 *    tenant se marca SUSPENDED (acceso bloqueado hasta renovar/reactivar).
 *  - TRIAL con trial_ends_at vencido            -> suscripción EXPIRED y el
 *    tenant se marca SUSPENDED.
 *  - PAST_DUE que excede la gracia (3 días)     -> suscripción SUSPENDED y
 *    el tenant también se marca SUSPENDED.
 * Cada cambio se registra en subscription_history y audit_logs, y las
 * sesiones de acceso del tenant se revocan.
 */
async function expireSubscriptions(): Promise<void> {
  const now = new Date();

  /** FASE 10 (auditoría SaaS): suspende el tenant y revoca sus sesiones
   *  cuando la suscripción queda vencida/suspendida, bloqueando el acceso
   *  hasta que el Super Admin la reactive o renueve. */
  const suspendTenantOnExpiry = async (tenantId: number, reason: string): Promise<void> => {
    await pool.query(
      `UPDATE tenants
          SET status = 'SUSPENDED', suspended_at = NOW(), suspended_by = NULL,
              suspended_reason = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL`,
      [reason, tenantId]
    );
    await revokeTenantSessions(tenantId);
  };

  const [noRenewExpired] = await pool.query<RowDataPacket[]>(
    `SELECT s.id AS subscription_id, s.tenant_id, pl.name AS plan_name, pl.slug AS plan_slug
       FROM subscriptions s
       JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'ACTIVE' AND s.auto_renew = 0
        AND s.current_period_end < NOW()
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscription_history sh
           WHERE sh.subscription_id = s.id AND sh.event_type = 'EXPIRED'
        )`,
    []
  );
  for (const sub of noRenewExpired) {
    await pool.query(
      `UPDATE subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = ?`,
      [sub.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'EXPIRED', ?, JSON_OBJECT('trigger', 'auto_renew_off'))`,
      [sub.subscription_id, sub.tenant_id, `Período vencido sin renovación automática (${sub.plan_name})`]
    );
    void recordAudit({
      tenantId: sub.tenant_id,
      userId: null,
      action: 'SUBSCRIPTION_EXPIRED',
      entityType: 'subscription',
      entityId: String(sub.subscription_id),
      newValues: { planName: sub.plan_name, trigger: 'auto_renew_off' },
    });
    await suspendTenantOnExpiry(
      sub.tenant_id,
      'Suscripción vencida sin renovación. Contacta al Super Administrador para reactivar.'
    );
    void recordAudit({
      tenantId: sub.tenant_id,
      userId: null,
      action: 'TENANT_SUSPENDED_BILLING',
      entityType: 'tenant',
      entityId: String(sub.tenant_id),
      newValues: { planName: sub.plan_name, trigger: 'subscription_expired' },
    });
  }

  const [trialsExpired] = await pool.query<RowDataPacket[]>(
    `SELECT t.id AS tenant_id, t.name AS tenant_name,
            s.id AS subscription_id, s.status, pl.name AS plan_name
       FROM tenants t
       JOIN subscriptions s ON s.tenant_id = t.id AND s.deleted_at IS NULL
       JOIN plans pl ON pl.id = s.plan_id
      WHERE t.status IN ('TRIAL','ACTIVE') AND t.deleted_at IS NULL
        AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at < NOW()
        AND s.status = 'TRIAL'
        AND NOT EXISTS (
          SELECT 1 FROM subscription_history sh
           WHERE sh.subscription_id = s.id AND sh.event_type = 'EXPIRED'
        )`,
    []
  );
  for (const row of trialsExpired) {
    await pool.query(
      `UPDATE subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = ?`,
      [row.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'EXPIRED', ?, JSON_OBJECT('trigger', 'trial_ended'))`,
      [row.subscription_id, row.tenant_id, `Prueba gratuita finalizada (${row.plan_name})`]
    );
    void recordAudit({
      tenantId: row.tenant_id,
      userId: null,
      action: 'SUBSCRIPTION_EXPIRED',
      entityType: 'subscription',
      entityId: String(row.subscription_id),
      newValues: { planName: row.plan_name, trigger: 'trial_ended' },
    });
    await suspendTenantOnExpiry(
      row.tenant_id,
      'Prueba gratuita finalizada. Activa un plan para continuar operando.'
    );
    void recordAudit({
      tenantId: row.tenant_id,
      userId: null,
      action: 'TENANT_SUSPENDED_BILLING',
      entityType: 'tenant',
      entityId: String(row.tenant_id),
      newValues: { planName: row.plan_name, trigger: 'trial_expired' },
    });
  }

  const [pastDueSuspended] = await pool.query<RowDataPacket[]>(
    `SELECT s.id AS subscription_id, s.tenant_id, pl.name AS plan_name
       FROM subscriptions s
       JOIN plans pl ON pl.id = s.plan_id
      WHERE s.status = 'PAST_DUE' AND s.current_period_end < DATE_SUB(NOW(), INTERVAL 3 DAY)
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscription_history sh
           WHERE sh.subscription_id = s.id AND sh.event_type = 'SUSPENDED'
        )`,
    []
  );
  for (const sub of pastDueSuspended) {
    await pool.query(
      `UPDATE subscriptions SET status = 'SUSPENDED', updated_at = NOW() WHERE id = ?`,
      [sub.subscription_id]
    );
    await pool.query(
      `INSERT INTO subscription_history (subscription_id, tenant_id, event_type, description, data)
       VALUES (?, ?, 'SUSPENDED', ?, JSON_OBJECT('trigger', 'grace_exceeded'))`,
      [sub.subscription_id, sub.tenant_id, `Período vencido superó la gracia; suscripción suspendida (${sub.plan_name})`]
    );
    void recordAudit({
      tenantId: sub.tenant_id,
      userId: null,
      action: 'SUBSCRIPTION_SUSPENDED',
      entityType: 'subscription',
      entityId: String(sub.subscription_id),
      newValues: { planName: sub.plan_name, trigger: 'grace_exceeded' },
    });
    await suspendTenantOnExpiry(
      sub.tenant_id,
      'Suscripción suspendida por falta de pago (período de gracia excedido).'
    );
    void recordAudit({
      tenantId: sub.tenant_id,
      userId: null,
      action: 'TENANT_SUSPENDED_BILLING',
      entityType: 'tenant',
      entityId: String(sub.tenant_id),
      newValues: { planName: sub.plan_name, trigger: 'grace_exceeded' },
    });
  }

  if (noRenewExpired.length + trialsExpired.length + pastDueSuspended.length > 0) {
    console.log(
      `[scheduler] expiración: ${noRenewExpired.length} sin renovar, ${trialsExpired.length} trials, ${pastDueSuspended.length} morosos suspendidos`
    );
  }
}

async function runTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await ensureDailyCollectionJobs();
    await ensureDailyBackupJob();
    await expireSubscriptions();
    await runDailyOverdueEngine();
    await processDueReminders(null, 50);
    await processPendingJobs(handlers as unknown as Record<string, (p: Record<string, unknown>) => Promise<void>>, 10);
  } catch (err) {
    console.error('[scheduler] error en tick:', err);
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  if (interval) return;
  console.log('[scheduler] daemon iniciado');
  interval = setInterval(() => {
    void runTick();
  }, TICK_BASE_MS);
  // Tick inicial al arrancar
  void runTick();
}

export async function stopScheduler(): Promise<void> {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

export async function schedulerHeartbeat(): Promise<{
  enabled: boolean;
  ticking: boolean;
  tickMs: number;
  clients: number;
}> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM tenants');
  return {
    enabled: Boolean(interval),
    ticking,
    tickMs: TICK_BASE_MS,
    clients: Number(rows[0]?.c ?? 0),
  };
}

/**
 * Arranca el daemon si está habilitado en system_settings (o por env override).
 * Devuelve true si quedó corriendo.
 */
export async function startSchedulerIfEnabled(): Promise<boolean> {
  const envEnabled = env.SCHEDULER_ENABLED;
  const enabled = envEnabled === 'true' ? true : envEnabled === 'false' ? false : await getSettingBoolean('scheduler.enabled', true);
  if (enabled) startScheduler();
  return enabled;
}