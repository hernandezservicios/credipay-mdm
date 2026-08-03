import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { ApiError, timingSafeEqual } from '../utils/http.js';
import { getSessionUser, loadPermissions } from '../services/authService.js';

export interface AuthContext {
  userId: number;
  tenantId: number | null;
  email: string;
  name: string;
  permissions: Set<string>;
  sessionId: string;
  csrfToken: string | null;
  mustChangePassword: boolean;
}

export interface AuthRequest extends Request {
  auth?: AuthContext;
}

export async function authRequired(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rawToken = req.cookies?.['sid'] as string | undefined;
    if (!rawToken) throw ApiError.unauthorized();

    const found = await getSessionUser(rawToken);
    if (!found) throw ApiError.unauthorized();

    const permissions = await loadPermissions(found.user.id, found.user.tenant_id);
    req.auth = {
      userId: found.user.id,
      tenantId: found.user.tenant_id,
      email: found.user.email,
      name: found.user.name,
      permissions: new Set(permissions),
      sessionId: found.session.id,
      csrfToken: found.session.csrf_token,
      mustChangePassword: found.user.must_change_password === 1,
    };
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  }
}

export function requirePermission(permissionKey: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized', message: 'No autorizado' });
      return;
    }
    if (!req.auth.permissions.has(permissionKey)) {
      res.status(403).json({
        error: 'forbidden',
        message: 'No tiene permiso para realizar esta acción',
        permission: permissionKey,
      });
      return;
    }
    next();
  };
}

export function csrfProtect(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized', message: 'No autorizado' });
    return;
  }
  const header = req.headers['x-csrf-token'] as string | undefined;
  if (!req.auth.csrfToken || !header || !timingSafeEqual(header, req.auth.csrfToken)) {
    res.status(403).json({ error: 'csrf_invalid', message: 'Token CSRF inválido' });
    return;
  }
  next();
}

export async function ensureCsrfForSessionless(sessionToken: string, header: string | undefined): Promise<boolean> {
  if (!sessionToken || !header) return false;
  interface CsrfRow extends RowDataPacket {
    csrf_token: string | null;
  }
  const [rows] = await pool.query<CsrfRow[]>(
    'SELECT csrf_token FROM sessions WHERE id = ? AND revoked_at IS NULL',
    [sessionToken]
  );
  const row = rows[0];
  return !!row?.csrf_token && !!header && timingSafeEqual(header, row.csrf_token);
}
