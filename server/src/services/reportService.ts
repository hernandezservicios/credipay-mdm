// ============================================================
// CrediPay MDM - Motor de reportes
// 25 tipos de reporte operativo con filtros, paginación y
// exportación CSV (compatible Excel con BOM UTF-8).
// ============================================================

import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';

export interface ReportMeta {
  key: string;
  label: string;
  group: string;
}

export const REPORT_TYPES: ReportMeta[] = [
  { key: 'cobros-dia', label: 'Cobros del día', group: 'Dashboard' },
  { key: 'despachos-dia', label: 'Despachos del día', group: 'Dashboard' },
  { key: 'cartera-clientes', label: 'Cartera de clientes', group: 'Clientes' },
  { key: 'clientes-nuevos', label: 'Clientes nuevos', group: 'Clientes' },
  { key: 'clientes-score', label: 'Clientes por score', group: 'Clientes' },
  { key: 'referencias-clientes', label: 'Referencias de clientes', group: 'Clientes' },
  { key: 'creditos-prestados', label: 'Préstamos otorgados', group: 'Préstamos' },
  { key: 'creditos-estado', label: 'Créditos por estado', group: 'Préstamos' },
  { key: 'cronogramas', label: 'Cronogramas de cuotas', group: 'Préstamos' },
  { key: 'desembolsos', label: 'Desembolsos', group: 'Préstamos' },
  { key: 'refinanciamientos', label: 'Refinanciamientos', group: 'Préstamos' },
  { key: 'reestructuraciones', label: 'Reestructuraciones', group: 'Préstamos' },
  { key: 'renovaciones', label: 'Renovaciones', group: 'Préstamos' },
  { key: 'condonaciones', label: 'Condonaciones', group: 'Préstamos' },
  { key: 'mora', label: 'Mora y morosidad', group: 'Cobranza' },
  { key: 'cuotas-vencidas', label: 'Cuotas vencidas', group: 'Cobranza' },
  { key: 'cobros-periodo', label: 'Cobros por período', group: 'Cobranza' },
  { key: 'pagos-metodo', label: 'Pagos por método', group: 'Cobranza' },
  { key: 'acuerdos-pago', label: 'Acuerdos de pago', group: 'Cobranza' },
  { key: 'movimientos-caja', label: 'Movimientos de caja', group: 'Caja' },
  { key: 'registros-caja', label: 'Registros de caja', group: 'Caja' },
  { key: 'dispositivos', label: 'Inventario de dispositivos', group: 'Dispositivos' },
  { key: 'dispositivos-bloqueados', label: 'Dispositivos bloqueados', group: 'Dispositivos' },
  { key: 'desbloqueos', label: 'Desbloqueos de dispositivos', group: 'Dispositivos' },
  { key: 'auditoria', label: 'Registro de auditoría', group: 'Sistema' },
  { key: 'actividad', label: 'Actividad reciente', group: 'Sistema' },
];

const REPORT_KEYS = new Set(REPORT_TYPES.map((r) => r.key));

export interface ReportOptions {
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  perPage?: number;
}

interface ReportQuery {
  sql: string;
  params: unknown[];
  headers: string[];
  translate?: (row: RowDataPacket) => RowDataPacket;
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v);
};

export function csvEscape(value: unknown): string {
  const s = text(value).replace(/"/g, '""');
  return `"${s}"`;
}

export function buildCsv(headers: string[], rows: RowDataPacket[]): string {
  const head = headers.map(csvEscape).join(';');
  const lines = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(';'));
  return `\uFEFF${head}\n${lines.join('\n')}`;
}

function period(date: string): string {
  return date.slice(0, 7);
}

export async function computeReport(
  tenantId: number,
  key: string,
  opts: ReportOptions
): Promise<{
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  data: RowDataPacket[];
  headers: string[];
  pagination: { page: number; perPage: number; total: number };
}> {
  if (!REPORT_KEYS.has(key)) throw ApiError.notFound('Reporte no encontrado');
  const meta = REPORT_TYPES.find((r) => r.key === key)!;
  const query = buildQuery(tenantId, key, opts);
  const total = await countRows(tenantId, key, opts);

  const [rows] = await pool.query<RowDataPacket[]>(query.sql, query.params);
  const data = query.translate ? rows.map(query.translate) : rows;

  return {
    key,
    label: meta.label,
    from: opts.from || null,
    to: opts.to || null,
    data,
    headers: query.headers,
    pagination: { page: opts.page || 1, perPage: opts.perPage || 100, total },
  };
}

