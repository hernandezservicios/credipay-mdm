import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import {
  applyCascadePayment,
  getPaymentStats,
  listPayments,
  normalizePaymentMethod,
} from '../../services/paymentService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

router.get('/stats', requirePermission('payments.view'), async (req: TenantRequest, res) => {
  const stats = await getPaymentStats(req.ctx!.tenantId);
  res.json({ data: stats });
});

router.get('/export', requirePermission('payments.view'), async (req: TenantRequest, res) => {
  const { data } = await listPayments(req.ctx!.tenantId, { perPage: 1000 });

  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    ['Recibo', 'Fecha', 'Cliente', 'Crédito', 'Base (RD$)', 'Cambio (RD$)', 'Método', 'Referencia', 'Recibido por', 'Notas'].join(','),
    ...data.map((p) =>
      [
        esc(`REC-${p.id}`),
        esc(new Date(p.received_date).toISOString().slice(0, 10)),
        esc(p.client_name),
        esc(p.credit_id ?? ''),
        p.amount,
        p.change ?? 0,
        esc(p.method),
        esc(p.reference ?? ''),
        esc(p.received_by_name ?? ''),
        esc(p.notes ?? ''),
      ].join(',')
    ),
  ];

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="credipay-pagos-${today}.csv"`
  );
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

router.get('/', requirePermission('payments.view'), async (req: TenantRequest, res) => {
  const result = await listPayments(req.ctx!.tenantId, {
    clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    page: Number(req.query.page) || 1,
    perPage: Number(req.query.perPage) || 50,
  });
  res.json(result);
});

router.post('/cascade', requirePermission('payments.create'), async (req: TenantRequest, res) => {
  const body = req.body as {
    clientId?: number;
    amount?: number;
    method?: string;
    bank?: string;
    received?: number;
    change?: number;
  };
  if (!body.clientId) {
    res.status(400).json({ error: 'invalid_client', message: 'El cliente es obligatorio' });
    return;
  }
  const method = normalizePaymentMethod(body.method ?? 'EFECTIVO');
  const result = await applyCascadePayment(req, {
    clientId: body.clientId,
    amount: Number(body.amount) || 0,
    method,
    bank: typeof body.bank === 'string' ? body.bank : '',
    received: Number(body.received) || 0,
    change: Number(body.change) || 0,
  });
  res.status(201).json({ data: result });
});

export default router;
