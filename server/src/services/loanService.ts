// ============================================================
// CrediPay MDM - Ciclo de vida del préstamo
// Creación con motor financiero, aprobación, desembolso,
// refinanciamiento, reestructuración, renovación, condonación,
// acuerdos de pago y motor de mora automática.
// ============================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';
import {
  buildSchedule,
  loanQuote,
  overduePenalty,
  round2,
  type AmortizationMethod,
  type OverdueConfig,
  type ScheduleRow,
} from './loanEngine.js';
import { getPlatformConfig, recordIntegrationStatus } from './configService.js';
import { addCashMovement } from './cashService.js';
import { lockInovaGuardDevice } from '../integrations/inovaGuard/index.js';
import { DEFAULT_MDM_CONFIG, type MdmConfig } from './tenantService.js';

export interface CreateLoanInput {
  clientId: number;
  principal: number;
  annualRate: number;
  method: AmortizationMethod;
  installmentsCount: number;
  startDate?: string;
  financingFee?: number;
  notes?: string;
  status?: 'PENDING' | 'ACTIVE';
  disburseNow?: boolean;
}

export interface LoanActionResult {
  id: number;
  creditNumber: string;
  status: string;
  scheduleCount: number;
  totalInterest: number;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

async function nextCreditNumber(tenantId: number, id: number, prefix: string): Promise<string> {
  const padded = String(id).padStart(6, '0');
  return `${prefix}-${new Date().getFullYear()}-${padded}`;
}

// ---------------------------------------------------------------------------
// Creación con cronograma generado por el motor
// ---------------------------------------------------------------------------

export async function createLoan(
  tenantId: number,
  userId: number,
  input: CreateLoanInput
): Promise<LoanActionResult> {
  const principal = round2(Number(input.principal) || 0);
  const rate = Number(input.annualRate) || 0;
  const terms = Math.floor(Number(input.installmentsCount) || 0);
  const fee = round2(Number(input.financingFee) || 0);

  if (!(principal > 0)) throw ApiError.badRequest('invalid_principal', 'El capital es obligatorio');
  if (!(terms > 0) || terms > 120) {
    throw ApiError.badRequest('invalid_count', 'Número de cuotas inválido (1-120)');
  }
  if (rate < 0 || rate > 100) throw ApiError.badRequest('invalid_rate', 'Tasa anual entre 0 y 100');

  const config = await getPlatformConfig(tenantId);
  const allowed = config.loanConfig.allow_partial_payment === undefined || config.loanConfig;
  void allowed;

  const [clientRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, full_name FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [input.clientId, tenantId]
  );
  if (!clientRows[0]) throw ApiError.notFound('Cliente no encontrado');

  const schedule = buildSchedule({
    principal,
    annualRatePercent: rate,
    installmentsCount: terms,
    method: input.method,
    startDate: input.startDate || todayStr(),
  });
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interestPart, 0));
  const totalAmount = round2(schedule.reduce((s, r) => s + r.amount, 0) + fee);
  const monthlyAmount = schedule[0]?.amount ?? 0;
  const status: 'PENDING' | 'ACTIVE' =
    input.status === 'PENDING' ? 'PENDING' : input.disburseNow ? 'ACTIVE' : 'ACTIVE';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO credits
        (client_id, tenant_id, credit_number, start_date, total_amount, principal_amount,
         monthly_amount, installments_count, annual_rate, amortization_method,
         interest_total, financing_fee, pending_principal, first_due_date, status,
         created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.clientId,
        tenantId,
        'TEMP',
        input.startDate || todayStr(),
        totalAmount,
        principal,
        monthlyAmount,
        terms,
        round2(rate * 10000) / 10000,
        input.method,
        totalInterest,
        fee,
        principal,
        schedule[0]?.dueDate ?? null,
        status,
        userId,
        input.notes?.trim() || null,
      ]
    );
    const creditId = res.insertId;
    const creditNumber = await nextCreditNumber(
      tenantId,
      creditId,
      config.generalConfig.credit_number_prefix || 'CR'
    );
    await conn.query('UPDATE credits SET credit_number = ? WHERE id = ?', [creditNumber, creditId]);

    for (const row of schedule) {
      await conn.query(
        `INSERT INTO credit_installments
          (credit_id, tenant_id, installment_number, amount, principal_part, interest_part,
           capital_balance_before, due_date, status, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)`,
        [
          creditId,
          tenantId,
          row.number,
          row.amount,
          row.principalPart,
          row.interestPart,
          row.capitalBalanceBefore,
          row.dueDate,
          row.amount,
        ]
      );
    }

    if (status === 'ACTIVE') {
      await conn.query('UPDATE credits SET approval_date = ?, disbursement_date = ? WHERE id = ?', [
        todayStr(),
        todayStr(),
        creditId,
      ]);
      try {
        await addCashMovement(
          tenantId,
          userId,
          {
            type: 'DISBURSEMENT',
            amount: principal,
            direction: 'OUT',
            method: 'CASH',
            reference: creditNumber,
            description: `Desembolso de préstamo ${creditNumber}`,
            creditId,
          },
          conn
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === 'register_closed') {
          // Sin caja abierta: el desembolso se registra igualmente (movimiento sin caja)
          await conn.query(
            `INSERT INTO cash_movements
              (tenant_id, register_id, type, amount, direction, method, reference,
               description, credit_id, created_by)
             VALUES (?, NULL, 'DISBURSEMENT', ?, 'OUT', 'CASH', ?, ?, ?, ?)`,
            [tenantId, principal, creditNumber, `Desembolso de préstamo ${creditNumber}`, creditId, userId]
          );
        } else {
          throw err;
        }
      }
    }

    await conn.commit();
    return { id: creditId, creditNumber, status, scheduleCount: terms, totalInterest };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Aprobación / rechazo / desembolso
