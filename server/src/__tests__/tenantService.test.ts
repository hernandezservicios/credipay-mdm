import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MDM_CONFIG,
  parseMdmConfigValue,
  decryptMdmConfigForTest,
  encryptMdmConfigForTest,
} from '../services/tenantService.ts';
import { isEncrypted } from '../utils/crypto.ts';

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

describe('cifrado de credenciales MDM (FASE 6)', () => {
  const cfg = parseMdmConfigValue({
    provider: 'INOVAGUARD',
    enabled: true,
    apiKey: 'api-123',
    appClient: 'app-456',
    secret: 'sec-789',
    bearerToken: 'tok-abc',
    baseUrl: 'https://example.com',
  });

  it('encryptMdmConfigForTest cifra las 4 credenciales con formato enc:v1:', () => {
    const enc = encryptMdmConfigForTest(cfg);
    expect(isEncrypted(enc.apiKey)).toBe(true);
    expect(isEncrypted(enc.appClient)).toBe(true);
    expect(isEncrypted(enc.secret)).toBe(true);
    expect(isEncrypted(enc.bearerToken)).toBe(true);
    expect(enc.baseUrl).toBe('https://example.com');
    expect(enc.enabled).toBe(true);
  });

  it('roundtrip cifrado -> descifrado devuelve los secretos originales', () => {
    const enc = encryptMdmConfigForTest(cfg);
    const dec = decryptMdmConfigForTest(enc);
    expect(dec.apiKey).toBe('api-123');
    expect(dec.appClient).toBe('app-456');
    expect(dec.secret).toBe('sec-789');
    expect(dec.bearerToken).toBe('tok-abc');
    expect(dec.baseUrl).toBe('https://example.com');
  });

  it('es idempotente: no re-cifra valores ya cifrados', () => {
    const once = encryptMdmConfigForTest(cfg);
    const twice = encryptMdmConfigForTest(once);
    expect(twice.apiKey).toBe(once.apiKey);
    expect(twice.secret).toBe(once.secret);
  });

  it('valores legados en claro pasan tal cual por decrypt (compatibilidad)', () => {
    const dec = decryptMdmConfigForTest(cfg);
    expect(dec.apiKey).toBe('api-123');
    expect(dec.secret).toBe('sec-789');
  });

  it('no cifra credenciales vacías (placeholders siguen vacíos)', () => {
    const empty = encryptMdmConfigForTest({ ...DEFAULT_MDM_CONFIG });
    expect(empty.apiKey).toBe('');
    expect(empty.secret).toBe('');
  });
});
