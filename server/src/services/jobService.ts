// ============================================================================
// CrediPay MDM - Fase 8
// jobService.ts
// Cola de trabajo basada en las tablas `jobs` y `queue`: encolado, claim
// atómico (SELECT ... FOR UPDATE SKIP LOCKED) y ejecución con reintentos
// exponenciales (attempts / max_attempts).
// ============================================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRY' | 'CANCELED';

export interface JobRow extends RowDataPacket {
  id: number;
  job_name: string;
  queue: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date | string;
  error: string | null;
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface EnqueueJobInput {
  jobName: string;
  queue?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO jobs (job_name, queue, payload, max_attempts, available_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.jobName,
      input.queue ?? 'default',
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      input.availableAt ?? new Date(),
    ]
  );
  await pool.query(
    `INSERT INTO queue (job_id, queue_name, payload, status)
     VALUES (?, ?, ?, 'PENDING')`,
    [res.insertId, input.queue ?? 'default', JSON.stringify(input.payload ?? {})]
  );
  return res.insertId;
}

/** ¿Existe ya un job PENDING/RUNNING/RETRY del mismo nombre en las últimas 24h?
 *  Si `payloadKey` es null, basta con cualquier job del nombre; si no, se
 *  compara el valor de esa clave en el payload (p. ej. tenantId). */
export async function jobPending(
  jobName: string,
  payloadKey: string | null,
  payloadValue: unknown
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT payload FROM jobs
      WHERE job_name = ?
        AND status IN ('PENDING','RUNNING','RETRY')
        AND created_at > NOW() - INTERVAL 1 DAY`,
    [jobName]
  );
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload =
        typeof row.payload === 'string' ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload;
    } catch {
      payload = {};
    }
    if (payloadKey === null) return true;
    if (String(payload[payloadKey]) === String(payloadValue)) return true;
  }
  return false;
}

/** Claim atómico del siguiente job disponible (no se entrega dos veces). */
export async function claimNextJob(): Promise<JobRow | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<JobRow[]>(
      `SELECT * FROM jobs
        WHERE status = 'PENDING' AND available_at <= NOW()
       ORDER BY available_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );
    const job = rows[0];
    if (!job) {
      await conn.commit();
      return null;
    }
    const attempts = Number(job.attempts) + 1;
    await conn.query(
      `UPDATE jobs SET status = 'RUNNING', attempts = ?, started_at = NOW() WHERE id = ?`,
      [attempts, job.id]
    );
    await conn.query(`UPDATE queue SET status = 'RUNNING' WHERE job_id = ?`, [job.id]);
    await conn.commit();
    return { ...job, attempts };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}

/** Marca un job como completado o programa su reintento. */
export async function finishJob(job: JobRow, error: Error | null): Promise<void> {
  if (!error) {
    await pool.query(
      `UPDATE jobs SET status = 'SUCCESS', finished_at = NOW(), error = NULL WHERE id = ?`,
      [job.id]
    );
    await pool.query(`UPDATE queue SET status = 'SUCCESS' WHERE job_id = ?`, [job.id]);
    return;
  }
  const message = error.message.slice(0, 500);
  const failed = job.attempts >= job.max_attempts;
  if (failed) {
    await pool.query(
      `UPDATE jobs SET status = 'FAILED', finished_at = NOW(), error = ? WHERE id = ?`,
      [message, job.id]
    );
    await pool.query(
      `UPDATE queue SET status = 'FAILED', error = ? WHERE job_id = ?`,
      [message, job.id]
    );
  } else {
    await pool.query(
      `UPDATE jobs SET status = 'RETRY', error = ?,
         available_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [message, Math.round(backoffMs(job.attempts) / 1000), job.id]
    );
    await pool.query(
      `UPDATE queue SET status = 'RETRY', error = ? WHERE job_id = ?`,
      [message, job.id]
    );
  }
}

/** Ejecuta los handlers registrados para cada job_name. */
export async function runJobWithHandlers(
  job: JobRow,
  handlers: Record<string, JobHandler>
): Promise<void> {
  const handler = handlers[job.job_name];
  if (!handler) {
    await finishJob(job, new Error(`Sin handler para el job '${job.job_name}'`));
    return;
  }
  let payload: Record<string, unknown> = {};
  if (typeof job.payload === 'string') {
    try {
      payload = JSON.parse(job.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  } else if (job.payload && typeof job.payload === 'object') {
    payload = job.payload as Record<string, unknown>;
  }
  try {
    await handler(payload);
    await finishJob(job, null);
  } catch (err) {
    await finishJob(job, err instanceof Error ? err : new Error(String(err)));
  }
}

/** Procesa hasta `limit` jobs pendientes en orden FIFO por available_at. */
export async function processPendingJobs(
  handlers: Record<string, JobHandler>,
  limit = 10
): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const job = await claimNextJob();
    if (!job) break;
    await runJobWithHandlers(job, handlers);
    processed += 1;
  }
  return processed;
}
