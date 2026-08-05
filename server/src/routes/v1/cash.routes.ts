import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import {
  addCashMovement,
  closeRegister,
  currentRegister,
  listMovements,
  listRegisters,
  openRegister,
  registerTotals,
} from '../../services/cashService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();
router.use(authRequired, requireTenant, csrfProtect);

router.get('/', requirePermission('cash.view'), async (req: TenantRequest, res) => {
  const current = await currentRegister(req.ctx!.tenantId);
  const totals = current ? await registerTotals(req.ctx!.tenantId, current.id) : null;
  res.json({ data: { current, totals } });
});

router.post('/open', requirePermission('cash.register'), async (req: TenantRequest, res) => {
  const register = await openRegister(
    req.ctx!.tenantId,
    req.auth!.userId,
    Number(req.body.openingBalance) || 0
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CASH',
    `Caja abierta con saldo inicial RD$${register.opening_balance}`,
    req as AuthRequest
  );
  res.status(201).json({ data: register });
});

router.post('/:id/close', requirePermission('cash.register'), async (req: TenantRequest, res) => {
  const register = await closeRegister(
    req.ctx!.tenantId,
    Number(req.params.id),
    Number(req.body.countedCash) || 0,
    typeof req.body.notes === 'string' ? req.body.notes : undefined
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CASH',
    `Caja cerrada: diferencia RD$${register.difference} (esperado RD$${register.expected_closing})`,
    req as AuthRequest
  );
  res.json({ data: register });
});

router.get('/registers', requirePermission('cash.view'), async (req: TenantRequest, res) => {
  const result = await listRegisters(req.ctx!.tenantId, {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
  });
  res.json(result);
});

router.get('/movements', requirePermission('cash.view'), async (req: TenantRequest, res) => {
  const result = await listMovements(req.ctx!.tenantId, {
    registerId: req.query.registerId ? Number(req.query.registerId) : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
  });
  res.json(result);
});

router.post('/movements', requirePermission('cash.movements'), async (req: TenantRequest, res) => {
  const type = req.body.type as string | undefined;
  if (!['INCOME', 'EXPENSE', 'ADJUSTMENT'].includes(type || '')) {
    throw ApiError.badRequest('invalid_type', 'Tipo de movimiento inválido');
  }
  const direction = req.body.direction as string;
  const movementId = await addCashMovement(req.ctx!.tenantId, req.auth!.userId, {
    type: type as 'INCOME' | 'EXPENSE' | 'ADJUSTMENT',
    amount: Number(req.body.amount) || 0,
    direction: dirFromType(type as string, direction),
    method: (req.body.method as 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER') || 'CASH',
    reference: typeof req.body.reference === 'string' ? req.body.reference : null,
    description: typeof req.body.description === 'string' ? req.body.description : null,
  });
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CASH',
    `Movimiento ${type} de RD$${Number(req.body.amount) || 0}`,
    req as AuthRequest
  );
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'CASH_MOVEMENT', entityType: 'cash_movement', entityId: String(movementId), newValues: req.body },
    req as AuthRequest
  );
  res.status(201).json({ data: { id: movementId } });
});

function dirFromType(type: string, direction?: string): 'IN' | 'OUT' {
  if (direction === 'IN' || direction === 'OUT') return direction;
  return type === 'EXPENSE' || type === 'ADJUSTMENT' ? 'OUT' : 'IN';
}

export default router;