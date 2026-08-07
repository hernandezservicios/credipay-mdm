// ============================================================================
// CrediPay MDM - Fase 8
// webhookService.ts
// Webhooks salientes: CRUD por tenant con límite según plan (max_webhooks),
// dispatcher de eventos con firma HMAC-SHA256 y entregas en webhook_deliveries
// con reintentos vía la cola de jobs.
// ============================================================================

import crypto from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from './../db/pool.js';
import { ApiError } from './../utils/http.js';
import { enqueueJob } from './jobService.js';

export interface WebhookInput {
  name: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
}

export interface WebhookRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  webhook_name: string;
  url: string;
  events: string[] | null;
  is_active: number;
  last_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const WEBHOOK_EVENTS = [
  'payment.paid',
  'device.locked',
  'device.unlocked',
  'collection.run_completed',
] as const;

export function parseEvents(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listWebhooks(tenantId: number): Promise<WebhookRow[]> {
  const [rows] = await pool.query<WebhookRow[]>(
    `SELECT id, webhook_name, url, events, is_active, last_sent_at, created_at, updated_at
       FROM webhooks
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY id DESC`,
    [tenantId]
  );
  return rows.map((r) => ({ ...r, events: parseEvents(r.events) }));
}

export async function createWebhook(tenantId: number, input: WebhookInput): Promise<number> {
  if (!/^https?:\/\//i.test(input.url)) {
    throw ApiError.badRequest('invalid_url', 'La URL del webhook debe ser http(s)://');
  }
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO webhooks (tenant_id, webhook_name, url, secret, events, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.name.slice(0, 100),
      input.url.slice(0, 255),
      input.secret ? input.secret.slice(0, 255) : null,
      JSON.stringify(input.events),
      input.isActive ? 1 : 0,
    ]
  );
  return res.insertId;
}

export async function updateWebhook(
  tenantId: number,
  webhookId: number,
  input: Partial<WebhookInput>
): Promise<void> {
  if (input.url !== undefined && !/^https?:\/\//i.test(input.url)) {
    throw ApiError.badRequest('invalid_url', 'La URL del webhook debe ser http(s)://');
  }
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE webhooks SET
        webhook_name = COALESCE(?, webhook_name),
        url = COALESCE(?, url),
        secret = COALESCE(?, secret),
        events = COALESCE(?, events),
        is_active = COALESCE(?, is_active),
        updated_at = NOW()
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [
      input.name ? input.name.slice(0, 100) : null,
      input.url ? input.url.slice(0, 255) : null,
      input.secret ? input.secret.slice(0, 255) : null,
      input.events ? JSON.stringify(input.events) : null,
      input.isActive === undefined ? null : input.isActive ? 1 : 0,
      webhookId,
      tenantId,
    ]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Webhook no encontrado');
}

export async function deleteWebhook(tenantId: number, webhookId: number): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    'UPDATE webhooks SET deleted_at = NOW(), is_active = 0 WHERE id = ? AND tenant_id = ?',
    [webhookId, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Webhook no encontrado');
}

export async function listDeliveries(
  tenantId: number,
  webhookId: number | null,
  limit = 50
): Promise<RowDataPacket[]> {
  const params: unknown[] = [tenantId, limit];
  let where = 'wd.tenant_id = ?';
  if (webhookId) {
    where += ' AND wd.webhook_id = ?';
    params.splice(params.length - 1, 0, webhookId);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT wd.id, wd.webhook_id, w.webhook_name, wd.event, wd.status, wd.attempt,
            wd.max_attempts, wd.response_status, wd.error, wd.duration_ms,
            wd.created_at AS createdAt
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
      WHERE ${where}
      ORDER BY wd.id DESC
      LIMIT ${Number(limit)}`,
    params
  );
  return rows;
}

// -------------------- Dispatcher --------------------

function signPayload(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Registra una entrega PENDING y la encola para su envío. */
export async function enqueueDelivery(
  webhookId: number,
  tenantId: number,
  event: string,
  payload: unknown
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO webhook_deliveries (webhook_id, tenant_id, event, payload, status)
     VALUES (?, ?, ?, ?, 'PENDING')`,
    [webhookId, tenantId, event, JSON.stringify(payload ?? {})]
  );
  await enqueueJob({
    jobName: 'webhook.deliver',
    queue: 'webhooks',
    payload: { deliveryId: res.insertId },
    maxAttempts: 5,
  });
  return res.insertId;
}

