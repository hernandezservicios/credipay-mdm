// ============================================================================
// CrediPay MDM - Fase 6
// collectionService.ts
// Motor de cobranza automática: ejecuta una corrida por tenant, analiza cuotas
// vencidas/atrasadas por cliente, calcula el riesgo (IA) y genera recordatorios
// de WhatsApp PENDING que luego se marcan como SENT (envío simulado).
// ============================================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import {
  computeRiskProfile,
  generateAiMessage,
  pickReminderType,
  type AiClientProfile,
  type AiMessageContext,
  type ReminderType,
  type RiskLevel,
} from './aiMessagingService.js';
import { getPlatformConfig } from './configService.js';
import { dispatchReminderChannels } from './notifService.js';
import { dispatchWebhookEvent } from './webhookService.js';

export type RunSource = 'MANUAL' | 'SCHEDULED' | 'API';

export interface CollectionSummary {
  installments: { pendiente: number; vencido: number; atrasado: number; pagado: number };
  overdueAmount: number;
  clientsAtRisk: number;
  reminders: { pending: number; sent: number };
  riskDistribution: Record<RiskLevel, number>;
  lastRun: {
    id: number;
    status: string;
    totalReminders: number;
    startedAt: number | null;
    finishedAt: number | null;
  } | null;
}

export interface RunEngineReport {
  runId: number;
  total: number;
  byType: Record<ReminderType, number>;
  byRisk: Record<RiskLevel, number>;
}

interface ClientAtRiskRow extends RowDataPacket {
  client_id: number;
  full_name: string;
  phone: string;
  device_model: string | null;
  mdm_status: string;
  monthly_installment: number | null;
  overdue_count: number;
  due_count: number;
  max_days_overdue: number;
  total_penalty: number;
  total_debt: number;
  paid_amount: number;
  last_payment_days_ago: number | null;
}

const COUNT_SQL = `SELECT COUNT(*) AS c FROM credit_installments ci
  JOIN credits cr ON cr.id = ci.credit_id
 WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL AND cr.deleted_at IS NULL
   AND cr.status = 'ACTIVE' AND ci.status IN ('VENCIDO','ATRASADO')`;

