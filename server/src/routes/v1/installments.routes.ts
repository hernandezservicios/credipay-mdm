import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { listInstallments, updateInstallment } from '../../services/repoService.js';
import { recordAudit } from '../../services/auditService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

router.get('/', requirePermission('installments.view'), async (req: TenantRequest, res) => {
  const data = await listInstallments(req.ctx!.tenantId, {
    creditId: req.query.creditId ? Number(req.query.creditId) : undefined,
    clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  res.json({ data });
});

router.patch('/:id', requirePermission('installments.edit'), async (req: TenantRequest, res) => {
  await updateInstallment(req.ctx!.tenantId, Number(req.params.id), {
    status: typeof req.body.status === 'string' ? req.body.status : undefined,
    amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
    penaltyAmount: req.body.penaltyAmount !== undefined ? Number(req.body.penaltyAmount) : undefined,
  });
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'INSTALLMENT_UPDATED',
      entityType: 'installment',
      entityId: String(req.params.id),
      newValues: req.body,
    },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id) } });
});

export default router;
