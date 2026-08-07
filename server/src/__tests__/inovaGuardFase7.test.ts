import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdmConfig } from '../services/tenantService.ts';
import {
  fetchInovaGuard,
  invalidateTenantTokens,
  storeToken,
  getStoredToken,
} from '../integrations/inovaGuard/client.ts';
import {
  getInovaGuardDevices,
  getInovaGuardBalance,
  invalidateTenant,
  invalidateInovaGuardCache,
} from '../integrations/inovaGuard/service.ts';

const cfg: MdmConfig = {
  provider: 'INOVAGUARD',
  baseUrl: 'https://ig.test',
  apiKey: '',
  appClient: 'app-a',
  secret: 'sec-a',
  bearerToken: '',
  authLoginEndpoint: '/auth/login',
  devicesEndpoint: '/devices',
  lockEndpoint: '/devices/lock/{id}',
  unlockEndpoint: '/devices/unlock/{id}',
  unlockCodeEndpoint: '/devices/unlock-code/{id}',
  removeEndpoint: '/devices/remove/{id}',
  qrEndpoint: '/devices/qr-enrollment',
  balanceEndpoint: '/balance',
  statusEndpoint: '/devices/find/{id}',
  enabled: true,
  autoLockOnOverdue: true,
  autoUnlockOnPaid: true,
  liveMode: true,
};

const STUB_DEVICES = {
  data: [
    { id: 11, brand: 'Tecno', model: 'Pova', imei: '111', status: 1 },
    { id: 12, brand: 'Xiaomi', model: 'Redmi', imei: '222', status: 2 },
  ],
  next_page_url: null,
};
const STUB_BALANCE = {
  balance: 100, added: 5, demo: 0, demo_used: 0, basic: 10, basic_used: 2,
  business: 5, business_used: 0, enterprise: 2, enterprise_used: 0,
};
const STUB_LICENCES = [{ name: 'Básica', type: 1, availables: 5 }];

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

function stubFetchHandler(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

function happyPathFetch() {
  stubFetchHandler(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/auth/login')) return okResponse({ token: 'FRESH_BEARER' });
    if (u.includes('/devices')) return okResponse(STUB_DEVICES);
    if (u.includes('/balance')) return okResponse(STUB_BALANCE);
    if (u.includes('/licences')) return okResponse(STUB_LICENCES);
    return okResponse({ err: true });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('invalidateTenantTokens (FASE 7 - Bearer por tenant)', () => {
  it('limpia SOLO el token del tenant indicado', () => {
    storeToken(1, 'tok-a');
    storeToken(2, 'tok-b');
    invalidateTenantTokens(1);
    expect(getStoredToken(1)).toBeUndefined();
    expect(getStoredToken(2)).toBe('tok-b');
  });

  it('no rompe si no había token', () => {
    storeToken(1, 'tok-a');
    invalidateTenantTokens(999);
    expect(getStoredToken(1)).toBe('tok-a');
  });
});

describe('invalidateTenant (FASE 7 - rotación completa del tenant)', () => {
  beforeEach(() => {
    invalidateTenant(1);
    invalidateTenant(2);
  });

  it('el snapshot cacheado se sirve sin red, y se reconstruye tras invalidar', async () => {
    happyPathFetch();
    const snap1 = await getInovaGuardDevices(1, cfg, { force: true });
    expect(snap1.devices.length).toBe(2);

    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    const cached = await getInovaGuardDevices(1, cfg);
    expect(cached.devices.length).toBe(2);
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls);

    invalidateTenant(1);
    const callsAfter = vi.mocked(fetch).mock.calls.length;
    const fresh = await getInovaGuardDevices(1, cfg);
    expect(fresh.devices.length).toBe(2);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsAfter);
  });

  it('no invalida la fotografía de OTRO tenant', async () => {
    happyPathFetch();
    await getInovaGuardDevices(1, cfg, { force: true });
    await getInovaGuardDevices(2, cfg, { force: true });

    const calls = vi.mocked(fetch).mock.calls.length;
    invalidateTenant(1);
    await getInovaGuardDevices(2, cfg);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it('invalidateInovaGuardCache (dirty) marca pendiente sin borrar el token', async () => {
    storeToken(1, 'tok-keep');
    invalidateInovaGuardCache(1);
    expect(getStoredToken(1)).toBe('tok-keep');
  });

  it('forzar recarga después de invalidar trae datos actualizados', async () => {
    happyPathFetch();
    await getInovaGuardDevices(1, cfg, { force: true });
    invalidateTenant(1);
    const before = vi.mocked(fetch).mock.calls.length;
    const balanceRes = await getInovaGuardBalance(1, cfg);
    expect(balanceRes.balance.balance).toBe(100);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before);
  });

  it('credenciales inválidas tras invalidar -> error controlado y token descartado', async () => {
    stubFetchHandler(() => okResponse({ err: true }, 401));
    storeToken(1, 'token-rotado');
    invalidateTenant(1);
    const res = await fetchInovaGuard(1, cfg, '/devices', {}, [], true);
    expect(res.error).toContain('401');
    expect(getStoredToken(1)).toBeUndefined();
  });

  it('se obtiene un nuevo Bearer tras invalidar (auto-login con token fresco)', async () => {
    stubFetchHandler(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const auth = ((init?.headers as Record<string, string>) ?? {})?.Authorization ?? '';
      if (u.includes('/auth/login')) return okResponse({ token: 'FRESH_BEARER' });
      if (!auth.includes('FRESH_BEARER')) return okResponse({ err: true }, 401);
      return okResponse(STUB_DEVICES);
    });
    invalidateTenant(1);
    const res = await fetchInovaGuard(1, cfg, '/devices', {}, [], true);
    expect(res.isSimulated).toBe(false);
    expect(getStoredToken(1)).toBe('FRESH_BEARER');
  });
});