export async function getCollectionSummary(tenantId: number): Promise<CollectionSummary> {
  const [[inst]] = await pool.query<RowDataPacket[]>(
    `SELECT
        SUM(ci.status = 'PENDIENTE') AS pendiente,
        SUM(ci.status = 'VENCIDO') AS vencido,
        SUM(ci.status = 'ATRASADO') AS atrasado,
        SUM(ci.status = 'PAGADO') AS pagado,
        COALESCE(SUM(CASE WHEN ci.status IN ('VENCIDO','ATRASADO') THEN ci.total_amount ELSE 0 END), 0) AS overdue_amount
       FROM credit_installments ci
       JOIN credits cr ON cr.id = ci.credit_id
      WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL
        AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'`,
    [tenantId]
  );

  const [[atRisk]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT cr.client_id) AS c
       FROM credit_installments ci
       JOIN credits cr ON cr.id = ci.credit_id
      WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL
        AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'
        AND ci.status IN ('VENCIDO','ATRASADO')`,
    [tenantId]
  );

  const [reminderRows] = await pool.query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS c FROM collection_reminders
      WHERE tenant_id = ?
      GROUP BY status`,
    [tenantId]
  );
  const [riskRows] = await pool.query<RowDataPacket[]>(
    `SELECT risk_level, COUNT(*) AS c FROM collection_reminders
      WHERE tenant_id = ? AND created_at >= NOW() - INTERVAL 30 DAY
      GROUP BY risk_level`,
    [tenantId]
  );
  const [lastRuns] = await pool.query<RowDataPacket[]>(
    `SELECT id, status, total_reminders AS totalReminders,
            UNIX_TIMESTAMP(started_at) AS startedAt, UNIX_TIMESTAMP(finished_at) AS finishedAt
       FROM collection_runs
      WHERE tenant_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId]
  );

  const riskDistribution: Record<RiskLevel, number> = { BAJO: 0, MEDIO: 0, ALTO: 0 };
  for (const r of riskRows) {
    const level = r.risk_level as RiskLevel;
    if (level in riskDistribution) riskDistribution[level] = Number(r.c);
  }

  return {
    installments: {
      pendiente: Number(inst?.pendiente ?? 0),
      vencido: Number(inst?.vencido ?? 0),
      atrasado: Number(inst?.atrasado ?? 0),
      pagado: Number(inst?.pagado ?? 0),
    },
    overdueAmount: Number(inst?.overdue_amount ?? 0),
    clientsAtRisk: Number(atRisk?.c ?? 0),
    reminders: {
      pending: Number(reminderRows.find((r) => r.status === 'PENDING')?.c ?? 0),
      sent: Number(reminderRows.find((r) => r.status === 'SENT')?.c ?? 0),
    },
    riskDistribution,
    lastRun: lastRuns[0]
      ? {
          id: Number(lastRuns[0].id),
          status: lastRuns[0].status,
          totalReminders: Number(lastRuns[0].totalReminders),
          startedAt: lastRuns[0].startedAt ? Number(lastRuns[0].startedAt) * 1000 : null,
          finishedAt: lastRuns[0].finishedAt ? Number(lastRuns[0].finishedAt) * 1000 : null,
        }
      : null,
  };
}

/**
 * Ejecuta el motor de cobranza para un tenant. Cada corrida:
 * 1) Abre una transacción y crea su registro en collection_runs.
 * 2) Consulta clientes con cuotas VENCIDO/ATRASADO.
 * 3) Para cada cliente calcula perfil, riesgo (IA) y tipo de recordatorio.
 * 4) Omite duplicados (un PENDING activo por cliente+tipo).
 * 5) Registra collection_reminders PENDING programados a +1 hora.
 */
export async function runCollectionEngine(
  tenantId: number,
  userId: number | null,
  source: RunSource = 'MANUAL'
): Promise<RunEngineReport> {
  // FASE 5: la configuración (moneda + mora) se obtiene del tenant UNA sola vez
  // por corrida; nunca se comparte entre tenants ni se hardcodea.
  const platformConfig = await getPlatformConfig(tenantId);
  const msgCtx: AiMessageContext = {
    currency: platformConfig.currency,
    overdue: platformConfig.overdueConfig,
  };
  const conn = await pool.getConnection();
  const runId = await (async () => {
    await conn.beginTransaction();
    const [runRes] = await conn.query<ResultSetHeader>(
      `INSERT INTO collection_runs (tenant_id, triggered_by, source, status, started_at)
       VALUES (?, ?, ?, 'RUNNING', NOW())`,
      [tenantId, userId, source]
    );
    return runRes.insertId;
  })();

  try {
    const [clients] = await conn.query<ClientAtRiskRow[]>(
      `SELECT
          cl.id AS client_id,
          cl.full_name,
          cl.phone,
          (SELECT d.model FROM devices d
            WHERE d.client_id = cl.id AND d.tenant_id = cl.tenant_id AND d.deleted_at IS NULL
            ORDER BY d.id LIMIT 1) AS device_model,
          (SELECT d.mdm_status FROM devices d
            WHERE d.client_id = cl.id AND d.tenant_id = cl.tenant_id AND d.deleted_at IS NULL
            ORDER BY d.id LIMIT 1) AS mdm_status,
          (SELECT MAX(cr.monthly_amount) FROM credits cr
            WHERE cr.client_id = cl.id AND cr.tenant_id = cl.tenant_id
              AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE') AS monthly_installment,
          SUM(ci.status = 'ATRASADO') AS overdue_count,
          SUM(ci.status = 'VENCIDO') AS due_count,
          MAX(CASE WHEN ci.status = 'ATRASADO' THEN DATEDIFF(CURDATE(), ci.due_date) ELSE 0 END) AS max_days_overdue,
          COALESCE(SUM(ci.penalty_amount), 0) AS total_penalty,
          COALESCE(SUM(ci.total_amount), 0) AS total_debt,
          COALESCE((SELECT SUM(pr.amount) FROM payments_received pr
                     WHERE pr.client_id = cl.id AND pr.deleted_at IS NULL), 0) AS paid_amount,
          (SELECT MAX(DATEDIFF(CURDATE(), pr.received_date)) FROM payments_received pr
            WHERE pr.client_id = cl.id AND pr.deleted_at IS NULL) AS last_payment_days_ago
         FROM clients cl
         JOIN credits cr ON cr.client_id = cl.id AND cr.tenant_id = cl.tenant_id
           AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'
         JOIN credit_installments ci ON ci.credit_id = cr.id AND ci.tenant_id = cl.tenant_id
           AND ci.deleted_at IS NULL AND ci.status IN ('VENCIDO','ATRASADO')
        WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL
        GROUP BY cl.id, cl.full_name, cl.phone`,
      [tenantId]
    );

    const byRisk: Record<RiskLevel, number> = { BAJO: 0, MEDIO: 0, ALTO: 0 };
    const byType: Record<ReminderType, number> = {
      RECORDATORIO: 0,
      ALERTA_BLOQUEO: 0,
      CONFIRMACION_PAGO: 0,
    };
    let total = 0;

    for (const row of clients) {
      const profile = buildProfile(row);
      if (!profile) continue;
      const risk = computeRiskProfile(profile);
      const type = pickReminderType(profile);

      const [dup] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM collection_reminders
          WHERE tenant_id = ? AND client_id = ? AND reminder_type = ?
            AND status = 'PENDING'
          LIMIT 1`,
        [tenantId, row.client_id, type]
      );
      if (dup[0]) continue;

      const message = generateAiMessage(type, profile, msgCtx);
      await conn.query(
        `INSERT INTO collection_reminders
          (run_id, tenant_id, client_id, reminder_type, channel, status,
           risk_level, risk_score, message, scheduled_at)
         VALUES (?, ?, ?, ?, 'WHATSAPP', 'PENDING', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
        [
          runId,
          tenantId,
          row.client_id,
          type,
          risk.level,
          risk.score,
          message,
        ]
      );
      total += 1;
      byType[type] += 1;
      byRisk[risk.level] += 1;
    }

    await conn.query(
      `UPDATE collection_runs
          SET status = 'COMPLETED', total_reminders = ?, finished_at = NOW()
        WHERE id = ?`,
      [total, runId]
    );
    await conn.commit();
    void dispatchWebhookEvent(tenantId, 'collection.run_completed', {
      runId,
      source,
      totalReminders: total,
      byType,
      byRisk,
    });
    return { runId, total, byType, byRisk };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    await conn
      .query(
        `UPDATE collection_runs SET status = 'FAILED', error = ?, finished_at = NOW() WHERE id = ?`,
        [error instanceof Error ? error.message.slice(0, 500) : 'unknown', runId]
      )
      .catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

function buildProfile(row: ClientAtRiskRow): AiClientProfile | null {
  if (!row.phone) return null;
  return {
    fullName: row.full_name ?? 'Cliente',
    phone: String(row.phone),
    deviceModel: row.device_model ?? null,
    mdmStatus: row.mdm_status ?? 'UNKNOWN',
    monthlyInstallment: Number(row.monthly_installment ?? 0),
    overdueCount: Number(row.overdue_count ?? 0),
    dueCount: Number(row.due_count ?? 0),
    maxDaysOverdue: Number(row.max_days_overdue ?? 0),
    totalPenalty: Number(row.total_penalty ?? 0),
    totalDebt: Number(row.total_debt ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    lastPaymentDaysAgo: row.last_payment_days_ago === null ? null : Number(row.last_payment_days_ago),
  };
}

export interface ReminderRow extends RowDataPacket {
  id: number;
  run_id: number | null;
  client_id: number;
  reminder_type: ReminderType;
  channel: string;
  status: string;
  risk_level: RiskLevel;
  risk_score: number;
  subject: string | null;
  message: string;
  scheduled_at: Date | string;
  sent_at: Date | null;
  created_at: Date | string;
  full_name: string;
  phone: string;
  email: string;
  device_model: string | null;
}

export async function listReminders(
  tenantId: number,
  status: string | null,
  limit: number,
  offset: number
): Promise<ReminderRow[]> {
  const params: unknown[] = [tenantId];
  let where = 'WHERE cr.tenant_id = ?';
  if (status && status !== 'ALL') {
    where += ' AND cr.status = ?';
    params.push(status);
  }
  params.push(limit, offset);
  const [rows] = await pool.query<ReminderRow[]>(
    `SELECT cr.id, cr.run_id, cr.client_id, cr.reminder_type, cr.channel, cr.status,
            cr.risk_level, cr.risk_score, cr.subject, cr.message,
            cr.scheduled_at, cr.sent_at, cr.created_at,
            cl.full_name, cl.phone,
            (SELECT d.model FROM devices d
              WHERE d.client_id = cl.id AND d.deleted_at IS NULL
              ORDER BY d.id LIMIT 1) AS device_model
       FROM collection_reminders cr
       JOIN clients cl ON cl.id = cr.client_id
      ${where}
      ORDER BY cr.id DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params
  );
  return rows;
}