// ---------------------------------------------------------------------------

export async function approveLoan(
  tenantId: number,
  userId: number,
  creditId: number,
  notes?: string
): Promise<LoanActionResult> {
  const config = await getPlatformConfig(tenantId);
  const credit = await getLoanRow(tenantId, creditId);
  if (credit.status !== 'PENDING') {
    throw ApiError.badRequest('invalid_state', `El crédito está en estado ${credit.status}`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE credits SET status = 'APPROVED', approval_date = ?, notes = COALESCE(?, notes)
        WHERE id = ? AND tenant_id = ?`,
      [todayStr(), notes?.trim() || null, creditId, tenantId]
    );
    if (config.loanConfig.auto_disburse_on_approve) {
      await conn.query(
        `UPDATE credits SET status = 'ACTIVE', disbursement_date = ? WHERE id = ? AND tenant_id = ?`,
        [todayStr(), creditId, tenantId]
      );
      try {
        await addCashMovement(
          tenantId,
          userId,
          {
            type: 'DISBURSEMENT',
            amount: Number(credit.principal_amount),
            direction: 'OUT',
            method: 'CASH',
            reference: credit.credit_number,
            description: `Desembolso de préstamo ${credit.credit_number}`,
            creditId,
          },
          conn
        );
      } catch {
        // sin caja abierta: se omite el movimiento
      }
    }
    await conn.commit();
    return { id: creditId, creditNumber: credit.credit_number, status: 'APPROVED', scheduleCount: 0, totalInterest: 0 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function rejectLoan(
  tenantId: number,
  creditId: number,
  reason?: string
): Promise<void> {
  const credit = await getLoanRow(tenantId, creditId);
  if (credit.status !== 'PENDING') {
    throw ApiError.badRequest('invalid_state', `El crédito está en estado ${credit.status}`);
  }
  await pool.query(
    `UPDATE credits SET status = 'REJECTED', notes = CONCAT_WS(' | ', notes, ?)
      WHERE id = ? AND tenant_id = ?`,
    [reason?.trim() || 'Rechazado', creditId, tenantId]
  );
}

export async function disburseLoan(
  tenantId: number,
  userId: number,
  creditId: number
): Promise<LoanActionResult> {
  const credit = await getLoanRow(tenantId, creditId);
  if (!['APPROVED', 'PENDING'].includes(credit.status)) {
    throw ApiError.badRequest('invalid_state', `El crédito está en estado ${credit.status}`);
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE credits SET status = 'ACTIVE', approval_date = COALESCE(approval_date, ?),
              disbursement_date = ? WHERE id = ? AND tenant_id = ?`,
      [todayStr(), todayStr(), creditId, tenantId]
    );
    await addCashMovement(
      tenantId,
      userId,
      {
        type: 'DISBURSEMENT',
        amount: Number(credit.principal_amount),
        direction: 'OUT',
        method: 'CASH',
        reference: credit.credit_number,
        description: `Desembolso de préstamo ${credit.credit_number}`,
        creditId,
      },
      conn
    );
    await conn.commit();
    return {
      id: creditId,
      creditNumber: credit.credit_number,
      status: 'ACTIVE',
      scheduleCount: 0,
      totalInterest: 0,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getLoanRow(
  tenantId: number,
  creditId: number
): Promise<{ credit_number: string; status: string; principal_amount: number; total_amount: number; client_id: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, credit_number, status, principal_amount, total_amount, client_id FROM credits WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [creditId, tenantId]
  );
  const row = rows[0] as
    | { credit_number: string; status: string; principal_amount: number; total_amount: number; client_id: number }
    | undefined;
  if (!row) throw ApiError.notFound('Crédito no encontrado');
  return row;
}

// ---------------------------------------------------------------------------
// Saldo restante de un crédito
// ---------------------------------------------------------------------------

export async function outstandingBalance(tenantId: number, creditId: number): Promise<{
  remainingPrincipal: number;
  remainingInterest: number;
  pendingPenalty: number;
  total: number;
}> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        COALESCE(SUM(ci.principal_part), 0) AS principal,
        COALESCE(SUM(ci.interest_part), 0) AS interest,
        COALESCE(SUM(ci.penalty_amount), 0) AS penalty
       FROM credit_installments ci
      WHERE ci.credit_id = ? AND ci.tenant_id = ? AND ci.deleted_at IS NULL
        AND ci.status IN ('PENDIENTE', 'VENCIDO', 'ATRASADO')`,
    [creditId, tenantId]
  );
  const row = rows[0] as RowDataPacket;
  const remainingPrincipal = round2(Number(row.principal) || 0);
  const remainingInterest = round2(Number(row.interest) || 0);
  const pendingPenalty = round2(Number(row.penalty) || 0);
  return {
    remainingPrincipal,
    remainingInterest,
    pendingPenalty,
    total: round2(remainingPrincipal + remainingInterest + pendingPenalty),
  };
}

// ---------------------------------------------------------------------------
// Reestructuración (mismo crédito, nuevo cronograma)
// ---------------------------------------------------------------------------

export async function restructureLoan(
  tenantId: number,
  userId: number,
  creditId: number,
  input: { rate: number; method: AmortizationMethod; terms: number; startDate?: string; notes?: string }
): Promise<LoanActionResult> {
  const credit = await getLoanRow(tenantId, creditId);
  if (!['ACTIVE', 'RESTRUCTURED', 'DEFAULTED', 'VENCIDO'].includes(credit.status)) {
    throw ApiError.badRequest('invalid_state', `El crédito no es reestructurable (${credit.status})`);
  }
  const balance = await outstandingBalance(tenantId, creditId);
  if (balance.total <= 0) {
    throw ApiError.badRequest('no_balance', 'El crédito no tiene saldo pendiente');
  }

  const schedule = buildSchedule({
    principal: balance.total,
    annualRatePercent: input.rate,
    installmentsCount: input.terms,
    method: input.method,
    startDate: input.startDate || todayStr(),
  });
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interestPart, 0));
  const totalAmount = round2(schedule.reduce((s, r) => s + r.amount, 0));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Cancela el cronograma anterior
    await conn.query(
      `UPDATE credit_installments SET status = 'CANCELADO'
        WHERE credit_id = ? AND tenant_id = ? AND status IN ('PENDIENTE','VENCIDO','ATRASADO')`,
      [creditId, tenantId]
    );
    await conn.query(
      `UPDATE credits
          SET status = 'RESTRUCTURED', amortization_method = ?, annual_rate = ?,
              monthly_amount = ?, total_amount = ?, interest_total = ?,
              pending_principal = ?, first_due_date = ?, days_late = 0,
              last_overdue_at = NULL, notes = CONCAT_WS(' | ', notes, ?)
        WHERE id = ? AND tenant_id = ?`,
      [
        input.method,
        round2(input.rate * 10000) / 10000,
        schedule[0]?.amount ?? 0,
        totalAmount,
        totalInterest,
        balance.total,
        schedule[0]?.dueDate ?? null,
        input.notes?.trim() || `Reestructuración (${input.terms} cuotas)`,
        creditId,
        tenantId,
      ]
    );
    for (const row of schedule) {
      await conn.query(
        `INSERT INTO credit_installments
          (credit_id, tenant_id, installment_number, amount, principal_part, interest_part,
           capital_balance_before, due_date, status, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)`,
        [
          creditId,
          tenantId,
          row.number,
          row.amount,
          row.principalPart,
          row.interestPart,
          row.capitalBalanceBefore,
          row.dueDate,
          row.amount,
        ]
      );
    }
    void recordActivityFor(tenantId, userId, 'CREDIT', `Crédito ${credit.credit_number} reestructurado`);
    await conn.commit();
    return {
      id: creditId,
      creditNumber: credit.credit_number,
      status: 'RESTRUCTURED',
      scheduleCount: input.terms,
      totalInterest,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Refinanciamiento y renovación (nuevo crédito desde saldo anterior)
// ---------------------------------------------------------------------------

export async function refinanceLoan(
  tenantId: number,
  userId: number,
  creditId: number,
  input: { rate: number; method: AmortizationMethod; terms: number; additionalAmount?: number; startDate?: string; notes?: string; disburseNow?: boolean }
): Promise<LoanActionResult> {
  const oldCredit = await getLoanRow(tenantId, creditId);
  if (!['ACTIVE', 'RESTRUCTURED'].includes(oldCredit.status)) {
    throw ApiError.badRequest('invalid_state', `El crédito origen no es refinanciable (${oldCredit.status})`);
  }
  const balance = await outstandingBalance(tenantId, creditId);
  const additional = round2(Number(input.additionalAmount) || 0);
  const principal = round2(balance.total + additional);
  if (principal <= 0) throw ApiError.badRequest('no_balance', 'El crédito origen no tiene saldo');

  const config = await getPlatformConfig(tenantId);
  const schedule = buildSchedule({
    principal,
    annualRatePercent: input.rate,
    installmentsCount: input.terms,
    method: input.method,
    startDate: input.startDate || todayStr(),
  });
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interestPart, 0));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Cierra el crédito anterior
    await conn.query(
      `UPDATE credit_installments SET status = 'CANCELADO'
        WHERE credit_id = ? AND tenant_id = ? AND status IN ('PENDIENTE','VENCIDO','ATRASADO')`,
      [creditId, tenantId]
    );
    await conn.query(
      `UPDATE credits SET status = 'REFINANCED', pending_principal = 0
        WHERE id = ? AND tenant_id = ?`,
      [creditId, tenantId]
    );

    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO credits
        (client_id, tenant_id, credit_number, start_date, total_amount, principal_amount,
         monthly_amount, installments_count, annual_rate, amortization_method,
         interest_total, financing_fee, pending_principal, first_due_date, status,
         refinanced_from, previous_balance, created_by, notes)
       VALUES (?, ?, 'TEMP', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [
        oldCredit.client_id,
        tenantId,
        input.startDate || todayStr(),
        round2(schedule.reduce((s, r) => s + r.amount, 0)),
        principal,
        schedule[0]?.amount ?? 0,
        input.terms,
        round2(input.rate * 10000) / 10000,
        input.method,
        totalInterest,
        principal,
        schedule[0]?.dueDate ?? null,
        creditId,
        balance.total,
        userId,
        input.notes?.trim() || `Refinanciamiento de ${oldCredit.credit_number}`,
      ]
    );
    const newCreditId = res.insertId;
    const creditNumber = await nextCreditNumber(
      tenantId,
      newCreditId,
      config.generalConfig.credit_number_prefix || 'CR'
    );
    await conn.query('UPDATE credits SET credit_number = ? WHERE id = ?', [creditNumber, newCreditId]);

    for (const row of schedule) {
      await conn.query(
        `INSERT INTO credit_installments
          (credit_id, tenant_id, installment_number, amount, principal_part, interest_part,
           capital_balance_before, due_date, status, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)`,
        [
          newCreditId,
          tenantId,
          row.number,
          row.amount,
          row.principalPart,
          row.interestPart,
          row.capitalBalanceBefore,
          row.dueDate,
          row.amount,
        ]
      );
    }

    const disburse = input.disburseNow !== false;
    if (disburse) {
      await conn.query(
        'UPDATE credits SET approval_date = ?, disbursement_date = ? WHERE id = ?',
        [todayStr(), todayStr(), newCreditId]
      );
      try {
        await addCashMovement(
          tenantId,
          userId,
          {
            type: 'DISBURSEMENT',
            amount: principal,
            direction: 'OUT',
            method: 'CASH',
            reference: creditNumber,
            description: `Desembolso de refinanciamiento ${creditNumber}`,
            creditId: newCreditId,
          },
          conn
        );
      } catch {
        // sin caja abierta
      }
    }

    void recordActivityFor(
      tenantId,
      userId,
      'CREDIT',
      `Crédito ${oldCredit.credit_number} refinanciado → ${creditNumber} (RD$${principal.toLocaleString()})`
    );
    await conn.commit();
    return {
      id: newCreditId,
      creditNumber,
      status: 'ACTIVE',
      scheduleCount: input.terms,
      totalInterest,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function renewLoan(
  tenantId: number,
  userId: number,
  creditId: number,
  input: { rate: number; method: AmortizationMethod; terms: number; startDate?: string; notes?: string }
): Promise<LoanActionResult> {
  return refinanceLoan(tenantId, userId, creditId, {
    rate: input.rate,
    method: input.method,
    terms: input.terms,
    additionalAmount: 0,
    startDate: input.startDate,
    notes: input.notes ? `Renovación: ${input.notes}` : 'Renovación de crédito',
  });
}

// ---------------------------------------------------------------------------
// Condonaciones y descuentos
// ---------------------------------------------------------------------------

export async function condoneInstallment(
  tenantId: number,
  userId: number,
  installmentId: number,
  input: { type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount?: number }
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id, ci.amount, ci.total_amount, ci.penalty_amount, ci.paid_amount, ci.status,
            c.credit_number
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE ci.id = ? AND ci.tenant_id = ? AND ci.deleted_at IS NULL`,
    [installmentId, tenantId]
  );
  const inst = rows[0] as
    | { id: number; amount: number; total_amount: number; penalty_amount: number; paid_amount: number; status: string; credit_number: string }
    | undefined;
  if (!inst) throw ApiError.notFound('Cuota no encontrada');
  if (inst.status === 'PAGADO' || inst.status === 'CANCELADO') {
    throw ApiError.badRequest('invalid_state', 'La cuota ya está pagada o cancelada');
  }

  let penalty = Number(inst.penalty_amount) || 0;
  let total = Number(inst.total_amount) || 0;
  let amount = Number(input.amount) || 0;

  if (input.type === 'PENALTY') {
    if (penalty <= 0) throw ApiError.badRequest('no_penalty', 'La cuota no tiene mora');
    total = round2(total - penalty);
    penalty = 0;
  } else if (input.type === 'INTEREST') {
    const [ivRows] = await pool.query<RowDataPacket[]>(
      'SELECT interest_part FROM credit_installments WHERE id = ? AND tenant_id = ?',
      [installmentId, tenantId]
    );
    const interestPart = Number(ivRows[0]?.interest_part) || 0;
    const toWaive = amount > 0 ? Math.min(amount, interestPart) : interestPart;
    if (toWaive <= 0) throw ApiError.badRequest('no_interest', 'La cuota no tiene interés que condonar');
    total = round2(total - toWaive);
  } else {
    if (!(amount > 0)) throw ApiError.badRequest('invalid_amount', 'Monto a condonar inválido');
    const max = round2(total - Number(inst.paid_amount || 0));
    if (amount > max) throw ApiError.badRequest('invalid_amount', 'El monto excede lo pendiente de la cuota');
    total = round2(total - amount);
  }

  await pool.query(
    'UPDATE credit_installments SET penalty_amount = ?, total_amount = ? WHERE id = ? AND tenant_id = ?',
    [penalty, total, installmentId, tenantId]
  );
  void recordActivityFor(
    tenantId,
    userId,
    'CREDIT',
    `Condonación en cuota #${installmentId} del crédito ${inst.credit_number} (${input.type})`
  );
}

