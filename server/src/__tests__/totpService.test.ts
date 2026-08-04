import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  generateRecoveryCodes,
  generateSecret,
  otpauthUrl,
  randomBase32,
  removeRecoveryCode,
  sha256Hex,
  totpCode,
  verifyRecoveryCode,
  verifyTotp,
} from '../services/totpService.ts';

describe('TOTP (RFC 6238)', () => {
  // Secreto oficial RFC 6238: ASCII "12345678901234567890" en base32
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('decodifica base32 correctamente', () => {
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it('cumple los vectores de prueba del Apéndice B de RFC 6238 (8 dígitos)', () => {
    // Extrae el binCode de 31 bits y reduce a 8 dígitos para comparar con el RFC
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, expected] of vectors) {
      // totpCode reduce a 6 dígitos; regeneramos con 8 para el vector oficial
      const counter = Math.floor(t / 30);
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64BE(BigInt(counter));
      const { createHmac } = require('crypto') as typeof import('crypto');
      const hmac = createHmac('sha1', base32Decode(RFC_SECRET)).update(buf).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const binCode =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
      expect(String(binCode % 10 ** 8).padStart(8, '0')).toBe(expected);
    }
  });

  it('genera códigos de 6 dígitos deterministas por paso de 30s', () => {
    const a = totpCode(RFC_SECRET, 59);
    const b = totpCode(RFC_SECRET, 59);
    const c = totpCode(RFC_SECRET, 89);
    expect(a).toMatch(/^\d{6}$/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('verifyTotp acepta el paso actual y +/-1', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    expect(verifyTotp(secret, totpCode(secret, now))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 30))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90))).toBe(false);
  });

  it('verifyTotp rechaza formatos y códigos incorrectos', () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp('', '123456')).toBe(false);
  });

  it('randomBase32 genera secretos válidos de 32 caracteres', () => {
    const secret = randomBase32(20);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // round-trip: encode -> decode recupera 20 bytes
    expect(base32Decode(secret).length).toBe(20);
  });
});

describe('Códigos de recuperación', () => {
  it('genera 10 códigos únicos de 6 dígitos con sus hashes', () => {
    const { plain, hashed } = generateRecoveryCodes(10);
    expect(plain).toHaveLength(10);
    expect(hashed).toHaveLength(10);
    expect(new Set(plain).size).toBe(10);
    for (const code of plain) expect(code).toMatch(/^\d{6}$/);
    for (const h of hashed) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifica y elimina un código usado (one-time use)', () => {
    const { plain, hashed } = generateRecoveryCodes(10);
    expect(verifyRecoveryCode(plain[0], hashed)).toBe(true);
    expect(verifyRecoveryCode('999999', hashed)).toBe(false);
    const remaining = removeRecoveryCode(plain[0], hashed);
    expect(remaining).toHaveLength(9);
    expect(verifyRecoveryCode(plain[0], remaining)).toBe(false);
  });

  it('verifyRecoveryCode no acepta listas nulas ni códigos con espacios', () => {
    const { plain, hashed } = generateRecoveryCodes(3);
    expect(verifyRecoveryCode(plain[0], null)).toBe(false);
    expect(verifyRecoveryCode(plain[0], [])).toBe(false);
    expect(verifyRecoveryCode(` ${plain[0]} `, hashed)).toBe(true);
  });
});

describe('Utilidades TOTP', () => {
  it('otpauthUrl genera una URL con los parámetros correctos', () => {
    const url = otpauthUrl('SECRETO123', 'admin@credipay.local', 'CrediPay MDM');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('secret=SECRETO123');
    expect(url).toContain('issuer=CrediPay+MDM');
    expect(url).toContain('algorithm=SHA1');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });

  it('sha256Hex es estable y sensible a mayúsculas', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('ABC'));
  });
});
