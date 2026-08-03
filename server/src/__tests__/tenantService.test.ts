import { describe, expect, it } from 'vitest';
import { DEFAULT_MDM_CONFIG, parseMdmConfigValue } from '../services/tenantService.ts';

describe('parseMdmConfigValue', () => {
  it('devuelve defaults si el valor es null/undefined', () => {
    expect(parseMdmConfigValue(null)).toEqual(DEFAULT_MDM_CONFIG);
    expect(parseMdmConfigValue(undefined)).toEqual(DEFAULT_MDM_CONFIG);
  });

  it('parsea un string JSON (mysql2 con JSON.parse desactivado)', () => {
    const cfg = parseMdmConfigValue(
      '{"enabled":true,"liveMode":true,"appClient":"d13cb763-1998-4cf8-9bb4-c6dbc8b513cb","secret":"kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm","bearerToken":"9164|abc"}'
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.liveMode).toBe(true);
    expect(cfg.appClient).toBe('d13cb763-1998-4cf8-9bb4-c6dbc8b513cb');
    expect(cfg.secret).toBe('kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm');
    expect(cfg.bearerToken).toBe('9164|abc');
  });

  it('acepta un objeto ya parseado por mysql2 (regresión del bug JSON.parse("[object Object]"))', () => {
    const cfg = parseMdmConfigValue({
      enabled: true,
      liveMode: true,
      appClient: 'app-client-1',
      secret: 'secret-1',
      bearerToken: 'token-1',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.appClient).toBe('app-client-1');
    expect(cfg.bearerToken).toBe('token-1');
  });

  it('mezcla parciales con los defaults (campos omitidos conservan default)', () => {
    const cfg = parseMdmConfigValue({ enabled: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.liveMode).toBe(DEFAULT_MDM_CONFIG.liveMode);
    expect(cfg.baseUrl).toBe(DEFAULT_MDM_CONFIG.baseUrl);
    expect(cfg.provider).toBe(DEFAULT_MDM_CONFIG.provider);
  });

  it('JSON inválido -> defaults (sin excepción)', () => {
    const cfg = parseMdmConfigValue('{esto no es json');
    expect(cfg).toEqual(DEFAULT_MDM_CONFIG);
  });
});