export async function condoneCredit(
  tenantId: number,
  userId: number,
  creditId: number,
  input: { type: 'PENALTY' | 'INTEREST' | 'AMOUNT'; amount?: number }
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM credit_installments WHERE credit_id = ? AND tenant_id = ? AND deleted_at IS NULL AND status IN (?,?,?)',
    [creditId, tenantId, 'PENDIENTE', 'VENCIDO', 'ATRASADO']
  );
  const ids = rows.map((r) => Number(r.id));
  let affected = 0;
  for (const id of ids) {
    await condoneInstallment(tenantId, userId, id, input);
    affected++;
  }
  return affected;
}

// ---------------------------------------------------------------------------
// Acuerdos de pago
// ---------------------------------------------------------------------------

export interface AgreementInput {
  creditId: number;
  clientId: number;
  agreedDate?: string;
  totalAmount?: number;
  initialPayment?: number;
  terms: number;
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM';
  firstDueDate?: string;
  notes?: string;
}

export async function createAgreement(
  tenantId: number,
  userId: number,
  input: AgreementInput
): Promise<{ id: number }> {
  const [creditRows] = await pool.query<RowDataPacket[]>(
    'SELECT id, credit_number, client_id, status FROM credits WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [input.creditId, tenantId]
  );
  const credit = creditRows[0] as { credit_number: string; client_id: number; status: string } | undefined;
  if (!credit) throw ApiError.notFound('Crédito no encontrado');
  if (!['ACTIVE', 'RESTRUCTURED', 'DEFAULTED'].includes(credit.status)) {
    throw ApiError.badRequest('invalid_state', 'El crédito no admite acuerdos de pago');
  }
  if (input.clientId !== credit.client_id) {
    throw ApiError.badRequest('invalid_client', 'El cliente no coincide con el crédito');
  }
  const terms = Math.floor(Number(input.terms) || 1);
  if (!(terms > 0) || terms > 60) throw ApiError.badRequest('invalid_terms', 'Plazo del acuerdo 1-60');

  const balance = await outstandingBalance(tenantId, input.creditId);
  const total = input.totalAmount != null && input.totalAmount > 0 ? round2(input.totalAmount) : balance.total;

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO payment_agreements
      (tenant_id, credit_id, client_id, agreed_date, total_amount, initial_payment,
       terms, frequency, first_due_date, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    [
      tenantId,
      input.creditId,
      input.clientId,
      input.agreedDate || todayStr(),
      total,
      round2(input.initialPayment || 0),
      terms,
      input.frequency,
      input.firstDueDate || todayStr(),
      input.notes?.trim() || null,
      userId,
    ]
  );
  void recordActivityFor(
    tenantId,
    userId,
    'CREDIT',
    `Acuerdo de pago creado para ${credit.credit_number} (RD$${total.toLocaleString()})`
  );
  return { id: res.insertId };
}

