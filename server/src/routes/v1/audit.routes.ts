import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { authRequired, requirePermission, type AuthRequest } from '../../middleware/auth.js';

const router = Router();

router.get('/', authRequired, requirePermission('audit.view'), async (req: AuthRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const tenantId = req.auth!.tenantId;

  const params: unknown[] = [limit];
  let where = '1 = 1';
  if (tenantId !== null) {
    where = 'a.tenant_id = ?';
    params.unshift(tenantId);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.tenant_id, a.user_id, u.name AS user_name, a.action,
            a.entity_type, a.entity_id, a.ip_address, a.user_agent, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT ?`,
    params
  );
  res.json({ data: rows });
});

router.get('/activity', authRequired, requirePermission('logs.view'), async (req: AuthRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const tenantId = req.auth!.tenantId;

  const params: unknown[] = [limit];
  let where = '1 = 1';
  if (tenantId !== null) {
    where = 'a.tenant_id = ?';
    params.unshift(tenantId);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.activity_type, a.description, a.ip_address, a.user_agent, a.created_at
       FROM activity_logs a
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT ?`,
    params
  );
  res.json({ data: rows });
});

export default router;
