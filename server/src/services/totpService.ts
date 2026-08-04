// ============================================================================
// CrediPay MDM - Fase 7
// totpService.ts
// Implementación TOTP (RFC 6238) sin dependencias externas, sobre node:crypto:
// HMAC-SHA1, pasos de 30s, 6 dígitos y códigos de recuperación.
// ============================================================================

import { createHash, createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function randomBase32(bytes = 20): string {
  const buf = randomBytes(bytes);
  let out = '';
  let acc = 0n;
  let bits = 0;
  for (const byte of buf) {
    acc = (acc << 8n) | BigInt(byte);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[Number((acc >> BigInt(bits - 5)) & 31n)];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[Number((acc << BigInt(5 - bits)) & 31n)];
  return out;
}

export function generateSecret(): string {
  return randomBase32(20);
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  let acc = 0n;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    acc = (acc << 5n) | BigInt(idx);
    bits += 5;
    while (bits >= 8) {
      bytes.push(Number((acc >> BigInt(bits - 8)) & 0xffn));
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, counterSeconds = Math.floor(Date.now() / 1000)): string {
  const key = base32Decode(secret);
  const counter = Math.floor(counterSeconds / STEP_SECONDS);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000);
  for (let w = -window; w <= window; w += 1) {
    if (totpCode(secret, now + w * STEP_SECONDS) === code) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string, issuer = 'CrediPay MDM'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export interface RecoveryCodes {
  plain: string[];
  hashed: string[];
}

export function generateRecoveryCodes(count = 10): RecoveryCodes {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = Array.from(randomBytes(5))
      .map((b) => String(b % 10))
      .join('')
      .padStart(6, '0')
      .slice(0, 6);
    plain.push(code);
    hashed.push(sha256Hex(code));
  }
  return { plain, hashed };
}

export function verifyRecoveryCode(candidate: string, hashedCodes: string[] | null): boolean {
  if (!Array.isArray(hashedCodes)) return false;
  const candidateHash = sha256Hex(candidate.trim());
  return hashedCodes.includes(candidateHash);
}

export function removeRecoveryCode(candidate: string, hashedCodes: string[]): string[] {
  const candidateHash = sha256Hex(candidate.trim());
  return hashedCodes.filter((h) => h !== candidateHash);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}