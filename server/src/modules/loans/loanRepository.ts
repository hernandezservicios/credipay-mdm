import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { ApiError } from '../../utils/http.js';

/**
 * Consultas agregadas de prestamos (D24) - una sola query sin N+1 (R15).
 */

export interface ListLoansFilters {
  search?: string;
  status?: string;
  page?: number;
  perPage?: number;
}

export interface LoanListRow {
  id: number;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  creditNumber: string;
  startDate: string;
  totalAmount: number;
  outstanding: number;
  monthlyAmount: number;
  installmentsCount: number;
  pendingCount: number;
  nextDue: string | null;
  status: string;
  daysLate: number;
  lastPaymentAt: string | null;
}

export async function listLoans(
  tenantId: number,
  opts: ListLoansFilters = {}
): Promise<{ data: LoanListRow[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 20), 100);

  const where: string[] = ['c.tenant_id = ?', 'c.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (opts.status) {
    where.push('c.status = ?');
    params.push(opts.status);
  }
  if (opts.search && opts.search.trim()) {
    where.push('(cl.full_name LIKE ? OR c.credit_number LIKE ?)');
    const like = `%${opts.search.trim()}%`;
    params.push(like, like);
  }

  const whereSql = where.join(' AND ');

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
      WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.client_id AS clientId, cl.full_name AS clientName,
            cl.phone AS clientPhone, c.credit_number AS creditNumber,
            DATE_FORMAT(c.start_date, '%Y-%m-%d') AS startDate,
            c.total_amount AS totalAmount, c.monthly_amount AS monthlyAmount,
            c.installments_count AS installmentsCount, c.status,
            COALESCE(c.days_late, 0) AS daysLate,
            DATE_FORMAT(c.last_payment_at, '%Y-%m-%d') AS lastPaymentAt,
            COUNT(ci.id) AS pendingCount,
            COALESCE(SUM(
              CASE WHEN ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')
                   THEN ci.total_amount - COALESCE(ci.paid_amount, 0)
                   ELSE 0 END
            ), 0) AS outstanding,
            MIN(CASE WHEN ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')
                     THEN ci.due_date END) AS nextDue
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN credit_installments ci
              ON ci.credit_id = c.id AND ci.deleted_at IS NULL
      WHERE ${whereSql}
      GROUP BY c.id
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage]
  );

  return {
    data: (rows as RowDataPacket[]).map((r) => ({
      id: Number(r.id),
      clientId: Number(r.clientId),
      clientName: String(r.clientName),
      clientPhone: r.clientPhone as string | null,
      creditNumber: String(r.creditNumber),
      startDate: String(r.startDate),
      totalAmount: Number(r.totalAmount),
      outstanding: Number(r.outstanding),
      monthlyAmount: Number(r.monthlyAmount),
      installmentsCount: Number(r.installmentsCount),
      pendingCount: Number(r.pendingCount),
      nextDue: r.nextDue as string | null,
      status: String(r.status),
      daysLate: Number(r.daysLate),
      lastPaymentAt: r.lastPaymentAt as string | null,
    })),
    pagination: { page, perPage, total },
  };
}

export interface LoanDetail {
  credit: RowDataPacket;
  client: RowDataPacket;
  installments: RowDataPacket[];
}

export async function getLoanDetail(tenantId: number, creditId: number): Promise<LoanDetail> {
  const [creditRows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.client_id, cl.full_name AS client_name, cl.phone AS client_phone,
            cl.cedula_or_id, cl.avatar_url, c.credit_number, c.start_date, c.total_amount,
            c.principal_amount, c.annual_rate, c.amortization_method, c.interest_total,
            c.pending_principal, c.financing_fee, c.days_late, c.last_payment_at,
            c.approval_date, c.disbursement_date, c.first_due_date, c.monthly_amount,
            c.installments_count, c.status, c.notes, c.created_at
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL`,
    [creditId, tenantId]
  );
  const credit = creditRows[0];
  if (!credit) throw ApiError.notFound('Préstamo no encontrado');

  const [installments] = await pool.query<RowDataPacket[]>(
    `SELECT id, installment_number, amount, principal_part, interest_part, due_date,
            status, penalty_amount, total_amount, paid_date, payment_reference,
            COALESCE(paid_amount, 0) AS paid_amount
       FROM credit_installments
      WHERE credit_id = ? AND tenant_id = ? AND deleted_at IS NULL
      ORDER BY installment_number`,
    [creditId, tenantId]
  );

  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, full_name, cedula_or_id, phone, email, address, avatar_url, status,
            notes, created_at
       FROM clients
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [credit.client_id, tenantId]
  );
  const client = clientRows[0] ?? null;

  return { credit, client, installments };
}