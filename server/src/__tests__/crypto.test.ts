import { describe, expect, it } from 'vitest';
import { encrypt, decrypt, isEncrypted, generateEncryptionKey } from '../utils/crypto.ts';

const SECRET = 'kjDBFuVXssuBJrj7rnHa5vJUk3DY4uDASs1Qdhrm';

describe('crypto (FASE 6 - AES-256-GCM)', () => {
  it('roundtrip: encrypt -> decrypt devuelve el original', () => {
    const enc = encrypt(SECRET);
    expect(decrypt(enc)).toBe(SECRET);
  });

  it('no cifra valores vacíos', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('formato enc:v1:<iv>:<tag>:<cipher> (Base64URL)', () => {
    const enc = encrypt(SECRET);
    const parts = enc.split(':');
    expect(parts.length).toBe(5);
    expect(parts[0] + ':' + parts[1]).toBe('enc:v1');
    expect(Buffer.from(parts[2], 'base64url').length).toBe(12); // IV
    expect(Buffer.from(parts[3], 'base64url').length).toBe(16); // tag GCM
  });

  it('usa IV aleatorio por operación (dos cifrados difieren)', () => {
    expect(encrypt(SECRET)).not.toBe(encrypt(SECRET));
  });

  it('isEncrypted detecta el formato enc:v1:', () => {
    expect(isEncrypted(encrypt(SECRET))).toBe(true);
    expect(isEncrypted(SECRET)).toBe(false);
    expect(isEncrypted('enc:v2:aaaa')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  it('decrypt devuelve texto plano legado sin prefijo (compatibilidad retroactiva)', () => {
    expect(decrypt(SECRET)).toBe(SECRET);
    expect(decrypt('9164|abc')).toBe('9164|abc');
  });

  it('lanza si el tag no coincide (tamper)', () => {
    const enc = encrypt(SECRET);
    const parts = enc.split(':');
    const tamperedTag = Buffer.from('a'.repeat(16)).toString('base64url');
    const tampered = `enc:v1:${parts[2]}:${tamperedTag}:${parts[4]}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('lanza si el ciphertext fue alterado', () => {
    const enc = encrypt(SECRET);
    const parts = enc.split(':');
    const tamperedCipher = Buffer.from('Altered!').toString('base64url');
    const tampered = `enc:v1:${parts[2]}:${parts[3]}:${tamperedCipher}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('generateEncryptionKey devuelve 64 caracteres hex', () => {
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(generateEncryptionKey()).not.toBe(key);
  });
});
