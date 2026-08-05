import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { buildCsv, computeReport, REPORT_TYPES } from '../../services/reportService.js';

const router = Router();
router.use(authRequired, requireTenant, csrfProtect);

router.get('/types', requirePermission('reports.view'), (_req: TenantRequest, res) => {
  const groups = REPORT_TYPES.reduce<Record<string, { key: string; label: string }[]>>((acc, r) => {
    acc[r.group] = acc[r.group] || [];
    acc[r.group].push({ key: r.key, label: r.label });
    return acc;
  }, {});
  res.json({ data: groups });
});

router.get('/:key', requirePermission('reports.view'), async (req: TenantRequest, res) => {
  const key = req.params.key as string;
  const opts = {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
  };
  const report = await computeReport(req.ctx!.tenantId, key, opts);

  if (String(req.query.format || '').toLowerCase() === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte-${key}-${report.from || 'todo'}-${report.to || 'hoy'}.csv"`
    );
    res.send(buildCsv(report.headers, report.data));
    return;
  }

  res.json(report);
});

export default router;