export async function sendReminder(reminderId: number, tenantId: number, userId: number | null): Promise<ReminderRow> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<ReminderRow[]>(
      `SELECT cr.id, cr.run_id, cr.client_id, cr.reminder_type, cr.channel, cr.status,
              cr.risk_level, cr.risk_score, cr.subject, cr.message,
              cr.scheduled_at, cr.sent_at, cr.created_at,
              cl.full_name, cl.phone, cl.email
         FROM collection_reminders cr
         JOIN clients cl ON cl.id = cr.client_id
        WHERE cr.id = ? AND cr.tenant_id = ?`,
      [reminderId, tenantId]
    );
    const reminder = rows[0];
    if (!reminder) {
      const error: Error & { statusCode?: number; code?: string } = new Error('Recordatorio no encontrado');
      error.statusCode = 404;
      error.code = 'not_found';
      throw error;
    }
    if (reminder.status === 'SENT') {
      await conn.commit();
      return reminder;
    }

    await conn.query(
      `UPDATE collection_reminders SET status = 'SENT', sent_at = NOW() WHERE id = ? AND tenant_id = ?`,
      [reminderId, tenantId]
    );
    if (reminder.run_id) {
      await conn.query(
        `UPDATE collection_runs SET sent_now = sent_now + 1 WHERE id = ?`,
        [reminder.run_id]
      );
    }
    await conn.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, data)
       VALUES (?, ?, 'COBRANZA', ?, ?, JSON_OBJECT('reminder_id', ?, 'channel', ?))`,
      [
        tenantId,
        userId,
        `💬 Recordatorio enviado · ${reminder.full_name}`,
        reminder.message,
        reminderId,
        reminder.channel,
      ]
    );
    await conn.commit();
    void dispatchReminderChannels(tenantId, reminder);
    return { ...reminder, status: 'SENT' };
  } finally {
    conn.release();
  }
}

/**
 * Procesa los recordatorios PENDING cuyo scheduled_at ya venció (invocado por
 * el scheduler). El envío sigue siendo transaccional en sendReminder.
 */
export async function processDueReminders(userId: number | null, limit = 50): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id FROM collection_reminders
      WHERE status = 'PENDING' AND scheduled_at <= NOW()
      ORDER BY scheduled_at
      LIMIT ${Number(limit)}`,
  );
  let processed = 0;
  for (const row of rows) {
    try {
      await sendReminder(Number(row.id), Number(row.tenant_id), userId);
      processed += 1;
    } catch (err) {
      console.error(`[cobranza] error al enviar recordatorio #${row.id}:`, err);
    }
  }
  return processed;
}

export async function listRuns(tenantId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, source, status, total_reminders AS totalReminders, sent_now AS sentNow,
            UNIX_TIMESTAMP(started_at) * 1000 AS startedAt,
            UNIX_TIMESTAMP(finished_at) * 1000 AS finishedAt,
            error
       FROM collection_runs
      WHERE tenant_id = ?
      ORDER BY id DESC
      LIMIT 20`,
    [tenantId]
  );
  return rows;
}