import { Router } from 'express';
import { authRequired, csrfProtect, requirePermission, type AuthRequest } from '../../middleware/auth.js';
import { requireTenant, type TenantRequest } from '../../middleware/tenant.js';
import {
  createClient,
  deleteClient,
  getClientFull,
  listClients,
  updateClient,
} from '../../services/repoService.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';

const router = Router();

router.use(authRequired, requireTenant, csrfProtect);

router.get('/', requirePermission('clients.view'), async (req: TenantRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 50), 200);
  const result = await listClients(req.ctx!.tenantId, {
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page,
    perPage,
  });
  res.json(result);
});

router.get('/:id', requirePermission('clients.view'), async (req: TenantRequest, res) => {
  const client = await getClientFull(req.ctx!.tenantId, Number(req.params.id));
  res.json({ data: client });
});

router.post('/', requirePermission('clients.create'), async (req: TenantRequest, res) => {
  const body = req.body as {
    fullName?: string;
    cedulaOrId?: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
  };
  if (!body.fullName?.trim()) {
    res.status(400).json({ error: 'invalid_name', message: 'El nombre completo es obligatorio' });
    return;
  }
  const created = await createClient(req.ctx!.tenantId, req.auth!.userId, body);
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'CLIENT_CREATED',
      entityType: 'client',
      entityId: String(created.id),
      newValues: body,
    },
    req as AuthRequest
  );
  void recordActivity(req.ctx!.tenantId, req.auth!.userId, 'CLIENT', 'Cliente creado', req as AuthRequest);
  res.status(201).json({ data: created });
});

router.patch('/:id', requirePermission('clients.edit'), async (req: TenantRequest, res) => {
  await updateClient(req.ctx!.tenantId, Number(req.params.id), req.body);
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'CLIENT_UPDATED',
      entityType: 'client',
      entityId: String(req.params.id),
      newValues: req.body,
    },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id) } });
});

router.delete('/:id', requirePermission('clients.delete'), async (req: TenantRequest, res) => {
  await deleteClient(req.ctx!.tenantId, Number(req.params.id));
  void recordAudit(
    {
      tenantId: req.ctx!.tenantId,
      userId: req.auth!.userId,
      action: 'CLIENT_DELETED',
      entityType: 'client',
      entityId: String(req.params.id),
    },
    req as AuthRequest
  );
  res.json({ data: { id: Number(req.params.id), deleted: true } });
});

export default router;
