import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { markDeprecated } from '../../utils/deprecation.js';
import { cancelCredit, createCredit, getCredit, listCredits } from '../../services/repoService.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { assertPlanLimit } from '../../services/planService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

const deprecatedToLoans = markDeprecated('/api/v1/credits', '/api/v1/loans');

router.get('/', deprecatedToLoans, requirePermission('credits.view'), async (req: TenantRequest, res) => {
  const data = await listCredits(req.ctx!.tenantId, {
    clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  res.json({ data });
});

router.get('/:id', deprecatedToLoans, requirePermission('credits.view'), async (req: TenantRequest, res) => {
  const credit = await getCredit(req.ctx!.tenantId, Number(req.params.id));
  res.json({ data: credit });
});

router.post('/', requirePermission('credits.create'), async (req: TenantRequest, res) => {
  const body = req.body as {
    clientId?: number;
    totalAmount?: number;
    monthlyAmount?: number;
    installmentsCount?: number;
    startDate?: string;
  };
  if (!body.clientId) {
    res.status(400).json({ error: 'invalid_client', message: 'El cliente es obligatorio' });
    return;
  }
  await assertPlanLimit(req.ctx!.tenantId, 'credits');
  const created = await createCredit(req.ctx!.tenantId, req.auth!.userId, {
    clientId: body.clientId,
    totalAmount: Number(body.totalAmount) || 0,
    monthlyAmount: Number(body.monthlyAmount) || 0,
    installmentsCount: Number(body.installmentsCount) || 0,
    startDate: typeof body.startDate === 'string' ? body.startDate : new Date().toISOString().slice(0, 10),
  });
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'CREDIT_CREATED',
      entityType: 'credit',
      entityId: String(created.id),
      newValues: body,
    },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CREDIT',
    `Crédito ${created.creditNumber} creado (${body.installmentsCount} cuotas)`,
    req as AuthRequest
  );
  res.status(201).json({ data: created });
});

router.post('/:id/cancel', requirePermission('credits.edit'), async (req: TenantRequest, res) => {
  await cancelCredit(req.ctx!.tenantId, Number(req.params.id));
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'CREDIT_CANCELED',
      entityType: 'credit',
      entityId: String(req.params.id),
    },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), status: 'CANCELED' } });
});

export default router;
