import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * Eventos del timeline del prestamo (D25) - tabla loan_events (append-only).
 * Los eventos financieros se insertan DENTRO de la misma transaccion de pago
 * (R12: todo o nada). Los eventos se consultan con getLoanTimeline.
 */

export type LoanEventType =
  | 'LOAN_CREATED'
  | 'LOAN_ACTIVATED'
  | 'LOAN_RESTRUCTURED'
  | 'LOAN_CLOSED'
  | 'PAYMENT'
  | 'PAYMENT_FAILED'
  | 'REFINANCED'
  | 'FORGIVEN'
  | 'AGREEMENT'
  | 'MDM_LOCK'
  | 'MDM_UNLOCK'
  | 'NOTE';

export interface LoanEventInsert {
  tenantId: number;
  creditId: number;
  clientId?: number | null;
  userId?: number | null;
  eventType: LoanEventType;
  description?: string | null;
  data?: Record<string, unknown> | null;
}

export async function insertLoanEvent(
  conn: PoolConnection,
  evt: LoanEventInsert
): Promise<void> {
  await conn.query(
    `INSERT INTO loan_events (tenant_id, credit_id, client_id, user_id, event_type, description, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      evt.tenantId,
      evt.creditId,
      evt.clientId ?? null,
      evt.userId ?? null,
      evt.eventType,
      evt.description ?? null,
      evt.data ? JSON.stringify(evt.data) : null,
    ]
  );
}

export interface LoanTimelineEntry {
  id: number;
  eventType: string;
  description: string | null;
  data: unknown;
  createdAt: string;
  userName: string | null;
}

export async function getLoanTimeline(
  tenantId: number,
  creditId: number
): Promise<LoanTimelineEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT le.id, le.event_type AS eventType, le.description, le.data, le.created_at AS createdAt,
            u.name AS userName
       FROM loan_events le
       LEFT JOIN users u ON u.id = le.user_id
      WHERE le.tenant_id = ? AND le.credit_id = ?
      ORDER BY le.id DESC
      LIMIT 200`,
    [tenantId, creditId]
  );
  return (rows as RowDataPacket[]).map((r) => ({
    id: Number(r.id),
    eventType: String(r.eventType),
    description: r.description as string | null,
    data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    createdAt: String(r.createdAt),
    userName: r.userName as string | null,
  }));
}

export async function insertLoanEventPool(evt: LoanEventInsert): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await insertLoanEvent(conn, evt);
  } finally {
    conn.release();
  }
}