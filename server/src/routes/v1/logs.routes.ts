import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { listDeviceEvents } from '../../services/repoService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

router.get('/device-events', requirePermission('logs.view'), async (req: TenantRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 50), 200);
  const result = await listDeviceEvents(req.ctx!.tenantId, {
    deviceId: req.query.deviceId ? Number(req.query.deviceId) : undefined,
    action: typeof req.query.action === 'string' ? req.query.action : undefined,
    page,
    perPage,
  });
  res.json(result);
});

export default router;
