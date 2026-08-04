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
import { deliverDelivery } from './services/webhookService.js';

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

async function runTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await ensureDailyCollectionJobs();
    await ensureDailyBackupJob();
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