export async function listAgreements(
  tenantId: number,
  opts: { creditId?: number; clientId?: number; status?: string }
): Promise<RowDataPacket[]> {
  const where: string[] = ['pa.tenant_id = ?', 'pa.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];
  if (opts.creditId) {
    where.push('pa.credit_id = ?');
    params.push(opts.creditId);
  }
  if (opts.clientId) {
    where.push('pa.client_id = ?');
    params.push(opts.clientId);
  }
  if (opts.status) {
    where.push('pa.status = ?');
    params.push(opts.status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT pa.id, pa.credit_id, c.credit_number, pa.client_id, cl.full_name AS client_name,
            pa.agreed_date, pa.total_amount, pa.initial_payment, pa.terms, pa.frequency,
            pa.first_due_date, pa.status, pa.notes, pa.created_at
       FROM payment_agreements pa
       JOIN credits c ON c.id = pa.credit_id
       JOIN clients cl ON cl.id = pa.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY pa.id DESC`,
    params
  );
  return rows;
}

export async function setAgreementStatus(
  tenantId: number,
  agreementId: number,
  status: 'COMPLETED' | 'BREACHED' | 'CANCELED'
): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE payment_agreements SET status = ?
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND status IN ('ACTIVE','PENDING')`,
    [status, agreementId, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Acuerdo no encontrado o no modificable');
}

// ---------------------------------------------------------------------------
// Motor de mora automática (server-side)
// ---------------------------------------------------------------------------

export interface OverdueRunResult {
  tenantId: number;
  penalized: number;
  defaulted: number;
  errors: string[];
}

export async function runOverdueEngine(
  tenantId: number,
  today?: string
): Promise<OverdueRunResult> {
  const day = today || todayStr();
  const config = await getPlatformConfig(tenantId);
  const overdue: OverdueConfig = {
    ...config.overdueConfig,
    fixed_amount: Number(config.overdueConfig.fixed_amount || 0),
    percentage_rate: Number(config.overdueConfig.percentage_rate || 0),
    grace_days: Number(config.overdueConfig.grace_days ?? 3),
    max_amount: config.overdueConfig.max_amount != null ? Number(config.overdueConfig.max_amount) : null,
    cap_percent: config.overdueConfig.cap_percent != null ? Number(config.overdueConfig.cap_percent) : null,
  };
  const mdmConfig = config.integrations.find((i) => i.code === 'INOVAGUARD' && i.enabled);
  void mdmConfig;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id AS installment_id, ci.credit_id, ci.amount, ci.penalty_amount,
            ci.total_amount, ci.due_date, ci.last_penalty_calc, ci.status,
            ci.principal_part, c.credit_number, c.status AS credit_status,
            c.client_id, c.days_late
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE ci.tenant_id = ?
        AND c.deleted_at IS NULL AND ci.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'RESTRUCTURED')
        AND ci.status IN ('PENDIENTE', 'VENCIDO', 'ATRASADO')
        AND ci.due_date < ?`,
    [tenantId, day]
  );

  let penalized = 0;
  let defaulted = 0;
  const errors: string[] = [];
  const creditLates = new Map<number, number>();

  for (const row of rows as RowDataPacket[]) {
    const penaltyRes = overduePenalty({
      config: overdue,
      installmentAmount: Number(row.amount),
      capitalBalanceBefore: Number(row.principal_part) || Number(row.amount),
      dueDate: toIsoDate(row.due_date),
      lastCalc: row.last_penalty_calc ? toIsoDate(row.last_penalty_calc) : null,
      today: day,
    });

    const penalty = Number.isFinite(penaltyRes.penalty) ? penaltyRes.penalty : 0;
    const wasPaid = row.status === 'PAGADO';
    void wasPaid;
    const newStatus = penalty > 0 ? 'ATRASADO' : 'VENCIDO';
    const newTotal = round2(Number(row.amount) + penalty);
    const currentTotal = Number(row.total_amount) || newTotal;
    const totalDelta = round2(newTotal - currentTotal);

    if (newStatus !== row.status || penalty !== Number(row.penalty_amount) || totalDelta !== 0) {
      await pool.query(
        `UPDATE credit_installments
            SET status = ?, penalty_amount = ?, total_amount = ?, last_penalty_calc = ?
          WHERE id = ? AND tenant_id = ?`,
        [newStatus, penalty, newTotal, day, row.installment_id, tenantId]
      );
    }

    const lateDays = Math.max(Number(row.days_late) || 0, penaltyRes.daysLate);
    creditLates.set(Number(row.credit_id), Math.max(creditLates.get(Number(row.credit_id)) || 0, lateDays));
    if (penalty > 0) penalized++;
  }

  // Actualizar días de atraso y estado de cada crédito
  for (const [creditId, daysLate] of creditLates) {
    await pool.query(
      `UPDATE credits SET days_late = ?, last_overdue_at = ?
        WHERE id = ? AND tenant_id = ?`,
      [daysLate, day, creditId, tenantId]
    );
    if (daysLate > 90) {
      await pool.query(
        `UPDATE credits SET status = 'DEFAULTED' WHERE id = ? AND tenant_id = ? AND status IN ('ACTIVE','RESTRUCTURED')`,
        [creditId, tenantId]
      );
      defaulted++;
    }
  }

  // Bloqueo MDM automático por mora (una vez por crédito)
  const [lockedCredits] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT c.id
       FROM credits c
       JOIN credit_installments ci ON ci.credit_id = c.id
      WHERE c.tenant_id = ? AND c.status IN ('ACTIVE','RESTRUCTURED')
        AND ci.tenant_id = ? AND ci.deleted_at IS NULL
        AND ci.status = 'ATRASADO'
        AND ci.due_date < DATE_SUB(?, INTERVAL ? DAY)`,
    [tenantId, tenantId, day, Math.max(overdue.grace_days, 1)]
  );
  for (const row of lockedCredits as RowDataPacket[]) {
    const creditId = Number(row.id);
    try {
      await autoLockOverdueDevice(tenantId, creditId);
    } catch (err) {
      errors.push(`lock:${creditId}:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { tenantId, penalized, defaulted, errors };
}

async function autoLockOverdueDevice(tenantId: number, creditId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.id, d.inovaguard_id, d.mdm_status
       FROM devices d
       JOIN credits c ON c.client_id = d.client_id
      WHERE d.tenant_id = ? AND c.id = ? AND c.tenant_id = ?
        AND d.deleted_at IS NULL AND d.mdm_status = 'UNLOCKED' AND d.inovaguard_id IS NOT NULL
      LIMIT 1`,
    [tenantId, creditId, tenantId]
  );
  const device = rows[0] as { id: number; inovaguard_id: string; mdm_status: string } | undefined;
  if (!device) return;

  const config = await getPlatformConfig(tenantId);
  const mdmIntegration = config.integrations.find((i) => i.code === 'INOVAGUARD');
  const [settingsRows] = await pool.query<RowDataPacket[]>(
    'SELECT mdm_config FROM tenant_settings WHERE tenant_id = ?',
    [tenantId]
  );
  let mdm: MdmConfig = {
    ...DEFAULT_MDM_CONFIG,
    provider: 'INOVAGUARD',
    autoUnlockOnPaid: true,
    autoLockOnOverdue: true,
    enabled: false,
    baseUrl: '',
    apiKey: '',
    appClient: '',
    secret: '',
    bearerToken: '',
    authLoginEndpoint: '/auth/login',
    devicesEndpoint: '/devices',
    lockEndpoint: '/devices/lock/{id}',
    unlockEndpoint: '/devices/unlock/{id}',
    unlockCodeEndpoint: '/devices/unlock-code/{id}',
    removeEndpoint: '/devices/remove/{id}',
    qrEndpoint: '/devices/qr-enrollment',
    balanceEndpoint: '/balance',
    statusEndpoint: '/devices/find/{id}',
    liveMode: false,
  };
  try {
    const raw = settingsRows[0]?.mdm_config;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') mdm = { ...mdm, ...(parsed as object) };
  } catch {
    // config por defecto
  }
  void mdmIntegration;
  if (!mdm.enabled || !mdm.autoLockOnOverdue) return;

  const res = await lockInovaGuardDevice(tenantId, mdm, device.inovaguard_id);
  await pool.query(
    `INSERT INTO device_locks
      (device_id, tenant_id, trigger_source, reason, requested_at, completed_at, result, details)
     VALUES (?, ?, 'AUTO_OVERDUE', 'Bloqueo automático por mora', NOW(), NOW(), ?, ?)`,
    [device.id, tenantId, res.err ? 'FAILED' : 'SUCCESS', res.message]
  );
  await pool.query(
    `INSERT INTO device_events
      (device_id, tenant_id, trigger_source, action, status, details)
     VALUES (?, ?, 'AUTOMATIC_OVERDUE', 'LOCK', ?, ?)`,
    [device.id, tenantId, res.err ? 'FAILED' : 'SUCCESS', res.message]
  );
  if (!res.err) {
    await pool.query(
      `UPDATE devices SET mdm_status = 'LOCKED', last_mdm_sync_at = NOW(), last_mdm_sync_note = ?
        WHERE id = ? AND tenant_id = ?`,
      [res.message, device.id, tenantId]
    );
  }
  await recordIntegrationStatus(tenantId, 'INOVAGUARD', {
    last_sync_at: new Date().toISOString(),
    last_error: res.err ? res.message : null,
    connection_ok: !res.err,
  });
}

// ---------------------------------------------------------------------------
// Puntaje y clasificación de cliente
// ---------------------------------------------------------------------------

export async function recomputeClientScore(tenantId: number, clientId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(ci.status = 'PAGADO'), 0) AS pagadas,
        COALESCE(SUM(ci.status IN ('ATRASADO','VENCIDO')), 0) AS atrasadas,
        COALESCE(SUM(c.status = 'PAID_OFF'), 0) AS paid_off
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE ci.tenant_id = ? AND c.client_id = ? AND ci.deleted_at IS NULL`,
    [tenantId, clientId]
  );
  const row = rows[0] as RowDataPacket;
  const total = Number(row.total) || 0;
  const pagadas = Number(row.pagadas) || 0;
  const atrasadas = Number(row.atrasadas) || 0;
  const paidOff = Number(row.paid_off) || 0;

  let score = 50;
  if (total > 0) score += Math.round((pagadas / total) * 50);
  if (atrasadas === 0 && total > 0) score += 15;
  score += Math.min(15, paidOff * 5);
  score = Math.max(0, Math.min(100, score));

  const classification = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';

  const [clientRows] = await pool.query<RowDataPacket[]>(
    'SELECT monthly_income, monthly_expenses FROM clients WHERE id = ? AND tenant_id = ?',
    [clientId, tenantId]
  );
  const c = clientRows[0] as { monthly_income: number; monthly_expenses: number } | undefined;
  const capacity =
    c && Number(c.monthly_income) > 0
      ? round2(Number(c.monthly_income) - (Number(c.monthly_expenses) || 0))
      : null;

  await pool.query(
    `UPDATE clients SET internal_score = ?, classification = ?, payment_capacity = ?,
            status = CASE WHEN ? > 0 AND ? IN ('ACTIVE') THEN 'DELINQUENT' ELSE status END
      WHERE id = ? AND tenant_id = ?`,
    [score, classification, capacity, atrasadas, atrasadas, clientId, tenantId]
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordActivityFor(
  tenantId: number,
  userId: number,
  type: string,
  message: string
): void {
  void pool
    .query('INSERT INTO activity_logs (tenant_id, user_id, type, message) VALUES (?, ?, ?, ?)', [
      tenantId,
      userId,
      type,
      message,
    ])
    .catch(() => undefined);
}

export function quoteLoan(input: {
  principal: number;
  annualRate: number;
  method: AmortizationMethod;
  installmentsCount: number;
  startDate?: string;
}) {
  return loanQuote({
    principal: Number(input.principal) || 0,
    annualRatePercent: Number(input.annualRate) || 0,
    method: input.method,
    installmentsCount: Math.floor(Number(input.installmentsCount) || 0),
    startDate: input.startDate,
  });
}

export type { ScheduleRow };
