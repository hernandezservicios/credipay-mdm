import type { MdmConfig } from '../../services/tenantService.js';

export type { MdmConfig };

export interface FetchResult<T> {
  data: T;
  isSimulated: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tokens Bearer por tenant (expiran; se renuevan con auto-login)
// ---------------------------------------------------------------------------
const tokens = new Map<number, string>();

async function loginRaw(tenantId: number, cfg: MdmConfig): Promise<string | null> {
  if (!cfg.enabled || !cfg.liveMode || !cfg.appClient) return null;
  try {
    const response = await fetch(
      `${cfg.baseUrl}${cfg.authLoginEndpoint || '/auth/login'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client: cfg.appClient, secret: cfg.secret }),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: string };
    return typeof data.token === 'string' && data.token ? data.token : null;
  } catch {
    return null;
  }
}

export async function fetchInovaGuard<T>(
  tenantId: number,
  cfg: MdmConfig,
  endpoint: string,
  options: RequestInit = {},
  fallbackData: T,
  allowAuthRetry = true,
  onAuthRefresh?: () => void
): Promise<FetchResult<T>> {
  const url = endpoint.startsWith('http') ? endpoint : `${cfg.baseUrl}${endpoint}`;

  // MDM desactivado o modo simulación -> no tocar la red
  if (!cfg.enabled || !cfg.liveMode) {
    return { data: fallbackData, isSimulated: true };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    const token = tokens.get(tenantId) || cfg.bearerToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let response = await fetch(url, { ...options, headers });

    // Token expirado -> auto-login y reintento único
    if ((response.status === 401 || response.status === 403) && allowAuthRetry) {
      const freshToken = await loginRaw(tenantId, cfg);
      if (freshToken) {
        tokens.set(tenantId, freshToken);
        onAuthRefresh?.();
        response = await fetch(url, {
          ...options,
          headers: { ...headers, Authorization: `Bearer ${freshToken}` },
        });
      }
    }

    if (!response.ok) {
      return { data: fallbackData, isSimulated: true, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('image') || contentType.includes('octet-stream')) {
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        data: { bufferBase64: buf.toString('base64') } as unknown as T,
        isSimulated: false,
      };
    }

    const data = (await response.json()) as T;
    return { data, isSimulated: false };
  } catch (err) {
    return {
      data: fallbackData,
      isSimulated: true,
      error: err instanceof Error ? err.message : 'Error de conexión HTTP',
    };
  }
}

export function commandUrl(cfg: MdmConfig, endpoint: string, id: string): string {
  return `${cfg.baseUrl}${endpoint.replace('{id}', encodeURIComponent(id))}`;
}

export function storeToken(tenantId: number, token: string): void {
  tokens.set(tenantId, token);
}

export function clearTokens(): void {
  tokens.clear();
}

// FASE 7: elimina únicamente el Bearer Token del tenant indicado. No afecta a
// otros tenants. El refresh token no existe en el flujo actual de InovaGuard
// (auto-login único vía /auth/login); si en el futuro se añade, debe limpiarse
// aquí también.
export function invalidateTenantTokens(tenantId: number): void {
  tokens.delete(tenantId);
}

// Exposición acotada para diagnóstico/test: devuelve el Bearer activo (si lo hay).
export function getStoredToken(tenantId: number): string | undefined {
  return tokens.get(tenantId);
}