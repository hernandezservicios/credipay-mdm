import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { ApiError } from '../../utils/http.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { unlockInovaGuardDevice } from '../../integrations/inovaGuard/index.js';
import { addCashMovement } from '../../services/cashService.js';
import { recomputeClientScore } from '../../services/loanService.js';
import { dispatchWebhookEvent } from '../../services/webhookService.js';
import { insertLoanEvent } from './loanEvents.js';
import {
  allocatePayment,
  normalizeConfig,
  type AllocatedLine,
  type PaymentConfig,
} from './paymentEngine.js';
import type { TenantRequest } from '../../middleware/tenant.js';

/**
 * Cobro unificado por prestamo (Fase E): POST /loans/:id/pay.
 *  - R12: todo ocurre en UNA transaccion (cuotas + pago + counter + evento).
 *  - R13: idempotencia por (tenant, idempotency_key); reintentos devuelven
 *         el pago original sin duplicar efectos.
 *  - R16: validaciones financieras solo en backend.
 */

export type PayMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'DEPOSITO';

const METHOD_TO_DB: Record<PayMethod, 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER'> = {
  EFECTIVO: 'CASH',
  TRANSFERENCIA: 'TRANSFER',
  TARJETA: 'CARD',
  DEPOSITO: 'OTHER',
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function getEnginePaymentConfig(tenantId: number): Promise<PaymentConfig> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT payment_config FROM tenant_settings WHERE tenant_id = ? LIMIT 1',
    [tenantId]
  );
  let raw: Partial<PaymentConfig> | null = null;
  if (rows[0]?.payment_config) {
    const value = rows[0].payment_config as string | Record<string, unknown>;
    try {
      raw = (typeof value === 'string' ? JSON.parse(value) : value) as Partial<PaymentConfig>;
    } catch {
      raw = null;
    }
  }
  return normalizeConfig(raw);
}

interface PendingRow {
  id: number;
  credit_id: number;
  installment_number: number;
  due_date: Date | string;
  total_amount: number;
  penalty_amount: number;
  paid_amount: number;
  status: string;
}

