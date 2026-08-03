import rateLimit from 'express-rate-limit';
import { getClientIp } from '../utils/http.js';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  handler: (_req, res) => {
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Demasiados intentos de inicio de sesión. Intente más tarde.',
    });
  },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  handler: (_req, res) => {
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Demasiadas solicitudes de recuperación. Intente más tarde.',
    });
  },
});
