import { Router } from 'express';
import { z } from 'zod';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import { assertPlanLimit } from '../../services/planService.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  updateWebhook,
} from '../../services/webhookService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect, requireTenant, requirePermission('webhooks.manage'));

// ---------------------------------------------------------------------------
// Webhooks (Fase 8): integraciones salientes
// ---------------------------------------------------------------------------

router.get('/events', async (_req: AuthRequest, res) => {
  res.json({ data: WEBHOOK_EVENTS.map((e) => ({ value: e, label: e })) });
});

router.get('/', async (req: TenantRequest, res) => {
  const webhooks = await listWebhooks(req.ctx!.tenantId);
  res.json({ data: webhooks });
});

const webhookSchema = z.object({
  name: z.string().min(2).max(100),
  url: z.string().min(5).max(500),
  secret: z.string().min(8).max(200),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  isActive: z.boolean().optional().default(true),
});

router.post('/', async (req: TenantRequest, res) => {
  const body = webhookSchema.safeParse(req.body);
  if (!body.success) {
    throw ApiError.badRequest('invalid_input', 'Datos del webhook inválidos');
  }
  // SaaS (FASE 4): respetar el límite max_webhooks del plan.
  await assertPlanLimit(req.ctx!.tenantId, 'webhooks');
  const id = await createWebhook(req.ctx!.tenantId, {
    name: body.data.name,
    url: body.data.url,
    secret: body.data.secret,
    events: body.data.events,
    isActive: body.data.isActive,
  });
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'WEBHOOK_CREATED',
      entityType: 'webhook',
      entityId: String(id),
      newValues: { name: body.data.name, url: body.data.url, events: body.data.events },
    },
    req as AuthRequest
  );
  void recordActivity(
    req.ctx!.tenantId,
    req.auth!.userId,
    'API',
    `Webhook "${body.data.name}" creado (${body.data.events.length} evento(s))`,
    req as AuthRequest
  );
  res.status(201).json({ data: { id } });
});

router.put('/:id', async (req: TenantRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('invalid_id', 'ID inválido');
  const body = webhookSchema.partial().safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Datos del webhook inválidos');
  await updateWebhook(req.ctx!.tenantId, id, {
    name: body.data.name,
    url: body.data.url,
    secret: body.data.secret,
    events: body.data.events,
    isActive: body.data.isActive,
  });
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'WEBHOOK_UPDATED',
      entityType: 'webhook',
      entityId: String(id),
      newValues: body.data,
    },
    req as AuthRequest
  );
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'API', `Webhook #${id} actualizado`, req as AuthRequest);
  res.json({ ok: true });
});

router.delete('/:id', async (req: TenantRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('invalid_id', 'ID inválido');
  await deleteWebhook(req.ctx!.tenantId, id);
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'WEBHOOK_DELETED',
      entityType: 'webhook',
      entityId: String(id),
    },
    req as AuthRequest
  );
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'API', `Webhook #${id} eliminado`, req as AuthRequest);
  res.json({ ok: true });
});

router.get('/:id/deliveries', async (req: TenantRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('invalid_id', 'ID inválido');
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await listDeliveries(req.ctx!.tenantId, id, limit);
  res.json({ data: rows });
});

export default router;