import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';
import { recordActivity, recordAudit } from './auditService.js';
import { unlockInovaGuardDevice } from './inovaGuardService.js';
import { addCashMovement } from './cashService.js';
import { recomputeClientScore } from './loanService.js';
import { notifyPayment } from './notifService.js';
import { dispatchWebhookEvent } from './webhookService.js';
import type { TenantRequest } from '../middleware/tenant.js';

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'DEPOSITO';

const METHOD_TO_DB: Record<PaymentMethod, 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'> = {
  EFECTIVO: 'CASH',
  TRANSFERENCIA: 'TRANSFER',
  TARJETA: 'CARD',
  DEPOSITO: 'OTHER',
};

const DB_METHOD_LABEL: Record<string, string> = {
  CASH: 'EFECTIVO',
  TRANSFER: 'TRANSFERENCIA',
  CARD: 'TARJETA',
  OTHER: 'DEPOSITO',
};

export interface CascadeAffected {
  installmentId: number;
  installmentNumber: number;
  creditId: number;
  applied: number;
  becamePaid: boolean;
  remainingAfter: number;
}

export interface CascadePaymentInput {
  clientId: number;
  amount: number;
  method: PaymentMethod;
  bank: string;
  received: number;
  change: number;
}

export interface CascadePaymentResult {
  paymentId: number;
  clientId: number;
  clientName: string;
  amountApplied: number;
  received: number;
  change: number;
  method: string;
  bank: string;
  affected: CascadeAffected[];
  unlock: {
    deviceId: number;
    success: boolean;
    simulated: boolean;
    message: string;
  } | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface PendingInstallment {
  id: number;
  creditId: number;
  installmentNumber: number;
  paid: number;
  total: number;
  status: string;
}

/**
 * Distribución en CASCADA (idéntica al frontend src/components/PaymentModal.tsx):
 * cubre la primera cuota pendiente por número, el excedente fluye a la siguiente.
 */
export function computeCascadePayment(
  pending: PendingInstallment[],
  monto: number
): CascadeAffected[] {
  const sorted = [...pending].sort((a, b) => a.installmentNumber - b.installmentNumber);
  let restante = round2(Math.max(0, monto));
  const affected: CascadeAffected[] = [];

  for (const inst of sorted) {
    if (restante <= 0) break;
    const remaining = round2(Math.max(0, inst.total - inst.paid));
    const applied = round2(Math.min(remaining, restante));
    restante = round2(restante - applied);
    const newPaid = round2(inst.paid + applied);
    affected.push({
      installmentId: inst.id,
      installmentNumber: inst.installmentNumber,
      creditId: inst.creditId,
      applied,
      becamePaid: newPaid >= inst.total,
      remainingAfter: round2(Math.max(0, inst.total - newPaid)),
    });
  }

  return affected;
}

export function normalizePaymentMethod(method: string): PaymentMethod {
  const m = method.toUpperCase();
  if (m === 'EFECTIVO' || m === 'TRANSFERENCIA' || m === 'TARJETA' || m === 'DEPOSITO') {
    return m;
  }
  throw ApiError.badRequest('invalid_method', 'Método de pago inválido');
}

export async function applyCascadePayment(
  req: TenantRequest,
  input: CascadePaymentInput
): Promise<CascadePaymentResult> {
  const tenantId = req.ctx!.tenantId;
  const userId = req.auth!.userId;
  const mdmConfig = req.ctx!.mdmConfig;

  if (!(input.amount > 0)) {
    throw ApiError.badRequest('invalid_amount', 'El monto debe ser mayor que cero');
  }

  const [clientRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, full_name, email FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [input.clientId, tenantId]
  );
  const client = clientRows[0] as { id: number; full_name: string; email: string | null } | undefined;
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  const [instRows] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id, ci.credit_id, ci.installment_number, ci.total_amount,
            COALESCE(ci.paid_amount, 0) AS paid_amount, ci.status, ci.principal_part
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE ci.tenant_id = ? AND c.client_id = ? AND c.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'RESTRUCTURED') AND ci.deleted_at IS NULL
        AND ci.status IN ('PENDIENTE', 'VENCIDO', 'ATRASADO')
      ORDER BY ci.installment_number, ci.id`,
    [tenantId, input.clientId]
  );

  if (instRows.length === 0) {
    throw ApiError.badRequest('no_pending_installments', 'El cliente no tiene cuotas pendientes');
  }

  const pending: PendingInstallment[] = instRows.map((r) => ({
    id: r.id,
    creditId: r.credit_id,
    installmentNumber: r.installment_number,
    paid: Number(r.paid_amount),
    total: Number(r.total_amount),
    status: r.status,
  }));

  const affected = computeCascadePayment(pending, input.amount);
  if (affected.length === 0) {
    throw ApiError.badRequest('no_pending_installments', 'El cliente no tiene cuotas pendientes');
  }
  const amountApplied = round2(affected.reduce((s, a) => s + a.applied, 0));
  const today = new Date().toISOString().slice(0, 10);
  const breakdown = affected.map((a) => ({
    installmentId: a.installmentId,
    installmentNumber: a.installmentNumber,
    creditId: a.creditId,
    applied: a.applied,
    becamePaid: a.becamePaid,
    remainingAfter: a.remainingAfter,
  }));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const infoByInstallment = new Map(
      pending.map((p) => [p.id, { paid: p.paid, status: p.status }])
    );
    for (const a of affected) {
      const info = infoByInstallment.get(a.installmentId)!;
      const newPaid = round2(info.paid + a.applied);
      const newStatus = a.becamePaid ? 'PAGADO' : info.status;
      const paidDate = a.becamePaid ? today : null;
      const reference = a.becamePaid ? `PAG-${today}-${a.installmentId}` : null;
      await conn.query(
        `UPDATE credit_installments
            SET paid_amount = ?, status = ?, paid_date = ?, payment_reference = ?
          WHERE id = ? AND tenant_id = ?`,
        [newPaid, newStatus, paidDate, reference, a.installmentId, tenantId]
      );
      if (a.becamePaid && info.status !== 'PAGADO') {
        const [pRows] = await conn.query<RowDataPacket[]>(
          'SELECT principal_part FROM credit_installments WHERE id = ? AND tenant_id = ?',
          [a.installmentId, tenantId]
        );
        const principalPart = Number(pRows[0]?.principal_part) || 0;
        if (principalPart > 0) {
          await conn.query(
            `UPDATE credits
                SET pending_principal = GREATEST(COALESCE(pending_principal, total_amount) - ?, 0),
                    last_payment_at = ?
              WHERE id = ? AND tenant_id = ?`,
            [principalPart, today, a.creditId, tenantId]
          );
        }
      }
    }

    const firstCreditId = affected[0].creditId;
    const [payRes] = await conn.query<ResultSetHeader>(
      `INSERT INTO payments_received
        (client_id, tenant_id, credit_id, amount, change_amount, method, reference,
         received_date, received_by, notes, installments_breakdown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.clientId,
        tenantId,
        firstCreditId,
        amountApplied,
        round2(input.change || 0),
        METHOD_TO_DB[input.method],
        input.bank || null,
        today,
        userId,
        `Pago en cascada: ${affected.length} cuota(s) afectada(s)`,
        JSON.stringify(breakdown),
      ]
    );
    const paymentId = payRes.insertId;

    // Movimiento de caja por el cobro (si hay caja abierta)
    try {
      await addCashMovement(
        tenantId,
        userId,
        {
          type: 'COLLECTION',
          amount: amountApplied,
          direction: 'IN',
          method: METHOD_TO_DB[input.method],
          reference: input.bank || `PAG-${today}-${paymentId}`,
          description: `Cobro en cascada a ${client.full_name}`,
          paymentId,
          creditId: firstCreditId,
        },
        conn
      );
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'register_closed') throw err;
      // Sin caja abierta: el cobro se registra igualmente (movimiento sin caja)
      await conn.query(
        `INSERT INTO cash_movements
          (tenant_id, register_id, type, amount, direction, method, reference,
           description, payment_id, credit_id, created_by)
         VALUES (?, NULL, 'COLLECTION', ?, 'IN', ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          amountApplied,
          METHOD_TO_DB[input.method],
          input.bank || `PAG-${today}-${paymentId}`,
          `Cobro en cascada a ${client.full_name}`,
          paymentId,
          firstCreditId,
          userId,
        ]
      );
    }

    // Crédito liquidado -> PAID_OFF
    const [left] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM credit_installments
        WHERE credit_id = ? AND deleted_at IS NULL AND status <> 'PAGADO'`,
      [firstCreditId]
    );
    if (Number(left[0].cnt) === 0) {
      await conn.query('UPDATE credits SET status = ? WHERE id = ? AND tenant_id = ?', [
        'PAID_OFF',
        firstCreditId,
        tenantId,
      ]);
    }

    // Desbloqueo MDM automático si el cliente quedó sin atrasos
    let unlock: CascadePaymentResult['unlock'] = null;
    const [devRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, inovaguard_id, mdm_status FROM devices
        WHERE client_id = ? AND tenant_id = ? AND deleted_at IS NULL
        ORDER BY id LIMIT 1`,
      [input.clientId, tenantId]
    );
    const device = devRows[0] as
      | { id: number; inovaguard_id: string | null; mdm_status: string }
      | undefined;

    if (device && mdmConfig.autoUnlockOnPaid && device.mdm_status === 'LOCKED' && device.inovaguard_id) {
      const [delinq] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
           FROM credit_installments ci
           JOIN credits c ON c.id = ci.credit_id
          WHERE ci.tenant_id = ? AND c.client_id = ? AND c.deleted_at IS NULL
            AND c.status = 'ACTIVE' AND ci.deleted_at IS NULL
            AND ci.status IN ('VENCIDO', 'ATRASADO')`,
        [tenantId, input.clientId]
      );

      if (Number(delinq[0].cnt) === 0) {
        const res = await unlockInovaGuardDevice(tenantId, mdmConfig, device.inovaguard_id);
        const result = res.err ? 'FAILED' : 'SUCCESS';
        const details = `${res.message}${res.isSimulated ? ' [SIMULADO: MDM desactivado o sin red]' : ''}`;
        await conn.query(
          `INSERT INTO device_unlocks
            (device_id, tenant_id, trigger_source, reason, installments_context,
             requested_at, completed_at, result, details)
           VALUES (?, ?, 'AUTO_PAYMENT', ?, ?, NOW(), NOW(), ?, ?)`,
          [
            device.id,
            tenantId,
            'Desbloqueo automático tras pago en cascada',
            JSON.stringify(breakdown),
            result,
            details,
          ]
        );
        await conn.query(
          `INSERT INTO device_events
            (device_id, tenant_id, client_id, action, trigger_source, status, details)
           VALUES (?, ?, ?, 'UNLOCK', 'AUTOMATIC_PAYMENT', ?, ?)`,
          [device.id, tenantId, input.clientId, result, details]
        );
        if (result !== 'FAILED') {
          await conn.query(
            `UPDATE devices SET mdm_status = 'UNLOCKED', last_mdm_sync_at = NOW(),
               last_mdm_sync_note = ? WHERE id = ? AND tenant_id = ?`,
            [details, device.id, tenantId]
          );
        }
        unlock = {
          deviceId: device.id,
          success: result !== 'FAILED',
          simulated: res.isSimulated,
          message: res.message,
        };
      }
    }

    await conn.commit();

    void recomputeClientScore(tenantId, input.clientId).catch(() => undefined);

    const payment: CascadePaymentResult = {
      paymentId,
      clientId: input.clientId,
      clientName: client.full_name,
      amountApplied,
      received: round2(input.received || amountApplied),
      change: round2(input.change || 0),
      method: input.method,
      bank: input.bank,
      affected,
      unlock,
    };

    void recordAudit(
      {
        tenantId,
        userId,
        action: 'PAYMENT_RECORDED',
        entityType: 'payment',
        entityId: String(paymentId),
        newValues: {
          clientId: input.clientId,
          amount: amountApplied,
          method: input.method,
          change: round2(input.change || 0),
          affected: breakdown,
        },
      },
      req
    );
    void recordActivity(
      tenantId,
      userId,
      'PAYMENT',
      `Pago en cascada RD$${amountApplied.toLocaleString()} para ${client.full_name} (${affected.length} cuota(s))`,
      req
    );

    void notifyPayment({
      tenantId,
      clientName: client.full_name,
      clientEmail: client.email,
      amount: amountApplied,
      reference: `PAG-${today}-${paymentId}`,
      method: input.method,
    });
    void dispatchWebhookEvent(tenantId, 'payment.paid', {
      paymentId,
      clientId: input.clientId,
      clientName: client.full_name,
      amount: amountApplied,
      method: input.method,
      affected: breakdown,
    });
    if (unlock && unlock.success) {
      void dispatchWebhookEvent(tenantId, 'device.unlocked', {
        deviceId: unlock.deviceId,
        clientId: input.clientId,
        paymentId,
      });
    }

    return payment;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export interface PaymentStats {
  recaudado: number;
  totalPagos: number;
  mesActual: number;
  morasCobradas: number;
  carteraPorCobrar: number;
  efectividad: { cuotasTotal: number; cuotasPagadas: number; pct: number };
  morosidad: { clientesAtrasados: number; deudaAtrasada: number };
  porMetodo: { method: string; count: number; total: number }[];
}

