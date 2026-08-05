import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { getDashboardSummary } from '../../services/dashboardService.js';

const router = Router();
router.use(authRequired, requireTenant, csrfProtect);

router.get('/summary', requirePermission('dashboard.view'), async (req: TenantRequest, res) => {
  const summary = await getDashboardSummary(req.ctx!.tenantId);
  res.json({ data: summary });
});

export default router;