// ============================================================================
// CrediPay MDM - Plan Maestro v2.9, FASE 6
// crypto.ts
// Cifrado AES-256-GCM para secretos en reposo (credenciales InovaGuard y
// cualquier futuro dato sensible). Formato de almacenamiento:
//   enc:v1:<iv>:<tag>:<ciphertext>
// - IV aleatorio por operación (12 bytes).
// - Authentication Tag GCM (16 bytes) para detección de alteración.
// - Codificación Base64URL de IV/tag/cipher.
// - La clave deriva de APP_ENCRYPTION_KEY (sha256 → 32 bytes exactos).
// ============================================================================

import crypto from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1';
const IV_LENGTH = 12;

/** Deriva las 32 bytes exactos de la clave desde APP_ENCRYPTION_KEY. */
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(env.APP_ENCRYPTION_KEY).digest();
}

/** Cifra un texto en formato `enc:v1:<iv>:<tag>:<cipher>` (Base64URL). */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

/** Descifra un payload `enc:v1:...`. Lanza si la clave no coincide o hubo tamper. */
export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 5 || !isEncrypted(payload)) {
    return payload; // no cifrado → legacy/texto plano
  }
  const [, , ivPart, tagPart, cipherPart] = parts;
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const data = Buffer.from(cipherPart, 'base64url');
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new Error('Error al descifrar: clave incorrecta o dato alterado', { cause: err });
  }
}

/** True si el valor ya viene cifrado con el formato enc:v1:. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX + ':');
}

/** Genera una clave de ejemplo (64 caracteres hex) para .env / entornos. */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}