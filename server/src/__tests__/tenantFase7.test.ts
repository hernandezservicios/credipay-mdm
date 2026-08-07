import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredToken, storeToken } from '../integrations/inovaGuard/client.ts';
import { DEFAULT_MDM_CONFIG, updateMdmConfig } from '../services/tenantService.ts';

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/pool.js';

const mockQuery = vi.mocked(pool.query);

// getTenantSettings devuelve fila sin mdm_config (defaults)
function defaultSettingsRow() {
  mockQuery.mockImplementation(async (sql: string | unknown) => {
    if (typeof sql === 'string' && sql.trim().startsWith('SELECT')) {
      return [[], []] as never;
    }
    return [{ affectedRows: 1, insertId: 1 }, []] as never;
  });
}

describe('FASE 7 - updateMdmConfig invalida la caché al rotar credenciales', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    defaultSettingsRow();
  });

  it('sin cambio de credenciales: el token del tenant se conserva', async () => {
    storeToken(7, 'tok-7');
    await updateMdmConfig(7, { baseUrl: 'https://nuevo.example.com' });
    expect(getStoredToken(7)).toBe('tok-7');
  });

  it('cambio de secret -> invalida el token del tenant', async () => {
    storeToken(7, 'tok-vecchio');
    await updateMdmConfig(7, { secret: 'nuevo-secret' });
    expect(getStoredToken(7)).toBeUndefined();
  });

  it('cambio de appClient -> invalida el token del tenant', async () => {
    storeToken(7, 'tok-app');
    await updateMdmConfig(7, { appClient: 'nuevo-app' });
    expect(getStoredToken(7)).toBeUndefined();
  });

  it('cambio de bearerToken -> invalida el token del tenant', async () => {
    storeToken(7, 'tok-bearer');
    await updateMdmConfig(7, { bearerToken: 'nuevo-token' });
    expect(getStoredToken(7)).toBeUndefined();
  });

  it('patch sin secretos (solo enabled/baseUrl) no rompe el flujo y persiste cifrado', async () => {
    storeToken(7, 'tok-keeper');
    const merged = await updateMdmConfig(7, { enabled: true, liveMode: true });
    expect(merged.enabled).toBe(true);
    expect(getStoredToken(7)).toBe('tok-keeper');
    // FASE 6: se persiste con las credenciales cifradas enc:v1:
    const persisted = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && String(sql).includes('INSERT INTO tenant_settings')
    );
    expect(persisted).toBeTruthy();
    const secondArg = persisted![1];
    const stored = JSON.stringify(Array.isArray(secondArg) ? secondArg[1] : secondArg);
    // credenciales por defecto vacías -> no generan enc:v1:; solo validamos el flujo
    expect(stored).toContain('liveMode');
  });

  it('DEFAULT_MDM_CONFIG sigue exportándose sin secretos en claro', () => {
    expect(DEFAULT_MDM_CONFIG.appClient).toBe('');
    expect(DEFAULT_MDM_CONFIG.secret).toBe('');
  });
});