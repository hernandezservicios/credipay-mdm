// ============================================================
// CrediPay MDM - Caja
// Apertura/cierre diario, movimientos (cobros, desembolsos,
// ingresos, egresos, ajustes) y saldos por tenant.
// ============================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';

export type MovementType = 'COLLECTION' | 'DISBURSEMENT' | 'INCOME' | 'EXPENSE' | 'ADJUSTMENT';
export type MovementDirection = 'IN' | 'OUT';

export interface CashMovementInput {
  type: MovementType;
  amount: number;
  direction: MovementDirection;
  method?: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  reference?: string | null;
  description?: string | null;
  paymentId?: number | null;
  creditId?: number | null;
  registerId?: number | null;
}

export interface RegisterRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  register_date: string;
  status: 'OPEN' | 'CLOSED';
  opening_balance: string;
  expected_closing: string | null;
  counted_cash: string | null;
  difference: string | null;
  closed_at: string | null;
  closing_notes: string | null;
}

export interface RegisterTotals {
  registerId: number | null;
  status: 'OPEN' | 'CLOSED' | null;
  openingBalance: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  movementsCount: number;
}

type Exec = {
  query<T>(sql: string, values?: unknown): Promise<[T, unknown[]]>;
};

export type ExecLike = Exec;

export async function currentRegister(tenantId: number, date?: string): Promise<RegisterRow | null> {
  const day = date || new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query<RegisterRow[]>(
    `SELECT id, tenant_id, register_date, status, opening_balance, expected_closing,
            counted_cash, difference, closed_at, closing_notes
       FROM cash_registers
      WHERE tenant_id = ? AND register_date = ?
      ORDER BY id DESC LIMIT 1`,
    [tenantId, day]
  );
  return rows[0] ?? null;
}

export async function openRegister(
  tenantId: number,
  userId: number,
  openingBalance: number
): Promise<RegisterRow> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await currentRegister(tenantId, today);
  if (existing?.status === 'OPEN') {
    throw ApiError.badRequest('register_already_open', 'La caja del día ya está abierta');
  }

  const balance = Math.round(Number(openingBalance || 0) * 100) / 100;
  if (balance < 0) throw ApiError.badRequest('invalid_balance', 'Saldo inicial inválido');

  if (existing) {
    await pool.query(
      `UPDATE cash_registers
          SET status = 'OPEN', opened_by = ?, opened_at = NOW(),
              opening_balance = ?, expected_closing = NULL, counted_cash = NULL,
              difference = NULL, closed_by = NULL, closed_at = NULL, closing_notes = NULL
        WHERE id = ? AND tenant_id = ?`,
      [userId, balance, existing.id, tenantId]
    );
    const reopened = await currentRegister(tenantId, today);
    if (!reopened) throw new ApiError(500, 'internal_error', 'Caja no encontrada tras la operación');
    return reopened;
  }

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO cash_registers (tenant_id, register_date, status, opened_by, opening_balance)
     VALUES (?, ?, 'OPEN', ?, ?)`,
    [tenantId, today, userId, balance]
  );
  const created = await currentRegister(tenantId, today);
  if (!created) throw new ApiError(500, 'internal_error', 'Caja no encontrada tras la operación');
  return created;
}

export async function closeRegister(
  tenantId: number,
  registerId: number,
  countedCash: number,
  notes?: string
): Promise<RegisterRow> {
  const [rows] = await pool.query<RegisterRow[]>(
    'SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?',
    [registerId, tenantId]
  );
  const reg = rows[0];
  if (!reg) throw ApiError.notFound('Caja no encontrada');
  if (reg.status === 'CLOSED') throw ApiError.badRequest('register_already_closed', 'La caja ya está cerrada');

  const totals = await registerTotals(tenantId, registerId);
  const counted = Math.round(Number(countedCash || 0) * 100) / 100;
  const difference = Math.round((counted - totals.expected) * 100) / 100;

  await pool.query(
    `UPDATE cash_registers
        SET status = 'CLOSED', expected_closing = ?, counted_cash = ?, difference = ?,
            closed_at = NOW(), closing_notes = ?
      WHERE id = ? AND tenant_id = ?`,
    [totals.expected, counted, difference, notes || null, registerId, tenantId]
  );
  const updated = await currentRegister(tenantId, reg.register_date);
  if (!updated) throw new ApiError(500, 'internal_error', 'Caja no encontrada tras la operación');
  return updated;
}

export async function registerTotals(
  tenantId: number,
  registerId: number
): Promise<RegisterTotals> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0) AS cash_in,
            COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0) AS cash_out,
            COUNT(*) AS cnt
       FROM cash_movements
      WHERE tenant_id = ? AND register_id = ?`,
    [tenantId, registerId]
  );
  const row = rows[0] as RowDataPacket;
  const [regRows] = await pool.query<RegisterRow[]>(
    'SELECT status, opening_balance FROM cash_registers WHERE id = ? AND tenant_id = ?',
    [registerId, tenantId]
  );
  const reg = regRows[0];
  const opening = reg ? Number(reg.opening_balance) || 0 : 0;
  const cashIn = Number(row.cash_in) || 0;
  const cashOut = Number(row.cash_out) || 0;
  return {
    registerId,
    status: reg?.status ?? null,
    openingBalance: opening,
    cashIn,
    cashOut,
    expected: Math.round((opening + cashIn - cashOut) * 100) / 100,
    movementsCount: Number(row.cnt) || 0,
  };
}