export async function getPaymentStats(tenantId: number): Promise<PaymentStats> {
  const [rec] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(p.amount), 0) AS recaudado,
            COUNT(*) AS total_pagos,
            COALESCE(SUM(CASE
              WHEN DATE_FORMAT(p.received_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
              THEN p.amount ELSE 0 END), 0) AS mes_actual
       FROM payments_received p
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL`,
    [tenantId]
  );

  const [mor] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(ci.penalty_amount), 0) AS moras
       FROM credit_installments ci
      WHERE ci.tenant_id = ? AND ci.status = 'PAGADO'`,
    [tenantId]
  );

  const [cartera] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(ci.total_amount - COALESCE(ci.paid_amount, 0)), 0) AS por_cobrar
       FROM credit_installments ci
      WHERE ci.tenant_id = ? AND ci.status IN ('PENDIENTE', 'VENCIDO', 'ATRASADO')`,
    [tenantId]
  );

  const [ef] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'PAGADO'), 0) AS pagadas
       FROM credit_installments
      WHERE tenant_id = ?`,
    [tenantId]
  );

  const [morosidad] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT cr.client_id) AS atrasados,
            COALESCE(SUM(ci.total_amount - COALESCE(ci.paid_amount, 0)), 0) AS deuda
       FROM credit_installments ci
       JOIN credits cr ON cr.id = ci.credit_id AND cr.tenant_id = ci.tenant_id
      WHERE ci.tenant_id = ? AND ci.status IN ('ATRASADO', 'VENCIDO')`,
    [tenantId]
  );

  const [metodo] = await pool.query<RowDataPacket[]>(
    `SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
       FROM payments_received p
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL
      GROUP BY p.method
      ORDER BY total DESC`,
    [tenantId]
  );

  const recRow = rec[0] as RowDataPacket;
  const morRow = mor[0] as RowDataPacket;
  const carteraRow = cartera[0] as RowDataPacket;
  const efRow = ef[0] as RowDataPacket;
  const morosidadRow = morosidad[0] as RowDataPacket;

  const cuotasTotal = Number(efRow.total) || 0;
  const cuotasPagadas = Number(efRow.pagadas) || 0;

  return {
    recaudado: Number(recRow.recaudado) || 0,
    totalPagos: Number(recRow.total_pagos) || 0,
    mesActual: Number(recRow.mes_actual) || 0,
    morasCobradas: Number(morRow.moras) || 0,
    carteraPorCobrar: Number(carteraRow.por_cobrar) || 0,
    efectividad: {
      cuotasTotal,
      cuotasPagadas,
      pct: cuotasTotal > 0 ? Math.round((cuotasPagadas / cuotasTotal) * 1000) / 10 : 0,
    },
    morosidad: {
      clientesAtrasados: Number(morosidadRow.atrasados) || 0,
      deudaAtrasada: Number(morosidadRow.deuda) || 0,
    },
    porMetodo: (metodo as RowDataPacket[]).map((m) => ({
      method: DB_METHOD_LABEL[String(m.method)] ?? String(m.method),
      count: Number(m.count) || 0,
      total: Number(m.total) || 0,
    })),
  };
}

export async function listPayments(
  tenantId: number,
  opts: { clientId?: number; from?: string; to?: string; page?: number; perPage?: number }
): Promise<{ data: RowDataPacket[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['p.tenant_id = ?', 'p.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (opts.clientId) {
    where.push('p.client_id = ?');
    params.push(opts.clientId);
  }
  if (opts.from) {
    where.push('p.received_date >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('p.received_date <= ?');
    params.push(opts.to);
  }

  const whereSql = where.join(' AND ');
  const [countRes, listRes] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM payments_received p WHERE ${whereSql}`,
      params
    ),
    pool.query<RowDataPacket[]>(
      `SELECT p.id, p.client_id, c.full_name AS client_name, p.credit_id, p.amount,
              p.change_amount AS \`change\`, p.method, p.reference, p.received_date,
              p.received_by, u.name AS received_by_name, p.notes, p.installments_breakdown,
              p.created_at
         FROM payments_received p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN users u ON u.id = p.received_by
        WHERE ${whereSql}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    ),
  ]);

  const total = Number((countRes[0] as RowDataPacket[])[0].total);
  const rows = listRes[0];
  const data = rows.map((r) => ({
    ...r,
    method: DB_METHOD_LABEL[String(r.method)] ?? r.method,
    installments_breakdown:
      typeof r.installments_breakdown === 'string'
        ? JSON.parse(r.installments_breakdown)
        : r.installments_breakdown ?? null,
  }));

  return { data, pagination: { page, perPage, total } };
}
