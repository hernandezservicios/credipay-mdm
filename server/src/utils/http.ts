import crypto from 'crypto';
import type { Request } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  static badRequest(code: string, message: string) {
    return new ApiError(400, code, message);
  }

  static unauthorized(message = 'No autorizado') {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(code: string, message: string) {
    return new ApiError(403, code, message);
  }

  static notFound(message = 'Recurso no encontrado') {
    return new ApiError(404, 'not_found', message);
  }

  static tooManyRequests(message = 'Demasiados intentos') {
    return new ApiError(429, 'too_many_requests', message);
  }
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

interface ParsedUserAgent {
  browser: string;
  os: string;
  deviceType: string;
}

export function parseUserAgent(ua?: string): ParsedUserAgent {
  const raw = ua ?? '';
  let browser = 'Desconocido';
  let os = 'Desconocido';
  let deviceType = 'Desktop';

  if (/Edg\//i.test(raw)) browser = 'Edge';
  else if (/Chrome\//i.test(raw)) browser = 'Chrome';
  else if (/Firefox\//i.test(raw)) browser = 'Firefox';
  else if (/Safari\//i.test(raw)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(raw)) browser = 'Internet Explorer';

  if (/Windows/i.test(raw)) os = 'Windows';
  else if (/Android/i.test(raw)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(raw)) os = 'iOS';
  else if (/Mac OS X/i.test(raw)) os = 'macOS';
  else if (/Linux/i.test(raw)) os = 'Linux';

  if (/iPad|Tablet/i.test(raw)) deviceType = 'Tablet';
  else if (/Mobi|iPhone|Android.*Mobile/i.test(raw)) deviceType = 'Móvil';

  return { browser, os, deviceType };
}

export function isValidPassword(pw: string): boolean {
  return pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}
