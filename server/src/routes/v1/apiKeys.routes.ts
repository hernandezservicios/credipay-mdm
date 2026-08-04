import { Router } from 'express';
import { z } from 'zod';
import {
  authRequired,
  csrfProtect,
  requirePermission,
  type AuthRequest,
} from '../../middleware/auth.js';
import { apiKeyAuth, type ApiKeyRequest } from '../../middleware/apiKey.js';
import { recordActivity, recordAudit } from '../../services/auditService.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/apiKeyService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

router.use(authRequired, csrfProtect, requirePermission('api_keys.manage'));

// ---------------------------------------------------------------------------
// API Keys (Fase 7): integraciones externas
// ---------------------------------------------------------------------------

router.get('/', async (req: AuthRequest, res) => {
  const keys = await listApiKeys(req.auth!.userId);
  res.json({ data: keys });
});

const createSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(z.string()).optional().default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

router.post('/', async (req: AuthRequest, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) {
    throw ApiError.badRequest('invalid_input', 'Nombre inválido (2-100 caracteres)');
  }
  const key = await createApiKey({
    userId: req.auth!.userId,
    tenantId: req.auth!.tenantId,
    name: body.data.name,
    scopes: body.data.scopes,
    expiresInDays: body.data.expiresInDays,
  });
  void recordAudit(
    {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: 'API_KEY_CREATED',
      entityType: 'api_key',
      entityId: String(key.id),
      newValues: { name: body.data.name, scopes: body.data.scopes },
    },
    req as AuthRequest
  );
  void recordActivity(
    req.auth!.tenantId,
    req.auth!.userId,
    'API',
    `API key "${body.data.name}" creada (se muestra una sola vez)`,
    req as AuthRequest
  );
  res.json({ data: { id: key.id, name: body.data.name, key: key.key, printed: key.printed } });
});

router.delete('/:id', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('invalid_id', 'ID inválido');
  }
  await revokeApiKey(req.auth!.userId, id);
  void recordAudit(
    {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: 'API_KEY_REVOKED',
      entityType: 'api_key',
      entityId: String(id),
    },
    req as AuthRequest
  );
  void recordActivity(req.auth!.tenantId, req.auth!.userId, 'API', `API key #${id} revocada`, req as AuthRequest);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Probe: verifica autenticación por sesión O por API key (público)
// ---------------------------------------------------------------------------

export const probeRouter = Router();
probeRouter.get(
  '/api/v1/api-keys/probe',
  (req, res, next) => {
    const rawKey = (req.headers['x-api-key'] as string | undefined)?.trim();
    if (rawKey) {
      void apiKeyAuth(req as ApiKeyRequest, res, next);
      return;
    }
    authRequired(req as AuthRequest, res, next);
  },
  async (req: ApiKeyRequest, res) => {
    const auth = req.auth;
    if (!auth) throw new ApiError(401, 'auth_required', 'Autenticación requerida (sesión o API key)');
    res.json({
      data: {
        authenticatedVia: auth.apiKey ? 'api_key' : 'session',
        keyName: auth.apiKey ? auth.keyName : null,
        userId: auth.userId,
        tenantId: auth.tenantId,
        permissions: auth.permissions,
      },
    });
  }
);

export default router;