/** Dispara un evento a todos los webhooks activos del tenant suscritos. */
export async function dispatchWebhookEvent(
  tenantId: number,
  event: string,
  payload: unknown
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM webhooks
      WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL`,
    [tenantId]
  );
  let dispatched = 0;
  for (const row of rows) {
    const [hookRows] = await pool.query<RowDataPacket[]>(
      'SELECT events FROM webhooks WHERE id = ?',
      [Number(row.id)]
    );
    const events = parseEvents(hookRows[0]?.events);
    if (!events.includes(event)) continue;
    await enqueueDelivery(Number(row.id), tenantId, event, payload);
    await pool.query('UPDATE webhooks SET last_sent_at = NOW() WHERE id = ?', [Number(row.id)]);
    dispatched += 1;
  }
  return dispatched;
}

export interface DeliveryRow extends RowDataPacket {
  id: number;
  webhook_id: number;
  event: string;
  url: string;
  secret: string | null;
}

/** Envía una entrega pendiente con reintento exponencial en caso de fallo. */
export async function deliverDelivery(deliveryId: number): Promise<{ status: string }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<DeliveryRow[]>(
      `SELECT wd.id, wd.webhook_id, wd.tenant_id, wd.event, wd.payload, wd.attempt,
              wd.max_attempts, w.url, w.secret
         FROM webhook_deliveries wd
         JOIN webhooks w ON w.id = wd.webhook_id
        WHERE wd.id = ? AND wd.status IN ('PENDING','RETRY') AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= NOW())
        LIMIT 1
        FOR UPDATE`,
      [deliveryId]
    );
    const delivery = rows[0];
    if (!delivery) {
      await conn.commit();
      return { status: 'SKIPPED' };
    }

    const attempt = Number(delivery.attempt) + 1;
    await conn.query(
      `UPDATE webhook_deliveries SET status = 'PENDING', attempt = ? WHERE id = ?`,
      [attempt, deliveryId]
    );
    await conn.commit();

    const body = JSON.stringify({ event: delivery.event, payload: delivery.payload });
    const signature = signPayload(String(delivery.secret ?? ''), body);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let status: 'SUCCESS' | 'RETRY' | 'FAILED';
    let responseStatus: number | null = null;
    let error: string | null = null;
    let responseBody = '';

    try {
      const res = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CrediPay-MDM/1.0',
          'X-Credipay-Event': delivery.event,
          'X-Credipay-Delivery': String(deliveryId),
          'X-Credipay-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      responseStatus = res.status;
      responseBody = (await res.text()).slice(0, 2000);
      status = res.ok ? 'SUCCESS' : 'RETRY';
    } catch (err) {
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      status = 'RETRY';
    } finally {
      clearTimeout(timeout);
    }

    if (status === 'RETRY' && attempt >= Number(delivery.max_attempts)) {
      status = 'FAILED';
    }

    const durationMs = Date.now() - startedAt;
    const nextRetryAt =
      status === 'RETRY'
        ? new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(0, attempt - 2), 10 * 60_000))
        : null;

    await pool.query(
      `UPDATE webhook_deliveries SET
          status = ?, attempt = ?, response_status = ?,
          response_body = ?, error = ?,
          duration_ms = ?, next_retry_at = ?, updated_at = NOW()
        WHERE id = ?`,
      [status, attempt, responseStatus, status === 'SUCCESS' ? responseBody.slice(0, 500) : null, error, durationMs, nextRetryAt, deliveryId]
    );

    if (status === 'RETRY') {
      await enqueueJob({
        jobName: 'webhook.deliver',
        queue: 'webhooks',
        payload: { deliveryId },
        maxAttempts: Number(delivery.max_attempts),
        availableAt: nextRetryAt ?? undefined,
      });
    }

    return { status };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}