async function countRows(
  tenantId: number,
  key: string,
  opts: ReportOptions
): Promise<number> {
  const from = opts.from;
  const to = opts.to;
  const status = opts.status;
  const base: Record<string, { sql: string; params: unknown[] }> = {
    'cobros-dia': {
      sql: 'SELECT COUNT(*) AS n FROM payments_received p WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.received_date = CURDATE()',
      params: [tenantId],
    },
    'despachos-dia': {
      sql: 'SELECT COUNT(*) AS n FROM credits c WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.disbursement_date IS NOT NULL AND c.disbursement_date = CURDATE()',
      params: [tenantId],
    },
    'cartera-clientes': {
      sql: 'SELECT COUNT(*) AS n FROM clients cl WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL',
      params: [tenantId],
    },
    'clientes-nuevos': {
      sql: `SELECT COUNT(*) AS n FROM clients cl
             WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL
               AND (cl.created_at >= ? AND cl.created_at <= ?)`,
      params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`],
    },
    'clientes-score': {
      sql: 'SELECT COUNT(*) AS n FROM clients cl WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL AND cl.internal_score IS NOT NULL',
      params: [tenantId],
    },
    'referencias-clientes': {
      sql: 'SELECT COUNT(*) AS n FROM clients cl WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL AND (cl.personal_refs IS NOT NULL OR cl.commercial_refs IS NOT NULL)',
      params: [tenantId],
    },
    'creditos-prestados': {
      sql: `SELECT COUNT(*) AS n FROM credits c
             WHERE c.tenant_id = ? AND c.deleted_at IS NULL
               AND (c.start_date >= ? AND c.start_date <= ?)`,
      params: [tenantId, from || '0000-01-01', to || '9999-12-31'],
    },
    'creditos-estado': {
      sql: 'SELECT COUNT(*) AS n FROM credits c WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status = ?',
      params: [tenantId, status || 'ACTIVE'],
    },
    cronogramas: {
      sql: 'SELECT COUNT(*) AS n FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL AND ci.status IN (?, ?, ?)',
      params: [tenantId, 'PENDIENTE', 'VENCIDO', 'ATRASADO'],
    },
    desembolsos: {
      sql: `SELECT COUNT(*) AS n FROM credits c
             WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.disbursement_date IS NOT NULL
               AND (c.disbursement_date >= ? AND c.disbursement_date <= ?)`,
      params: [tenantId, from || '0000-01-01', to || '9999-12-31'],
    },
    refinanciamientos: {
      sql: `SELECT COUNT(*) AS n FROM credits c
             WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.refinanced_from IS NOT NULL
               AND (c.start_date >= ? AND c.start_date <= ?)`,
      params: [tenantId, from || '0000-01-01', to || '9999-12-31'],
    },
    reestructuraciones: {
      sql: `SELECT COUNT(*) AS n FROM credits c
             WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status = 'RESTRUCTURED'
               AND (c.updated_at >= ? AND c.updated_at <= ?)`,
      params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`],
    },
    renovaciones: {
      sql: `SELECT COUNT(*) AS n FROM credits c
             WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.notes LIKE ?
               AND (c.start_date >= ? AND c.start_date <= ?)`,
      params: [tenantId, '%Renovación%', from || '0000-01-01', to || '9999-12-31'],
    },
    condonaciones: {
      sql: 'SELECT COUNT(*) AS n FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL AND ci.total_amount < ci.amount',
      params: [tenantId],
    },
    mora: {
      sql: 'SELECT COUNT(*) AS n FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.status IN (?, ?)',
      params: [tenantId, 'ATRASADO', 'VENCIDO'],
    },
    'cuotas-vencidas': {
      sql: 'SELECT COUNT(*) AS n FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.status = ? AND ci.due_date < CURDATE()',
      params: [tenantId, 'ATRASADO'],
    },
    'cobros-periodo': {
      sql: 'SELECT COUNT(*) AS n FROM payments_received p WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.received_date >= ? AND p.received_date <= ?)',
      params: [tenantId, from || '0000-01-01', to || '9999-12-31'],
    },
    'pagos-metodo': {
      sql: 'SELECT COUNT(DISTINCT method) AS n FROM payments_received p WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.received_date >= ? AND p.received_date <= ?)',
      params: [tenantId, from || '0000-01-01', to || '9999-12-31'],
    },
    'acuerdos-pago': {
      sql: 'SELECT COUNT(*) AS n FROM payment_agreements pa WHERE pa.tenant_id = ? AND pa.deleted_at IS NULL',
      params: [tenantId],
    },
    'movimientos-caja': {
      sql: `SELECT COUNT(*) AS n FROM cash_movements cm
             WHERE cm.tenant_id = ? AND (cm.created_at >= ? AND cm.created_at <= ?)`,
      params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`],
    },
    'registros-caja': {
      sql: 'SELECT COUNT(*) AS n FROM cash_registers cr WHERE cr.tenant_id = ?',
      params: [tenantId],
    },
    dispositivos: {
      sql: 'SELECT COUNT(*) AS n FROM devices d WHERE d.tenant_id = ? AND d.deleted_at IS NULL',
      params: [tenantId],
    },
    'dispositivos-bloqueados': {
      sql: "SELECT COUNT(*) AS n FROM devices d WHERE d.tenant_id = ? AND d.deleted_at IS NULL AND d.mdm_status = 'LOCKED'",
      params: [tenantId],
    },
    desbloqueos: {
      sql: 'SELECT COUNT(*) AS n FROM device_unlocks du WHERE du.tenant_id = ?',
      params: [tenantId],
    },
    auditoria: {
      sql: 'SELECT COUNT(*) AS n FROM audit_logs al WHERE al.tenant_id = ?',
      params: [tenantId],
    },
    actividad: {
      sql: 'SELECT COUNT(*) AS n FROM activity_logs al WHERE al.tenant_id = ?',
      params: [tenantId],
    },
  };

  const data = base[key];
  const [rows] = await pool.query<RowDataPacket[]>(data.sql, data.params);
  return Number((rows[0] as RowDataPacket).n) || 0;
}

function buildQuery(tenantId: number, key: string, opts: ReportOptions): ReportQuery {
  const from = opts.from;
  const to = opts.to;
  const status = opts.status;
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 100), 500);
  const offset = (page - 1) * perPage;

  const byDate = (col: string) =>
    `(${col} >= ? AND ${col} <= ?)`;

  switch (key) {
    case 'cobros-dia':
      return {
        headers: ['id', 'client', 'credit', 'amount', 'method', 'received_by', 'reference', 'received_date'],
        sql: `SELECT p.id, cl.full_name AS client, p.credit_id AS credit, p.amount,
                     p.method, u.name AS received_by, p.reference, p.received_date
                FROM payments_received p
                JOIN clients cl ON cl.id = p.client_id
                LEFT JOIN users u ON u.id = p.received_by
               WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.received_date = CURDATE()
               ORDER BY p.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
        translate: (r) => ({ ...r, method: r.method }),
      };
    case 'despachos-dia':
      return {
        headers: ['id', 'credit_number', 'client', 'principal', 'method', 'disbursement_date'],
        sql: `SELECT c.id, c.credit_number, cl.full_name AS client, c.principal_amount AS principal,
                     c.amortization_method AS method, c.disbursement_date
                FROM credits c
                JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.disbursement_date IS NOT NULL
                 AND c.disbursement_date = CURDATE()
               ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'cartera-clientes':
      return {
        headers: ['id', 'full_name', 'cedula', 'phone', 'status', 'classification', 'score', 'credit_count', 'pending_amount', 'device'],
        sql: `SELECT cl.id, cl.full_name, cl.cedula_or_id AS cedula, cl.phone, cl.status,
                     cl.classification, cl.internal_score AS score,
                     (SELECT COUNT(*) FROM credits c WHERE c.client_id = cl.id AND c.deleted_at IS NULL AND c.status IN ('ACTIVE','RESTRUCTURED')) AS credit_count,
                     (SELECT COALESCE(SUM(ci.total_amount - COALESCE(ci.paid_amount,0)),0)
                        FROM credit_installments ci JOIN credits c ON c.id = ci.credit_id
                       WHERE c.client_id = cl.id AND ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')) AS pending_amount,
                     (SELECT model FROM devices d WHERE d.client_id = cl.id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1) AS device
                FROM clients cl
               WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL
               ORDER BY cl.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'clientes-nuevos':
      return {
        headers: ['id', 'full_name', 'cedula', 'phone', 'created_at', 'status'],
        sql: `SELECT cl.id, cl.full_name, cl.cedula_or_id AS cedula, cl.phone, cl.created_at, cl.status
                FROM clients cl
               WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL AND ${byDate('cl.created_at')}
               ORDER BY cl.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    case 'clientes-score':
      return {
        headers: ['id', 'full_name', 'cedula', 'classification', 'score', 'capacity', 'status'],
        sql: `SELECT cl.id, cl.full_name, cl.cedula_or_id AS cedula, cl.classification,
                     cl.internal_score AS score, cl.payment_capacity AS capacity, cl.status
                FROM clients cl
               WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL AND cl.internal_score IS NOT NULL
               ORDER BY cl.internal_score DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'referencias-clientes':
      return {
        headers: ['id', 'full_name', 'personal_refs', 'commercial_refs'],
        sql: `SELECT cl.id, cl.full_name, cl.personal_refs, cl.commercial_refs
                FROM clients cl
               WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL
                 AND (cl.personal_refs IS NOT NULL OR cl.commercial_refs IS NOT NULL)
               ORDER BY cl.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
        translate: (r) => {
          const parse = (v: unknown) => {
            if (!v) return '';
            try {
              const a = typeof v === 'string' ? JSON.parse(v) : v;
              return Array.isArray(a) ? a.map((x: Record<string, unknown>) => `${x.name ?? ''} ${x.phone ?? ''}`.trim()).join(', ') : JSON.stringify(a);
            } catch {
              return String(v);
            }
          };
          return { ...r, personal_refs: parse(r.personal_refs), commercial_refs: parse(r.commercial_refs) };
        },
      };
    case 'creditos-prestados':
      return {
        headers: ['id', 'credit_number', 'client', 'principal', 'rate', 'method', 'terms', 'interest', 'total', 'status', 'start_date'],
        sql: `SELECT c.id, c.credit_number, cl.full_name AS client, c.principal_amount AS principal,
                     c.annual_rate AS rate, c.amortization_method AS method,
                     c.installments_count AS terms, c.interest_total AS interest,
                     c.total_amount AS total, c.status, c.start_date
                FROM credits c
                JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND ${byDate('c.start_date')}
               ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'creditos-estado':
      return {
        headers: ['id', 'credit_number', 'client', 'principal', 'pending', 'terms', 'status', 'days_late', 'start_date'],
        sql: `SELECT c.id, c.credit_number, cl.full_name AS client, c.principal_amount AS principal,
                     c.pending_principal AS pending, c.installments_count AS terms, c.status,
                     c.days_late, c.start_date
                FROM credits c
                JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status = ?
               ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, status || 'ACTIVE', perPage, offset],
      };
    case 'cronogramas':
      return {
        headers: ['credit_number', 'client', 'number', 'due_date', 'amount', 'principal', 'interest', 'penalty', 'total', 'status'],
        sql: `SELECT c.credit_number, cl.full_name AS client, ci.installment_number AS number,
                     ci.due_date, ci.amount, ci.principal_part AS principal, ci.interest_part AS interest,
                     ci.penalty_amount AS penalty, ci.total_amount AS total, ci.status
                FROM credit_installments ci
                JOIN credits c ON c.id = ci.credit_id
                JOIN clients cl ON cl.id = c.client_id
               WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL AND ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')
                 AND ${byDate('ci.due_date')}
               ORDER BY ci.status IN ('ATRASADO','VENCIDO') DESC, ci.due_date ASC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'desembolsos':
      return {
        headers: ['credit_number', 'client', 'principal', 'method', 'disbursement_date', 'status'],
        sql: `SELECT c.credit_number, cl.full_name AS client, c.principal_amount AS principal,
                     c.amortization_method AS method, c.disbursement_date, c.status
                FROM credits c JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.disbursement_date IS NOT NULL
                 AND ${byDate('c.disbursement_date')}
               ORDER BY c.disbursement_date DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'refinanciamientos':
      return {
        headers: ['credit_number', 'client', 'previous_credit', 'principal', 'previous_balance', 'rate', 'terms', 'start_date'],
        sql: `SELECT c.credit_number, cl.full_name AS client, oc.credit_number AS previous_credit,
                     c.principal_amount AS principal, c.previous_balance,
                     c.annual_rate AS rate, c.installments_count AS terms, c.start_date
                FROM credits c
                JOIN clients cl ON cl.id = c.client_id
                LEFT JOIN credits oc ON oc.id = c.refinanced_from
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.refinanced_from IS NOT NULL
                 AND ${byDate('c.start_date')}
               ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'reestructuraciones':
      return {
        headers: ['credit_number', 'client', 'rate', 'method', 'terms', 'total', 'updated_at'],
        sql: `SELECT c.credit_number, cl.full_name AS client, c.annual_rate AS rate,
                     c.amortization_method AS method, c.installments_count AS terms,
                     c.total_amount AS total, c.updated_at
                FROM credits c JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status = 'RESTRUCTURED'
                 AND ${byDate('c.updated_at')}
               ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    case 'renovaciones':
      return {
        headers: ['credit_number', 'client', 'principal', 'rate', 'terms', 'notes', 'start_date'],
        sql: `SELECT c.credit_number, cl.full_name AS client, c.principal_amount AS principal,
                     c.annual_rate AS rate, c.installments_count AS terms, c.notes, c.start_date
                FROM credits c JOIN clients cl ON cl.id = c.client_id
               WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.notes LIKE '%Renovación%'
                 AND ${byDate('c.start_date')}
               ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'condonaciones':
      return {
        headers: ['credit_number', 'client', 'number', 'amount', 'total', 'discount', 'status'],
        sql: `SELECT c.credit_number, cl.full_name AS client, ci.installment_number AS number,
                     ci.amount, ci.total_amount AS total,
                     ROUND(ci.amount - ci.total_amount, 2) AS discount, ci.status
                FROM credit_installments ci
                JOIN credits c ON c.id = ci.credit_id
                JOIN clients cl ON cl.id = c.client_id
               WHERE ci.tenant_id = ? AND ci.deleted_at IS NULL AND ci.total_amount < ci.amount
               ORDER BY ci.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'mora':
      return {
        headers: ['credit_number', 'client', 'number', 'due_date', 'amount', 'penalty', 'total', 'days_late'],
        sql: `SELECT c.credit_number, cl.full_name AS client, ci.installment_number AS number,
                     ci.due_date, ci.amount, ci.penalty_amount AS penalty, ci.total_amount AS total,
                     c.days_late
                FROM credit_installments ci
                JOIN credits c ON c.id = ci.credit_id
                JOIN clients cl ON cl.id = c.client_id
               WHERE ci.tenant_id = ? AND ci.status IN ('ATRASADO','VENCIDO') AND ci.deleted_at IS NULL
                 AND ${byDate('ci.due_date')}
               ORDER BY ci.due_date ASC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'cuotas-vencidas':
      return {
        headers: ['credit_number', 'client', 'number', 'due_date', 'amount', 'penalty', 'total', 'status'],
        sql: `SELECT c.credit_number, cl.full_name AS client, ci.installment_number AS number,
                     ci.due_date, ci.amount, ci.penalty_amount AS penalty, ci.total_amount AS total, ci.status
                FROM credit_installments ci
                JOIN credits c ON c.id = ci.credit_id
                JOIN clients cl ON cl.id = c.client_id
               WHERE ci.tenant_id = ? AND ci.status = 'ATRASADO' AND ci.deleted_at IS NULL AND ci.due_date < CURDATE()
               ORDER BY ci.due_date ASC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'cobros-periodo':
      return {
        headers: ['id', 'client', 'amount', 'method', 'received_by', 'received_date', 'reference'],
        sql: `SELECT p.id, cl.full_name AS client, p.amount, p.method, u.name AS received_by,
                     p.received_date, p.reference
                FROM payments_received p
                JOIN clients cl ON cl.id = p.client_id
                LEFT JOIN users u ON u.id = p.received_by
               WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND ${byDate('p.received_date')}
               ORDER BY p.received_date DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'pagos-metodo':
      return {
        headers: ['method', 'count', 'total'],
        sql: `SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
                FROM payments_received p
               WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND ${byDate('p.received_date')}
               GROUP BY p.method ORDER BY total DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'acuerdos-pago':
      return {
        headers: ['id', 'credit_number', 'client', 'total', 'initial', 'terms', 'frequency', 'status', 'created'],
        sql: `SELECT pa.id, c.credit_number, cl.full_name AS client, pa.total_amount AS total,
                     pa.initial_payment AS initial, pa.terms, pa.frequency, pa.status,
                     DATE(pa.created_at) AS created
                FROM payment_agreements pa
                JOIN credits c ON c.id = pa.credit_id
                JOIN clients cl ON cl.id = pa.client_id
               WHERE pa.tenant_id = ? AND pa.deleted_at IS NULL AND ${byDate('pa.agreed_date')}
               ORDER BY pa.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'movimientos-caja':
      return {
        headers: ['id', 'date', 'register', 'type', 'direction', 'amount', 'method', 'reference', 'description', 'user'],
        sql: `SELECT cm.id, cm.created_at AS date, cr.register_date AS register, cm.type,
                     cm.direction, cm.amount, cm.method, cm.reference, cm.description, u.name AS user
                FROM cash_movements cm
                LEFT JOIN cash_registers cr ON cr.id = cm.register_id
                LEFT JOIN users u ON u.id = cm.created_by
               WHERE cm.tenant_id = ? AND ${byDate('cm.created_at')}
               ORDER BY cm.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    case 'registros-caja':
      return {
        headers: ['id', 'date', 'status', 'opening', 'expected', 'counted', 'difference', 'opened_by', 'closed_by'],
        sql: `SELECT cr.id, cr.register_date AS date, cr.status, cr.opening_balance AS opening,
                     cr.expected_closing AS expected, cr.counted_cash AS counted, cr.difference,
                     ou.name AS opened_by, cu.name AS closed_by
                FROM cash_registers cr
                LEFT JOIN users ou ON ou.id = cr.opened_by
                LEFT JOIN users cu ON cu.id = cr.closed_by
               WHERE cr.tenant_id = ? AND ${byDate('cr.register_date')}
               ORDER BY cr.register_date DESC LIMIT ? OFFSET ?`,
        params: [tenantId, from || '0000-01-01', to || '9999-12-31', perPage, offset],
      };
    case 'dispositivos':
      return {
        headers: ['id', 'device_name', 'brand', 'model', 'imei', 'mdm_status', 'client', 'last_sync'],
        sql: `SELECT d.id, d.device_name, d.brand, d.model, d.imei, d.mdm_status,
                     cl.full_name AS client, d.last_mdm_sync_at AS last_sync
                FROM devices d LEFT JOIN clients cl ON cl.id = d.client_id
               WHERE d.tenant_id = ? AND d.deleted_at IS NULL
               ORDER BY d.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'dispositivos-bloqueados':
      return {
        headers: ['id', 'device_name', 'brand', 'model', 'imei', 'unlock_code', 'client', 'last_sync'],
        // FASE 9 (auditoría): el unlock_code se redacta (solo últimos 4 dígitos).
        sql: `SELECT d.id, d.device_name, d.brand, d.model, d.imei,
                     CONCAT('••••', RIGHT(COALESCE(d.unlock_code, ''), 4)) AS unlock_code,
                     cl.full_name AS client, d.last_mdm_sync_at AS last_sync
                FROM devices d LEFT JOIN clients cl ON cl.id = d.client_id
               WHERE d.tenant_id = ? AND d.deleted_at IS NULL AND d.mdm_status = 'LOCKED'
               ORDER BY d.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, perPage, offset],
      };
    case 'desbloqueos':
      return {
        headers: ['id', 'device', 'client', 'reason', 'result', 'date'],
        sql: `SELECT du.id, d.device_name AS device, cl.full_name AS client, du.reason,
                     du.result, du.completed_at AS date
                FROM device_unlocks du
                LEFT JOIN devices d ON d.id = du.device_id
                LEFT JOIN clients cl ON cl.id = d.client_id
               WHERE du.tenant_id = ? AND ${byDate('du.completed_at')}
               ORDER BY du.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    case 'auditoria':
      return {
        headers: ['id', 'action', 'entity', 'entity_id', 'user', 'created_at'],
        sql: `SELECT al.id, al.action, al.entity_type AS entity, al.entity_id, u.name AS user, al.created_at
                FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
               WHERE al.tenant_id = ? AND ${byDate('al.created_at')}
               ORDER BY al.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    case 'actividad':
      return {
        headers: ['id', 'type', 'message', 'user', 'created_at'],
        sql: `SELECT al.id, al.type, al.message, u.name AS user, al.created_at
                FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
               WHERE al.tenant_id = ? AND ${byDate('al.created_at')}
               ORDER BY al.id DESC LIMIT ? OFFSET ?`,
        params: [tenantId, `${from || '0000-01-01'} 00:00:00`, `${to || '9999-12-31'} 23:59:59`, perPage, offset],
      };
    default:
      throw ApiError.notFound('Reporte no encontrado');
  }
}

export { period };