import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError } from '../utils/http.js';

// ---------------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------------

export interface ClientListItem extends RowDataPacket {
  id: number;
  full_name: string;
  cedula_or_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  credit_count: number;
  pending_amount: string;
  device_model: string | null;
  device_mdm_status: string | null;
}

export async function listClients(
  tenantId: number,
  opts: { q?: string; status?: string; page?: number; perPage?: number }
): Promise<{ data: ClientListItem[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['cl.tenant_id = ?', 'cl.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (opts.q) {
    where.push('(cl.full_name LIKE ? OR cl.cedula_or_id LIKE ? OR cl.phone LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts.status && ['ACTIVE', 'INACTIVE', 'DELINQUENT'].includes(opts.status)) {
    where.push('cl.status = ?');
    params.push(opts.status);
  }
  const whereSql = where.join(' AND ');

  const [countRes, listRes] = await Promise.all([
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM clients cl WHERE ${whereSql}`, params),
    pool.query<ClientListItem[]>(
      `SELECT cl.id, cl.full_name, cl.cedula_or_id, cl.phone, cl.email, cl.address,
              cl.status, cl.notes, cl.created_at,
              (SELECT COUNT(*) FROM credits c
                WHERE c.client_id = cl.id AND c.deleted_at IS NULL AND c.status = 'ACTIVE') AS credit_count,
              (SELECT COALESCE(SUM(ci.total_amount - COALESCE(ci.paid_amount, 0)), 0)
                 FROM credit_installments ci
                 JOIN credits c ON c.id = ci.credit_id
                WHERE c.client_id = cl.id AND c.deleted_at IS NULL
                  AND c.status = 'ACTIVE' AND ci.deleted_at IS NULL
                  AND ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')) AS pending_amount,
              (SELECT d.model FROM devices d
                WHERE d.client_id = cl.id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1) AS device_model,
              (SELECT d.mdm_status FROM devices d
                WHERE d.client_id = cl.id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1) AS device_mdm_status
         FROM clients cl
        WHERE ${whereSql}
        ORDER BY cl.id DESC
        LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    ),
  ]);
  const rows = listRes[0];
  const total = Number((countRes[0] as RowDataPacket[])[0].total);

  return {
    data: rows,
    pagination: { page, perPage, total: Number(total) },
  };
}

export async function getClientFull(tenantId: number, id: number): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT cl.id, cl.full_name, cl.cedula_or_id, cl.phone, cl.email, cl.address,
            cl.avatar_url, cl.notes, cl.status, cl.created_at, cl.updated_at,
            cl.customer_type, cl.birth_date, cl.occupation, cl.employer,
            cl.work_address, cl.monthly_income, cl.monthly_expenses,
            cl.whatsapp, cl.phone2, cl.city, cl.province, cl.country, cl.postal_code,
            cl.personal_refs, cl.commercial_refs, cl.documents, cl.photos,
            cl.signature_url, cl.gps_location, cl.internal_score, cl.classification,
            cl.payment_capacity
       FROM clients cl
      WHERE cl.id = ? AND cl.tenant_id = ? AND cl.deleted_at IS NULL`,
    [id, tenantId]
  );
  const client = rows[0];
  if (!client) throw ApiError.notFound('Cliente no encontrado');

  for (const col of ['personal_refs', 'commercial_refs', 'documents', 'photos', 'gps_location']) {
    if (client[col] && typeof client[col] === 'string') {
      try {
        client[col] = JSON.parse(client[col] as string);
      } catch {
        client[col] = null;
      }
    }
  }

  const [credits] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.credit_number, c.start_date, c.total_amount, c.monthly_amount,
            c.installments_count, c.status, c.created_at,
            c.principal_amount, c.annual_rate, c.amortization_method,
            c.interest_total, c.financing_fee, c.pending_principal,
            c.approval_date, c.disbursement_date, c.first_due_date,
            c.last_payment_at, c.days_late, c.last_overdue_at, c.notes,
            c.refinanced_from, c.previous_balance
       FROM credits c
      WHERE c.client_id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL
      ORDER BY c.id`,
    [id, tenantId]
  );

  const [installments] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id, ci.credit_id, ci.installment_number, ci.amount, ci.due_date, ci.status,
            ci.penalty_amount, ci.total_amount, ci.paid_date, ci.payment_reference,
            COALESCE(ci.paid_amount, 0) AS paid_amount
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
      WHERE c.client_id = ? AND ci.tenant_id = ? AND ci.deleted_at IS NULL
      ORDER BY ci.installment_number`,
    [id, tenantId]
  );

  const [devices] = await pool.query<RowDataPacket[]>(
    `SELECT id, inovaguard_id, device_name, brand, model, imei, serial_number,
            mdm_status, unlock_code, remote_lock_supported, last_mdm_sync_at
       FROM devices
      WHERE client_id = ? AND tenant_id = ? AND deleted_at IS NULL
      ORDER BY id`,
    [id, tenantId]
  );

  return {
    ...client,
    credits,
    installments,
    devices,
  };
}

export async function createClient(
  tenantId: number,
  userId: number,
  input: {
    fullName?: string;
    cedulaOrId?: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
  }
): Promise<{ id: number }> {
  const fullName = input.fullName?.trim();
  if (!fullName) throw ApiError.badRequest('invalid_name', 'El nombre completo es obligatorio');
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (tenant_id, full_name, cedula_or_id, phone, email, address, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      fullName,
      input.cedulaOrId?.trim() || null,
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.address?.trim() || null,
      input.notes?.trim() || null,
      userId,
    ]
  );
  return { id: res.insertId };
}

export const CLIENT_EXTENDED_COLUMNS = [
  'customer_type',
  'birth_date',
  'occupation',
  'employer',
  'work_address',
  'monthly_income',
  'monthly_expenses',
  'whatsapp',
  'phone2',
  'city',
  'province',
  'country',
  'postal_code',
  'personal_refs',
  'commercial_refs',
  'documents',
  'photos',
  'signature_url',
  'gps_location',
] as const;

export async function updateClient(
  tenantId: number,
  id: number,
  patch: {
    fullName?: string | null;
    cedulaOrId?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    status?: string | null;
  } & Record<string, unknown>
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const assign = (col: string, value: unknown) => {
    fields.push(`${col} = ?`);
    params.push(value);
  };
  const trimField = (value: string | null | undefined): string | null =>
    typeof value === 'string' ? value.trim() || null : null;
  if (patch.fullName !== undefined) assign('full_name', patch.fullName?.trim() || '');
  if (patch.cedulaOrId !== undefined) assign('cedula_or_id', trimField(patch.cedulaOrId));
  if (patch.phone !== undefined) assign('phone', trimField(patch.phone));
  if (patch.email !== undefined) assign('email', trimField(patch.email));
  if (patch.address !== undefined) assign('address', trimField(patch.address));
  if (patch.notes !== undefined) assign('notes', trimField(patch.notes));
  if (patch.status !== undefined && patch.status !== null) {
    if (!['ACTIVE', 'INACTIVE', 'DELINQUENT'].includes(patch.status)) {
      throw ApiError.badRequest('invalid_status', 'Estado de cliente inválido');
    }
    assign('status', patch.status);
  }

  for (const col of CLIENT_EXTENDED_COLUMNS) {
    if (patch[col] === undefined) continue;
    const value = patch[col];
    if (value === null) {
      assign(col, null);
    } else if (typeof value === 'boolean') {
      assign(col, value ? 1 : 0);
    } else if (typeof value === 'object') {
      assign(col, JSON.stringify(value));
    } else {
      assign(col, value);
    }
  }
  if (fields.length === 0) throw ApiError.badRequest('empty_patch', 'Sin cambios');

  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE clients SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [...params, id, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Cliente no encontrado');
}

export async function deleteClient(tenantId: number, id: number): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    'UPDATE clients SET deleted_at = NOW(), status = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ['INACTIVE', id, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Cliente no encontrado');
}

// ---------------------------------------------------------------------------
// CRÉDITOS
// ---------------------------------------------------------------------------

export async function listCredits(
  tenantId: number,
  opts: { clientId?: number; status?: string }
): Promise<RowDataPacket[]> {
  const where: string[] = ['c.tenant_id = ?', 'c.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];
  if (opts.clientId) {
    where.push('c.client_id = ?');
    params.push(opts.clientId);
  }
  if (opts.status) {
    where.push('c.status = ?');
    params.push(opts.status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.client_id, cl.full_name AS client_name, c.credit_number, c.start_date,
            c.total_amount, c.principal_amount, c.annual_rate, c.amortization_method,
            c.interest_total, c.pending_principal, c.days_late, c.last_payment_at,
            c.monthly_amount, c.installments_count, c.status, c.created_at,
            (SELECT COUNT(*) FROM credit_installments ci
              WHERE ci.credit_id = c.id AND ci.deleted_at IS NULL AND ci.status <> 'PAGADO') AS pending_count
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.id DESC`,
    params
  );
  return rows;
}