export async function addCashMovement(
  tenantId: number,
  userId: number,
  input: CashMovementInput,
  conn?: Exec
): Promise<number> {
  const amount = Math.round(Number(input.amount || 0) * 100) / 100;
  if (amount <= 0) throw ApiError.badRequest('invalid_amount', 'El monto del movimiento debe ser mayor que cero');
  if (!['IN', 'OUT'].includes(input.direction)) {
    throw ApiError.badRequest('invalid_direction', 'Dirección del movimiento inválida');
  }

  if (input.registerId == null) {
    const open = await currentRegister(tenantId);
    if (open?.status === 'OPEN') input.registerId = open.id;
  }
  if (input.registerId != null) {
    const [regRows] = await pool.query<RegisterRow[]>(
      'SELECT status FROM cash_registers WHERE id = ? AND tenant_id = ?',
      [input.registerId, tenantId]
    );
    const reg = regRows[0];
    if (!reg) throw ApiError.notFound('Caja no encontrada');
    if (reg.status !== 'OPEN') {
      throw ApiError.badRequest('register_closed', 'La caja está cerrada, abra la caja del día');
    }
  }

  const exec = conn ?? pool;
  const [res] = await exec.query<ResultSetHeader>(
    `INSERT INTO cash_movements
      (tenant_id, register_id, type, amount, direction, method, reference,
       description, payment_id, credit_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.registerId ?? null,
      input.type,
      amount,
      input.direction,
      input.method || 'CASH',
      input.reference ?? null,
      input.description ?? null,
      input.paymentId ?? null,
      input.creditId ?? null,
      userId,
    ]
  );
  return res.insertId;
}

export async function listMovements(
  tenantId: number,
  opts: { registerId?: number; from?: string; to?: string; type?: string; page?: number; perPage?: number }
): Promise<{ data: RowDataPacket[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['cm.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (opts.registerId) {
    where.push('cm.register_id = ?');
    params.push(opts.registerId);
  }
  if (opts.from) {
    where.push('cm.created_at >= ?');
    params.push(`${opts.from} 00:00:00`);
  }
  if (opts.to) {
    where.push('cm.created_at <= ?');
    params.push(`${opts.to} 23:59:59`);
  }
  if (opts.type) {
    where.push('cm.type = ?');
    params.push(opts.type);
  }

  const whereSql = where.join(' AND ');
  const [countRes] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM cash_movements cm WHERE ${whereSql}`,
    params
  );
  const [listRes] = await pool.query<RowDataPacket[]>(
    `SELECT cm.id, cm.register_id, cm.type, cm.amount, cm.direction, cm.method,
            cm.reference, cm.description, cm.payment_id, cm.credit_id, cm.created_at,
            u.name AS created_by_name, cr.register_date
       FROM cash_movements cm
       LEFT JOIN users u ON u.id = cm.created_by
       LEFT JOIN cash_registers cr ON cr.id = cm.register_id
      WHERE ${whereSql}
      ORDER BY cm.id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage]
  );
  const total = Number(countRes[0].total);
  return { data: listRes, pagination: { page, perPage, total } };
}

export async function listRegisters(
  tenantId: number,
  opts: { from?: string; to?: string; page?: number; perPage?: number }
): Promise<{ data: RowDataPacket[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['cr.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (opts.from) {
    where.push('cr.register_date >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('cr.register_date <= ?');
    params.push(opts.to);
  }

  const whereSql = where.join(' AND ');
  const [countRes] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM cash_registers cr WHERE ${whereSql}`,
    params
  );
  const [listRes] = await pool.query<RowDataPacket[]>(
    `SELECT cr.id, cr.register_date, cr.status, cr.opening_balance, cr.expected_closing,
            cr.counted_cash, cr.difference, cr.opened_at, cr.closed_at, cr.closing_notes,
            ou.name AS opened_by_name, cu.name AS closed_by_name,
            (SELECT COUNT(*) FROM cash_movements cm WHERE cm.register_id = cr.id) AS movements_count
       FROM cash_registers cr
       LEFT JOIN users ou ON ou.id = cr.opened_by
       LEFT JOIN users cu ON cu.id = cr.closed_by
      WHERE ${whereSql}
      ORDER BY cr.register_date DESC, cr.id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage]
  );
  const total = Number(countRes[0].total);
  return { data: listRes, pagination: { page, perPage, total } };
}