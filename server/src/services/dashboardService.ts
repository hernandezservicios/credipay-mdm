// ============================================================
// CrediPay MDM - Dashboard
// Tarjetas de resumen, series mensuales (12 meses) para
// gráficas y bitácora de última actividad.
// ============================================================

import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';

export interface DashboardSummary {
  cards: {
    carteraTotal: number;
    prestadoTotal: number;
    recaudadoTotal: number;
    mesActual: number;
    cobradoHoy: number;
    desembolsadoHoy: number;
    creditosActivos: number;
    cuotasVencidas: number;
    cuotasAtrasadas: number;
    moraTotal: number;
    clientes: number;
    clientesAtrasados: number;
    dispositivos: number;
    dispositivosBloqueados: number;
    porCobrar: number;
    efectividad: number;
  };
  series: {
    month: string;
    recaudado: number;
    desembolsado: number;
    prestamos: number;
  }[];
  porEstado: { status: string; count: number }[];
  porMetodo: { method: string; total: number }[];
  porClasificacion: { classification: string; count: number }[];
  actas: {
    id: number;
    type: string;
    message: string;
    user: string;
    created_at: string;
  }[];
}

export async function getDashboardSummary(tenantId: number): Promise<DashboardSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const [cards] = await pool.query<RowDataPacket[]>(
    `SELECT
      (SELECT COALESCE(SUM(c.principal_amount),0) FROM credits c
        WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status IN ('ACTIVE','RESTRUCTURED')) AS cartera_total,
      (SELECT COALESCE(SUM(c.principal_amount),0) FROM credits c
        WHERE c.tenant_id = ? AND c.deleted_at IS NULL) AS prestado_total,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments_received p
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL) AS recaudado_total,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments_received p
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND DATE_FORMAT(p.received_date,'%Y-%m') = DATE_FORMAT(?, '%Y-%m')) AS mes_actual,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments_received p
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.received_date = ?) AS cobrado_hoy,
      (SELECT COALESCE(SUM(c.principal_amount),0) FROM credits c
        WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.disbursement_date = ?) AS desembolsado_hoy,
      (SELECT COUNT(*) FROM credits c WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.status IN ('ACTIVE','RESTRUCTURED')) AS creditos_activos,
      (SELECT COUNT(*) FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.status = 'VENCIDO') AS cuotas_vencidas,
      (SELECT COUNT(*) FROM credit_installments ci WHERE ci.tenant_id = ? AND ci.status = 'ATRASADO') AS cuotas_atrasadas,
      (SELECT COALESCE(SUM(ci.penalty_amount),0) FROM credit_installments ci
        WHERE ci.tenant_id = ? AND ci.status IN ('ATRASADO','VENCIDO')) AS mora_total,
      (SELECT COUNT(*) FROM clients cl WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL) AS clientes,
      (SELECT COUNT(DISTINCT c.client_id) FROM credits c
        WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.days_late > 0) AS clientes_atrasados,
      (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = ? AND d.deleted_at IS NULL) AS dispositivos,
      (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = ? AND d.deleted_at IS NULL AND d.mdm_status = 'LOCKED') AS dispositivos_bloqueados,
      (SELECT COALESCE(SUM(ci.total_amount - COALESCE(ci.paid_amount,0)),0) FROM credit_installments ci
        WHERE ci.tenant_id = ? AND ci.status IN ('PENDIENTE','VENCIDO','ATRASADO')) AS por_cobrar`,
    [
      tenantId, tenantId, tenantId, tenantId, month,
      tenantId, today, tenantId, today,
      tenantId, tenantId, tenantId, tenantId, tenantId,
      tenantId, tenantId, tenantId, tenantId,
    ]
  );

  const c = cards[0] as RowDataPacket;
  const [ef] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'PAGADO'),0) AS pagadas
       FROM credit_installments WHERE tenant_id = ?`,
    [tenantId]
  );
  const efRow = ef[0] as RowDataPacket;
  const total = Number(efRow.total) || 0;
  const pagadas = Number(efRow.pagadas) || 0;

  const [series] = await pool.query<RowDataPacket[]>(
    `SELECT ym.m AS month,
       (SELECT COALESCE(SUM(p.amount),0) FROM payments_received p
         WHERE p.tenant_id = ? AND DATE_FORMAT(p.received_date,'%Y-%m') = ym.m AND p.deleted_at IS NULL) AS recaudado,
       (SELECT COALESCE(SUM(c.principal_amount),0) FROM credits c
         WHERE c.tenant_id = ? AND DATE_FORMAT(c.disbursement_date,'%Y-%m') = ym.m AND c.deleted_at IS NULL) AS desembolsado,
       (SELECT COUNT(*) FROM credits c
         WHERE c.tenant_id = ? AND DATE_FORMAT(c.start_date,'%Y-%m') = ym.m AND c.deleted_at IS NULL) AS prestamos
    FROM (
      SELECT DATE_FORMAT(DATE_SUB(?, INTERVAL n MONTH), '%Y-%m') AS m
      FROM (SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
            UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11) nums
    ) ym ORDER BY ym.m`,
    [tenantId, tenantId, tenantId, `${month}-01`]
  );

  const [porEstado] = await pool.query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS count FROM credits c
      WHERE c.tenant_id = ? AND c.deleted_at IS NULL GROUP BY status ORDER BY count DESC`,
    [tenantId]
  );

  const [porMetodo] = await pool.query<RowDataPacket[]>(
    `SELECT method, COALESCE(SUM(amount),0) AS total FROM payments_received p
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL GROUP BY method ORDER BY total DESC`,
    [tenantId]
  );

  const [porClasificacion] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(cl.classification,'-') AS classification, COUNT(*) AS count
       FROM clients cl
      WHERE cl.tenant_id = ? AND cl.deleted_at IS NULL
      GROUP BY cl.classification ORDER BY count DESC`,
    [tenantId]
  );

  const [actas] = await pool.query<RowDataPacket[]>(
    `SELECT al.id, al.activity_type AS type, al.description AS message, COALESCE(u.name, 'Sistema') AS user, al.created_at
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
      WHERE al.tenant_id = ?
      ORDER BY al.id DESC LIMIT 12`,
    [tenantId]
  );

  const cardsOut = {
    carteraTotal: Number(c.cartera_total) || 0,
    prestadoTotal: Number(c.prestado_total) || 0,
    recaudadoTotal: Number(c.recaudado_total) || 0,
    mesActual: Number(c.mes_actual) || 0,
    cobradoHoy: Number(c.cobrado_hoy) || 0,
    desembolsadoHoy: Number(c.desembolsado_hoy) || 0,
    creditosActivos: Number(c.creditos_activos) || 0,
    cuotasVencidas: Number(c.cuotas_vencidas) || 0,
    cuotasAtrasadas: Number(c.cuotas_atrasadas) || 0,
    moraTotal: Number(c.mora_total) || 0,
    clientes: Number(c.clientes) || 0,
    clientesAtrasados: Number(c.clientes_atrasados) || 0,
    dispositivos: Number(c.dispositivos) || 0,
    dispositivosBloqueados: Number(c.dispositivos_bloqueados) || 0,
    porCobrar: Number(c.por_cobrar) || 0,
    efectividad: total > 0 ? Math.round((pagadas / total) * 1000) / 10 : 0,
  };

  const methodLabel: Record<string, string> = {
    CASH: 'EFECTIVO',
    TRANSFER: 'TRANSFERENCIA',
    CARD: 'TARJETA',
    OTHER: 'DEPOSITO',
  };

  return {
    cards: cardsOut,
    series: (series as RowDataPacket[]).map((s) => ({
      month: String(s.month),
      recaudado: Number(s.recaudado) || 0,
      desembolsado: Number(s.desembolsado) || 0,
      prestamos: Number(s.prestamos) || 0,
    })),
    porEstado: (porEstado as RowDataPacket[]).map((r) => ({ status: String(r.status), count: Number(r.count) })),
    porMetodo: (porMetodo as RowDataPacket[]).map((r) => ({ method: methodLabel[String(r.method)] ?? String(r.method), total: Number(r.total) })),
    porClasificacion: (porClasificacion as RowDataPacket[]).map((r) => ({
      classification: String(r.classification),
      count: Number(r.count),
    })),
    actas: (actas as RowDataPacket[]).map((a) => ({
      id: Number(a.id),
      type: String(a.type),
      message: String(a.message),
      user: String(a.user),
      created_at: String(a.created_at),
    })),
  };
}