export async function getCredit(tenantId: number, id: number): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.client_id, cl.full_name AS client_name, c.credit_number, c.start_date,
            c.total_amount, c.principal_amount, c.annual_rate, c.amortization_method,
            c.interest_total, c.pending_principal, c.financing_fee, c.days_late,
            c.last_payment_at, c.approval_date, c.disbursement_date, c.first_due_date,
            c.previous_balance, c.refinanced_from, c.notes, c.monthly_amount,
            c.installments_count, c.status, c.created_at
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.deleted_at IS NULL`,
    [id, tenantId]
  );
  const credit = rows[0];
  if (!credit) throw ApiError.notFound('Crédito no encontrado');

  const [installments] = await pool.query<RowDataPacket[]>(
    `SELECT id, installment_number, amount, principal_part, interest_part, due_date,
            status, penalty_amount, total_amount, paid_date, payment_reference,
            COALESCE(paid_amount, 0) AS paid_amount
       FROM credit_installments
      WHERE credit_id = ? AND tenant_id = ? AND deleted_at IS NULL
      ORDER BY installment_number`,
    [id, tenantId]
  );
  return { ...credit, installments };
}

export async function createCredit(
  tenantId: number,
  userId: number,
  input: {
    clientId: number;
    totalAmount: number;
    monthlyAmount: number;
    installmentsCount: number;
    startDate: string;
  }
): Promise<{ id: number; creditNumber: string }> {
  const [clientRows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [input.clientId, tenantId]
  );
  if (!clientRows[0]) throw ApiError.notFound('Cliente no encontrado');

  const count = Math.floor(Number(input.installmentsCount));
  if (!(count > 0) || count > 120) {
    throw ApiError.badRequest('invalid_count', 'Número de cuotas inválido (1-120)');
  }
  const monthly = Math.round(Number(input.monthlyAmount) * 100) / 100;
  if (!(monthly > 0)) {
    throw ApiError.badRequest('invalid_amount', 'Cuota mensual inválida');
  }
  const total = Math.round(Number(input.totalAmount) * 100) / 100;
  const startDate = input.startDate || new Date().toISOString().slice(0, 10);
  const creditNumber = `CR-${input.clientId}-${Date.now().toString().slice(-6)}`;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO credits (client_id, tenant_id, credit_number, start_date, total_amount,
                            monthly_amount, installments_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [input.clientId, tenantId, creditNumber, startDate, total, monthly, count, userId]
    );
    const creditId = res.insertId;

    for (let i = 1; i <= count; i++) {
      await conn.query(
        `INSERT INTO credit_installments
          (credit_id, tenant_id, installment_number, amount, due_date, status, total_amount)
         VALUES (?, ?, ?, ?, DATE_ADD(?, INTERVAL ? MONTH), 'PENDIENTE', ?)`,
        [creditId, tenantId, i, monthly, startDate, i - 1, monthly]
      );
    }
    await conn.commit();
    return { id: creditId, creditNumber };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function cancelCredit(tenantId: number, id: number): Promise<void> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE credits SET status = 'CANCELED'
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND status IN ('ACTIVE', 'DEFAULTED')`,
    [id, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Crédito no encontrado o no cancelable');
}

