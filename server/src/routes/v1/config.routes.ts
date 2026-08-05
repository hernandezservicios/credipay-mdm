import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import {
  CONFIG_SECTIONS,
  deleteLoanProduct,
  getIntegrationLog,
  getPlatformConfig,
  listLoanProducts,
  updatePlatformConfig,
  upsertLoanProduct,
} from '../../services/configService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();
router.use(authRequired, requireTenant, csrfProtect);

router.get('/', requirePermission('config.view'), async (req: TenantRequest, res) => {
  const config = await getPlatformConfig(req.ctx!.tenantId);
  res.json({ data: config });
});

router.put('/:section', requirePermission('config.manage'), async (req: TenantRequest, res) => {
  const section = req.params.section as (typeof CONFIG_SECTIONS)[number];
  if (!CONFIG_SECTIONS.includes(section)) {
    throw ApiError.badRequest('invalid_section', 'Sección de configuración inválida');
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const config = await updatePlatformConfig(req.ctx!.tenantId, section, body);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'CONFIG_UPDATED', entityType: 'config', entityId: section, newValues: body },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'CONFIG',
    `Configuración actualizada (${section})`,
    req as AuthRequest
  );
  res.json({ data: config });
});

// Log de errores de integraciones
router.get('/integration-log', requirePermission('config.view'), async (req: TenantRequest, res) => {
  const entries = await getIntegrationLog(req.ctx!.tenantId);
  res.json({ data: entries });
});

// Productos de préstamo
router.get('/loan-products', requirePermission('loans.view'), async (req: TenantRequest, res) => {
  const data = await listLoanProducts(req.ctx!.tenantId);
  res.json({ data });
});

router.post('/loan-products', requirePermission('config.manage'), async (req: TenantRequest, res) => {
  const product = await upsertLoanProduct(req.ctx!.tenantId, null, req.body);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_PRODUCT_CREATED', entityType: 'loan_product', entityId: String(product.id), newValues: req.body },
    req as AuthRequest
  );
  res.status(201).json({ data: product });
});

router.patch('/loan-products/:id', requirePermission('config.manage'), async (req: TenantRequest, res) => {
  const product = await upsertLoanProduct(req.ctx!.tenantId, Number(req.params.id), req.body);
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_PRODUCT_UPDATED', entityType: 'loan_product', entityId: String(req.params.id), newValues: req.body },
    req as AuthRequest
  );
  res.json({ data: product });
});

router.delete('/loan-products/:id', requirePermission('config.manage'), async (req: TenantRequest, res) => {
  await deleteLoanProduct(req.ctx!.tenantId, Number(req.params.id));
  void recordAudit(
    { tenantId: req.ctx!.tenantId, userId: req.auth!.userId, action: 'LOAN_PRODUCT_DELETED', entityType: 'loan_product', entityId: String(req.params.id) },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), deleted: true } });
});

export default router;