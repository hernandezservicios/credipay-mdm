import { Router, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authRequired, csrfProtect, type AuthRequest } from '../../middleware/auth.js';
import { loginLimiter, passwordResetLimiter } from '../../middleware/rateLimits.js';
import {
  buildResetLink,
  buildVerificationLink,
  changePassword,
  completeTotpLogin,
  createEmailVerification,
  disableTotp,
  enableTotp,
  findUserByEmail,
  getTwoFactorStatus,
  loadPermissions,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  startTotpSetup,
  verifyEmail,
} from '../../services/authService.js';
import { recordAudit, requestMeta, uaInfo } from '../../services/auditService.js';
import { ApiError } from '../../utils/http.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
});

function setAuthCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
  remember: boolean
) {
  const common = {
    path: '/',
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    httpOnly: true,
    expires: remember ? expiresAt : new Date(Date.now() + 8 * 60 * 60 * 1000),
  };
  res.cookie('sid', sessionToken, common);
  res.cookie('csrf', csrfToken, {
    ...common,
    httpOnly: false,
    expires: remember ? expiresAt : undefined,
  });
}

function clearAuthCookies(res: Response) {
  res.clearCookie('sid', { path: '/', sameSite: 'lax', secure: env.COOKIE_SECURE });
  res.clearCookie('csrf', { path: '/', sameSite: 'lax', secure: env.COOKIE_SECURE });
}

router.post('/login', loginLimiter, async (req: AuthRequest, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    throw ApiError.badRequest('invalid_input', 'Datos de inicio de sesión inválidos');
  }
  const result = await login({
    email: body.data.email,
    password: body.data.password,
    remember: body.data.remember,
    ua: uaInfo(req),
  });
  if ('twoFactorRequired' in result) {
    res.json({ twoFactorRequired: true, ticket: result.ticket, user: result.user });
    return;
  }
  setAuthCookies(res, result.sessionToken, result.csrfToken, result.expiresAt, body.data.remember);
  res.json({
    user: result.user,
    permissions: result.permissions,
    mustChangePassword: result.user.mustChangePassword,
    activeTenantId: result.user.tenantId,
    isGlobal: result.user.tenantId === null,
  });
});

const totpLoginSchema = z.object({
  ticket: z.string().min(10),
  code: z.string().min(6).max(8),
  remember: z.boolean().optional().default(false),
});

router.post('/login/totp', loginLimiter, async (req: AuthRequest, res) => {
  const body = totpLoginSchema.safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Datos de verificación inválidos');
  const result = await completeTotpLogin(body.data.ticket, body.data.code, {
    remember: body.data.remember,
    ua: uaInfo(req),
  });
  setAuthCookies(res, result.sessionToken, result.csrfToken, result.expiresAt, body.data.remember);
  res.json({
    user: result.user,
    permissions: result.permissions,
    mustChangePassword: result.user.mustChangePassword,
    activeTenantId: result.user.tenantId,
    isGlobal: result.user.tenantId === null,
  });
});

// --- Gestión de 2FA (TOTP) ---

router.get('/2fa/status', authRequired, async (req: AuthRequest, res) => {
  res.json({ data: await getTwoFactorStatus(req.auth!.userId) });
});

router.post('/2fa/setup', authRequired, csrfProtect, async (req: AuthRequest, res) => {
  const setup = await startTotpSetup(req.auth!.userId, req.auth!.email);
  res.json({ data: setup });
});

router.post('/2fa/enable', authRequired, csrfProtect, async (req: AuthRequest, res) => {
  const body = z.object({ code: z.string().min(6).max(8) }).safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Código inválido');
  const result = await enableTotp(req.auth!.userId, body.data.code);
  void recordAudit(
    {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: 'auth.two_factor_enabled',
      entityType: 'user',
      entityId: String(req.auth!.userId),
    },
    req as AuthRequest
  );
  res.json({ data: result });
});

router.post('/2fa/disable', authRequired, csrfProtect, async (req: AuthRequest, res) => {
  const body = z.object({ code: z.string().min(6).max(8) }).safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Código inválido');
  await disableTotp(req.auth!.userId, body.data.code);
  void recordAudit(
    {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: 'auth.two_factor_disabled',
      entityType: 'user',
      entityId: String(req.auth!.userId),
    },
    req as AuthRequest
  );
  res.json({ ok: true });
});

router.post('/logout', authRequired, csrfProtect, async (req: AuthRequest, res) => {
  const rawToken = req.cookies?.['sid'] as string;
  await logout(rawToken, { ip: uaInfo(req).ip });
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.get('/me', authRequired, async (req: AuthRequest, res) => {
  const { userId, tenantId, userTenantId, email, name } = req.auth!;
  const permissions = await loadPermissions(userId, tenantId);
  res.json({
    user: { id: userId, email, name, tenantId },
    activeTenantId: tenantId,
    isGlobal: userTenantId === null,
    permissions,
    mustChangePassword: req.auth!.mustChangePassword,
  });
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(10),
});

router.post('/change-password', authRequired, csrfProtect, async (req: AuthRequest, res) => {
  const body = changePasswordSchema.safeParse(req.body);
  if (!body.success) {
    throw ApiError.badRequest('invalid_input', 'Contraseña nueva debe tener al menos 10 caracteres');
  }
  await changePassword({
    userId: req.auth!.userId,
    tenantId: req.auth!.tenantId,
    currentPassword: body.data.current_password,
    newPassword: body.data.new_password,
    currentSessionId: req.auth!.sessionId,
  });
  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});

router.post('/forgot-password', passwordResetLimiter, async (req: AuthRequest, res) => {
  const body = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Correo inválido');

  const user = await findUserByEmail(body.data.email);
  const raw = await requestPasswordReset(body.data.email);

  const response: Record<string, unknown> = { ok: true };
  if (raw && env.NODE_ENV !== 'production') {
    response.dev_link = buildResetLink(raw, body.data.email);
  }
  if (user && env.NODE_ENV !== 'production' && user.status === 'PENDING') {
    const verifyRaw = await createEmailVerification(user.id);
    response.dev_verify_link = buildVerificationLink(verifyRaw, user.email);
  }
  res.json(response);
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  email: z.string().email(),
  new_password: z.string().min(10),
});

router.post('/reset-password', passwordResetLimiter, async (req: AuthRequest, res) => {
  const body = resetPasswordSchema.safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Datos inválidos');

  await resetPassword({
    token: body.data.token,
    email: body.data.email,
    newPassword: body.data.new_password,
  });
  res.json({ ok: true, message: 'Contraseña restablecida. Ya puede iniciar sesión.' });
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

router.post('/verify-email', async (req: AuthRequest, res) => {
  const body = verifyEmailSchema.safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Token inválido');

  await verifyEmail(body.data.token);
  res.json({ ok: true, message: 'Correo verificado correctamente' });
});

const resendSchema = z.object({ email: z.string().email() });

router.post('/resend-verification', passwordResetLimiter, async (req: AuthRequest, res) => {
  const body = resendSchema.safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('invalid_input', 'Correo inválido');

  const user = await findUserByEmail(body.data.email);
  if (user && !user.email_verified_at && env.NODE_ENV !== 'production') {
    const raw = await createEmailVerification(user.id);
    res.json({ ok: true, dev_link: buildVerificationLink(raw, user.email) });
    return;
  }
  res.json({ ok: true });
});

export function auditViewMeta(req: AuthRequest) {
  return requestMeta(req);
}

export default router;
