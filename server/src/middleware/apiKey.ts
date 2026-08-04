// ============================================================================
// CrediPay MDM - Fase 7
// apiKey.ts (middleware)
// Autenticación alternativa por API key (X-API-Key) para integraciones
// externas. Añade el contexto al request como si fuera una sesión.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import { authenticateApiKey, type ApiKeyAuthResult } from '../services/apiKeyService.js';
import { ApiError } from '../utils/http.js';

export type ApiKeyRequest = Request & {
  auth?: ApiKeyAuthResult & { apiKey: true };
};

export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const rawKey = (req.headers['x-api-key'] as string | undefined)?.trim();
    if (!rawKey) {
      next(new ApiError(401, 'missing_api_key', 'Encabezado X-API-Key requerido'));
      return;
    }
    const result = await authenticateApiKey(rawKey);
    if (!result) {
      next(new ApiError(401, 'invalid_api_key', 'API key invalida o revocada'));
      return;
    }
    (req as ApiKeyRequest).auth = { ...result, apiKey: true };
    next();
  } catch (err) {
    next(err);
  }
}

/** Permite sesión (cookie) O API key válida. */
export function sessionOrApiKey(req: Request, _res: Response, next: NextFunction): void {
  const rawKey = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (rawKey) {
    void apiKeyAuth(req, _res, next);
    return;
  }
  next();
}