async function loadPendingInstallments(tenantId: number, creditId: number): Promise<PendingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id, ci.credit_id, ci.installment_number, ci.due_date, ci.total_amount,
            ci.penalty_amount, COALESCE(ci.paid_amount, 0) AS paid_amount, ci.status
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE ci.tenant_id = ? AND ci.credit_id = ? AND ci.deleted_at IS NULL
        AND c.deleted_at IS NULL AND ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')
      ORDER BY ci.installment_number, ci.id`,
    [tenantId, creditId]
  );
  return rows as RowDataPacket[] as PendingRow[];
}

export interface SimulatePaymentResult {
  creditId: number;
  amount: number;
  config: PaymentConfig;
  lines: AllocatedLine[];
  totalAllocated: number;
  remainder: number;
  coveredInstallmentIds: number[];
}

export async function simulateLoanPayment(
  tenantId: number,
  creditId: number,
  amount: number
): Promise<SimulatePaymentResult> {
  if (!(amount > 0)) throw ApiError.badRequest('invalid_amount', 'El monto debe ser mayor que cero');
  const [creditRows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM credits WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [creditId, tenantId]
  );
  if (!creditRows[0]) throw ApiError.notFound('Préstamo no encontrado');

  const config = await getEnginePaymentConfig(tenantId);
  const pending = await loadPendingInstallments(tenantId, creditId);
  if (pending.length === 0) {
    throw ApiError.badRequest('no_pending_installments', 'El préstamo no tiene cuotas pendientes');
  }

  const plan = allocatePayment({
    installments: pending.map((r) => ({
      installmentId: r.id,
      creditId: r.credit_id,
      installmentNumber: r.installment_number,
      dueDate: r.due_date,
      total: Number(r.total_amount),
      paid: Number(r.paid_amount),
      penaltyAmount: Number(r.penalty_amount),
      status: r.status,
    })),
    amount: round2(amount),
    config,
  });

  return {
    creditId,
    amount: round2(amount),
    config,
    lines: plan.allocations,
    totalAllocated: plan.totalAllocated,
    remainder: plan.remainder,
    coveredInstallmentIds: plan.coveredInstallmentIds,
  };
}

export interface LoanPaymentInput {
  creditId: number;
  amount: number;
  method: PayMethod;
  bank?: string;
  received?: number;
  change?: number;
  idempotencyKey?: string;
  notes?: string;
}

export interface LoanPaymentResult {
  paymentId: number;
  creditId: number;
  amountApplied: number;
  received: number;
  change: number;
  method: string;
  remainder: number;
  duplicate: boolean;
  affected: AllocatedLine[];
  unlock: { deviceId: number; success: boolean; simulated: boolean; message: string } | null;
}

export async function applyLoanPayment(
  req: TenantRequest,
  input: LoanPaymentInput
): Promise<LoanPaymentResult> {
  const tenantId = req.ctx!.tenantId;
  const userId = req.auth!.userId;
  const mdmConfig = req.ctx!.mdmConfig;

  if (!(input.amount > 0)) {
    throw ApiError.badRequest('invalid_amount', 'El monto debe ser mayor que cero');
  }
  const key = input.idempotencyKey?.trim() ? input.idempotencyKey.trim().slice(0, 64) : null;

  const [creditRows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.client_id, cl.full_name, cl.email
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL`,
    [input.creditId, tenantId]
  );
  const credit = creditRows[0];
  if (!credit) throw ApiError.notFound('Préstamo no encontrado');
  const clientId = Number(credit.client_id);
  const clientName = String(credit.full_name);

  // R13: reintento idempotente -> devolver pago original
  if (key) {
    const [dupRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, amount, change_amount FROM payments_received WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, key]
    );
    const dup = dupRows[0];
    if (dup) {
      return {
        paymentId: Number(dup.id),
        creditId: input.creditId,
        amountApplied: Number(dup.amount),
        received: Number(dup.amount),
        change: Number(dup.change_amount) || 0,
        method: input.method,
        remainder: 0,
        affected: [],
        duplicate: true,
        unlock: null,
      };
    }
  }

  const config = await getEnginePaymentConfig(tenantId);
  const pending = await loadPendingInstallments(tenantId, input.creditId);
  if (pending.length === 0) {
    throw ApiError.badRequest('no_pending_installments', 'El préstamo no tiene cuotas pendientes');
  }

  const plan = allocatePayment({
    installments: pending.map((r) => ({
      installmentId: r.id,
      creditId: r.credit_id,
      installmentNumber: r.installment_number,
      dueDate: r.due_date,
      total: Number(r.total_amount),
      paid: Number(r.paid_amount),
      penaltyAmount: Number(r.penalty_amount),
      status: r.status,
    })),
    amount: round2(input.amount),
    config,
  });

  if (plan.allocations.length === 0) {
    throw ApiError.badRequest('no_pending_installments', 'El préstamo no tiene cuotas pendientes');
  }

  const amountApplied = plan.totalAllocated;
  const today = new Date().toISOString().slice(0, 10);
  const byInstallment = new Map(pending.map((p) => [p.id, p]));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Gateway del motor: aplicar montos sobre cada cuota
    for (const a of plan.allocations) {
      const info = byInstallment.get(a.installmentId)!;
      const newPaid = round2(Number(info.paid_amount) + a.allocated);
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

    // Pago registrado (con clave de idempotencia)
    let paymentId: number;
    try {
      const [payRes] = await conn.query<ResultSetHeader>(
        `INSERT INTO payments_received
          (client_id, tenant_id, credit_id, amount, change_amount, method, reference,
           received_date, received_by, notes, installments_breakdown, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clientId,
          tenantId,
          input.creditId,
          amountApplied,
          round2(input.change || 0),
          METHOD_TO_DB[input.method],
          input.bank || null,
          today,
          userId,
          input.notes ?? null,
          JSON.stringify(
            plan.allocations.map((a) => ({
              installmentId: a.installmentId,
              installmentNumber: a.installmentNumber,
              creditId: a.creditId,
              allocated: a.allocated,
              becamePaid: a.becamePaid,
              remainingAfter: a.remainingAfter,
            }))
          ),
          key,
        ]
      );
      paymentId = payRes.insertId;
    } catch (err) {
      // Carrera R13: otro request registró el mismo idempotency_key
      if (key && (err as { errno?: number }).errno === 1062) {
        await conn.rollback();
        throw new ApiError(
          409,
          'duplicate_payment',
          'Este pago ya fue registrado (clave de idempotencia duplicada)'
        );
      }
      throw err;
    }

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
          description: `Cobro a ${clientName}`,
          paymentId,
          creditId: input.creditId,
        },
        conn
      );
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'register_closed') throw err;
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
          `Cobro a ${clientName}`,
          paymentId,
          input.creditId,
          userId,
        ]
      );
    }

    // Cierre del préstamo si no quedan cuotas
    const [left] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM credit_installments
        WHERE credit_id = ? AND deleted_at IS NULL AND status <> 'PAGADO'`,
      [input.creditId]
    );
    let closed = false;
    if (Number(left[0].cnt) === 0) {
      await conn.query('UPDATE credits SET status = ? WHERE id = ? AND tenant_id = ?', [
        'PAID_OFF',
        input.creditId,
        tenantId,
      ]);
      closed = true;
    }

    // Timeline (D25) en la misma TX
    await insertLoanEvent(conn, {
      tenantId,
      creditId: input.creditId,
      clientId,
      userId,
      eventType: closed ? 'LOAN_CLOSED' : 'PAYMENT',
      description: closed
        ? `Préstamo liquidado tras pago ${amountApplied.toLocaleString()}`
        : `Cobro ${amountApplied.toLocaleString()} (${plan.allocations.length} cuota(s))`,
      data: { paymentId, amount: amountApplied, method: input.method },
    });

    // Desbloqueo MDM si el cliente quedó al día
    let unlock: LoanPaymentResult['unlock'] = null;
    if (mdmConfig.autoUnlockOnPaid) {
      const [devRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, inovaguard_id, mdm_status FROM devices
          WHERE client_id = ? AND tenant_id = ? AND deleted_at IS NULL
          ORDER BY id LIMIT 1`,
        [clientId, tenantId]
      );
      const device = devRows[0] as
        | { id: number; inovaguard_id: string | null; mdm_status: string }
        | undefined;
      const [delinq] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
           FROM credit_installments ci
           JOIN credits c ON c.id = ci.credit_id
          WHERE ci.tenant_id = ? AND c.client_id = ? AND c.deleted_at IS NULL
            AND c.status = 'ACTIVE' AND ci.deleted_at IS NULL
            AND ci.status IN ('VENCIDO','ATRASADO')`,
        [tenantId, clientId]
      );
      if (
        device &&
        device.mdm_status === 'LOCKED' &&
        device.inovaguard_id &&
        Number(delinq[0].cnt) === 0
      ) {
        const res = await unlockInovaGuardDevice(tenantId, mdmConfig, device.inovaguard_id);
        const result = res.err ? 'FAILED' : 'SUCCESS';
        const details = `${res.message}${res.isSimulated ? ' [SIMULADO: MDM desactivado o sin red]' : ''}`;
        await conn.query(
          `INSERT INTO device_unlocks
            (device_id, tenant_id, trigger_source, reason, installments_context,
             requested_at, completed_at, result, details)
           VALUES (?, ?, 'AUTO_PAYMENT', ?, ?, NOW(), NOW(), ?, ?)`,
          [device.id, tenantId, 'Desbloqueo automático tras pago', '{}', result, details]
        );
        await conn.query(
          `INSERT INTO device_events
            (device_id, tenant_id, client_id, action, trigger_source, status, details)
           VALUES (?, ?, ?, 'UNLOCK', 'AUTOMATIC_PAYMENT', ?, ?)`,
          [device.id, tenantId, clientId, result, details]
        );
        if (result !== 'FAILED') {
          await conn.query(
            `UPDATE devices SET mdm_status = 'UNLOCKED', last_mdm_sync_at = NOW(), last_mdm_sync_note = ?
              WHERE id = ? AND tenant_id = ?`,
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

    void recomputeClientScore(tenantId, clientId).catch(() => undefined);
    void recordAudit(
      {
        tenantId,
        userId,
        action: 'PAYMENT_RECORDED',
        entityType: 'payment',
        entityId: String(paymentId),
        newValues: { creditId: input.creditId, clientId, amount: amountApplied, method: input.method },
      },
      req
    );
    void recordActivity(
      tenantId,
      userId,
      'PAYMENT',
      `Cobro ${amountApplied.toLocaleString()} a ${clientName} (${plan.allocations.length} cuota(s))`,
      req
    );
    void dispatchWebhookEvent(tenantId, 'payment.paid', {
      paymentId,
      clientId,
      clientName,
      amount: amountApplied,
      method: input.method,
      creditId: input.creditId,
    });
    if (unlock?.success) {
      void dispatchWebhookEvent(tenantId, 'device.unlocked', { deviceId: unlock.deviceId, clientId, paymentId });
    }

    return {
      paymentId,
      creditId: input.creditId,
      amountApplied,
      received: round2(input.received || amountApplied),
      change: round2(input.change || 0),
      method: input.method,
      remainder: plan.remainder,
      affected: plan.allocations,
      duplicate: false,
      unlock,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}