// ---------------------------------------------------------------------------
// CUOTAS
// ---------------------------------------------------------------------------

export async function listInstallments(
  tenantId: number,
  opts: { creditId?: number; clientId?: number; status?: string }
): Promise<RowDataPacket[]> {
  const where: string[] = ['ci.tenant_id = ?', 'ci.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];
  if (opts.creditId) {
    where.push('ci.credit_id = ?');
    params.push(opts.creditId);
  }
  if (opts.clientId) {
    where.push('c.client_id = ?');
    params.push(opts.clientId);
  }
  if (opts.status) {
    where.push('ci.status = ?');
    params.push(opts.status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ci.id, ci.credit_id, c.credit_number, c.client_id, cl.full_name AS client_name,
            ci.installment_number, ci.amount, ci.principal_part, ci.interest_part,
            ci.due_date, ci.status, ci.penalty_amount,
            ci.total_amount, ci.paid_date, ci.payment_reference,
            COALESCE(ci.paid_amount, 0) AS paid_amount
       FROM credit_installments ci
       JOIN credits c ON c.id = ci.credit_id
       JOIN clients cl ON cl.id = c.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY ci.installment_number`,
    params
  );
  return rows;
}

export async function updateInstallment(
  tenantId: number,
  id: number,
  patch: { status?: string; amount?: number; penaltyAmount?: number }
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, amount, penalty_amount, status FROM credit_installments WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [id, tenantId]
  );
  const inst = rows[0] as { id: number; amount: string; penalty_amount: string; status: string } | undefined;
  if (!inst) throw ApiError.notFound('Cuota no encontrada');

  const amount = patch.amount !== undefined ? Math.round(patch.amount * 100) / 100 : Number(inst.amount);
  const penalty =
    patch.penaltyAmount !== undefined ? Math.round(patch.penaltyAmount * 100) / 100 : Number(inst.penalty_amount);
  const total = Math.round((amount + penalty) * 100) / 100;
  const status = patch.status ?? inst.status;
  const allowed = ['PENDIENTE', 'PAGADO', 'VENCIDO', 'ATRASADO', 'CANCELADO'];
  if (!allowed.includes(status)) throw ApiError.badRequest('invalid_status', 'Estado de cuota inválido');
  if (!(amount > 0)) throw ApiError.badRequest('invalid_amount', 'Monto de cuota inválido');

  const paid = status === 'PAGADO' ? total : undefined;
  const paidDate = status === 'PAGADO' ? new Date().toISOString().slice(0, 10) : undefined;

  await pool.query(
    `UPDATE credit_installments
        SET amount = ?, penalty_amount = ?, total_amount = ?, status = ?,
            paid_amount = COALESCE(?, paid_amount), paid_date = COALESCE(?, paid_date)
      WHERE id = ? AND tenant_id = ?`,
    [amount, penalty, total, status, paid, paidDate, id, tenantId]
  );
}

// ---------------------------------------------------------------------------
// DISPOSITIVOS
// ---------------------------------------------------------------------------

export async function listDevices(
  tenantId: number,
  opts: { q?: string; status?: string; page?: number; perPage?: number }
): Promise<{ data: RowDataPacket[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['d.tenant_id = ?', 'd.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (opts.q) {
    where.push('(d.device_name LIKE ? OR d.imei LIKE ? OR d.serial_number LIKE ? OR cl.full_name LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  if (opts.status) {
    where.push('d.mdm_status = ?');
    params.push(opts.status);
  }
  const whereSql = where.join(' AND ');

  const [countRes, listRes] = await Promise.all([
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM devices d WHERE ${whereSql}`, params),
    pool.query<RowDataPacket[]>(
      `SELECT d.id, d.inovaguard_id, d.device_name, d.brand, d.model, d.imei,
              d.serial_number, d.mdm_status, d.unlock_code, d.remote_lock_supported,
              d.last_mdm_sync_at, d.last_mdm_sync_note,
              d.client_id, cl.full_name AS client_name
         FROM devices d
         LEFT JOIN clients cl ON cl.id = d.client_id
        WHERE ${whereSql}
        ORDER BY d.id
        LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    ),
  ]);
  const rows = listRes[0];
  const total = Number((countRes[0] as RowDataPacket[])[0].total);

  return { data: rows, pagination: { page, perPage, total: Number(total) } };
}

export async function updateDevice(
  tenantId: number,
  id: number,
  patch: {
    clientId?: number | null;
    deviceName?: string;
    inovaguardId?: string;
    brand?: string;
    model?: string;
    imei?: string;
    serialNumber?: string;
    mdmStatus?: string;
    unlockCode?: string;
  }
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const assign = (col: string, value: unknown) => {
    fields.push(`${col} = ?`);
    params.push(value);
  };
  if (patch.clientId !== undefined) {
    if (patch.clientId !== null) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM clients WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [patch.clientId, tenantId]
      );
      if (!rows[0]) throw ApiError.notFound('Cliente no encontrado');
    }
    assign('client_id', patch.clientId);
  }
  if (patch.deviceName !== undefined) assign('device_name', patch.deviceName.trim() || null);
  if (patch.inovaguardId !== undefined) assign('inovaguard_id', patch.inovaguardId.trim() || null);
  if (patch.brand !== undefined) assign('brand', patch.brand.trim() || null);
  if (patch.model !== undefined) assign('model', patch.model.trim() || null);
  if (patch.imei !== undefined) assign('imei', patch.imei.trim() || null);
  if (patch.serialNumber !== undefined) assign('serial_number', patch.serialNumber.trim() || null);
  if (patch.mdmStatus !== undefined) {
    if (!['UNLOCKED', 'LOCKED', 'UNKNOWN', 'REMOVED', 'ENROLLING'].includes(patch.mdmStatus)) {
      throw ApiError.badRequest('invalid_status', 'Estado MDM inválido');
    }
    assign('mdm_status', patch.mdmStatus);
  }
  if (patch.unlockCode !== undefined) assign('unlock_code', patch.unlockCode.trim() || null);
  if (fields.length === 0) throw ApiError.badRequest('empty_patch', 'Sin cambios');

  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE devices SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [...params, id, tenantId]
  );
  if (res.affectedRows === 0) throw ApiError.notFound('Dispositivo no encontrado');
}

// ---------------------------------------------------------------------------
// EVENTOS MDM / LOGS
// ---------------------------------------------------------------------------

export async function listDeviceEvents(
  tenantId: number,
  opts: { deviceId?: number; action?: string; page?: number; perPage?: number }
): Promise<{ data: RowDataPacket[]; pagination: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(Math.max(1, opts.perPage || 50), 200);
  const where: string[] = ['e.tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (opts.deviceId) {
    where.push('e.device_id = ?');
    params.push(opts.deviceId);
  }
  if (opts.action) {
    where.push('e.action = ?');
    params.push(opts.action);
  }
  const whereSql = where.join(' AND ');

  const [countRes, listRes] = await Promise.all([
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM device_events e WHERE ${whereSql}`, params),
    pool.query<RowDataPacket[]>(
      `SELECT e.id, e.device_id, d.device_name, d.model, d.imei, e.client_id,
              cl.full_name AS client_name, e.action, e.trigger_source, e.status,
              e.details, e.ip_address, e.created_at
         FROM device_events e
         LEFT JOIN devices d ON d.id = e.device_id
         LEFT JOIN clients cl ON cl.id = e.client_id
        WHERE ${whereSql}
        ORDER BY e.id DESC
        LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    ),
  ]);
  const rows = listRes[0];
  const total = Number((countRes[0] as RowDataPacket[])[0].total);

  return { data: rows, pagination: { page, perPage, total: Number(total) } };
}
