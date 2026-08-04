import { describe, expect, it } from 'vitest';
import { interpolate } from '../services/emailService.ts';
import { checkApiKeyRateLimit } from '../middleware/apiKey.ts';
import { parseEvents, WEBHOOK_EVENTS } from '../services/webhookService.ts';
import { ApiError } from '../utils/http.ts';

describe('interpolate (plantillas email, Fase 8)', () => {
  it('reemplaza {{var}} con el valor', () => {
    expect(interpolate('Hola {{nombre}}, paga {{monto}}', { nombre: 'Ana', monto: 'RD$500' })).toBe(
      'Hola Ana, paga RD$500'
    );
  });

  it('deja vacío cuando la variable no existe', () => {
    expect(interpolate('a{{x}}b', {})).toBe('ab');
  });

  it('tolera espacios alrededor de la clave', () => {
    expect(interpolate('{{ nombre }}!', { nombre: 'Luis' })).toBe('Luis!');
  });
});

describe('checkApiKeyRateLimit (rate limit por API key, Fase 8)', () => {
  it('permite llamadas dentro del límite', () => {
    const keyId = 9001;
    for (let i = 0; i < 5; i++) {
      expect(() => checkApiKeyRateLimit(keyId, 5)).not.toThrow();
    }
    expect(() => checkApiKeyRateLimit(keyId, 5)).toThrow(ApiError);
  });

  it('lanza 429 al superar el límite', () => {
    expect(() => checkApiKeyRateLimit(9002, 1)).not.toThrow();
    expect(() => checkApiKeyRateLimit(9002, 1)).toThrow('Límite de la API key alcanzado');
  });
});

describe('webhooks (Fase 8)', () => {
  it('expone los eventos soportados', () => {
    expect(WEBHOOK_EVENTS).toContain('payment.paid');
    expect(WEBHOOK_EVENTS).toContain('device.locked');
    expect(WEBHOOK_EVENTS).toContain('collection.run_completed');
  });

  it('parseEvents decodifica JSON de base de datos', () => {
    expect(parseEvents('["payment.paid"]')).toEqual(['payment.paid']);
    expect(parseEvents(['device.locked'])).toEqual(['device.locked']);
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents('no-json')).toEqual([]);
  });
});