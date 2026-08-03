import type { NextFunction, Response } from 'express';
import { ApiError } from '../utils/http.js';
import {
  getMdmConfig,
  getTenant,
  type MdmConfig,
  type TenantRow,
} from '../services/tenantService.js';
import type { AuthRequest } from './auth.js';

export interface TenantContext {
  tenantId: number;
  tenant: TenantRow;
  mdmConfig: MdmConfig;
}

export interface TenantRequest extends AuthRequest {
  ctx?: TenantContext;
}

/**
 * Requiere que el usuario autenticado pertenezca a un tenant activo y
 * adjunta el contexto del tenant (datos + configuración MDM) a req.ctx.
 */
export async function requireTenant(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw ApiError.unauthorized();
    if (req.auth.tenantId === null) {
      throw ApiError.forbidden('tenant_required', 'Este recurso requiere un tenant activo');
    }
    const [tenant, mdmConfig] = await Promise.all([
      getTenant(req.auth.tenantId),
      getMdmConfig(req.auth.tenantId),
    ]);
    if (tenant.status !== 'ACTIVE') {
      throw ApiError.forbidden('tenant_suspended', 'El tenant está suspendido');
    }
    req.ctx = { tenantId: req.auth.tenantId, tenant, mdmConfig };
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
}
