// ============================================================================
// CrediPay MDM - Fase 7 / Fase 8
// apiKey.ts (middleware)
// Autenticación alternativa por API key (X-API-Key) para integraciones
// externas. Añade el contexto al request como si fuera una sesión.
// Fase 8: enforcement del límite de peticiones por minuto (rate limit)
// con ventana deslizante en memoria, usando api_keys.rate_limit_per_min.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import { authenticateApiKey, type ApiKeyAuthResult } from '../services/apiKeyService.js';
import { ApiError } from '../utils/http.js';

export type ApiKeyRequest = Request & {
  auth?: ApiKeyAuthResult & { apiKey: true };
};

// Ventana deslizante en memoria: key_id -> timestamps de llamadas.
// Se poda cada 2 minutos para no crecer indefinidamente.
const callsByKey = new Map<number, number[]>();
const WINDOW_MS = 60_000;
let lastPrune = Date.now();

function pruneWindow(): void {
  const now = Date.now();
  if (now - lastPrune < 2 * 60_000) return;
  lastPrune = now;
  for (const [keyId, stamps] of callsByKey) {
    const alive = stamps.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) callsByKey.delete(keyId);
    else callsByKey.set(keyId, alive);
  }
}

export function checkApiKeyRateLimit(keyId: number, limitPerMin: number): void {
  pruneWindow();
  const now = Date.now();
  const stamps = (callsByKey.get(keyId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= limitPerMin) {
    throw ApiError.tooManyRequests(
      `Límite de la API key alcanzado (${limitPerMin} peticiones/minuto). Espere y reintente.`
    );
  }
  stamps.push(now);
  callsByKey.set(keyId, stamps);
}

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
    checkApiKeyRateLimit(result.keyId, result.rateLimitPerMin);
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
