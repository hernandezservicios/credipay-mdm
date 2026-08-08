// ============================================================================
// CrediPay MDM - Fase 8
// emailService.ts
// Envío de correo transaccional SMTP (nodemailer). Si SMTP no está configurado
// funciona en modo desarrollo: imprime el correo en consola y nunca rompe el
// flujo. Las plantillas viven en email_templates con interpolación {{var}}.
// ============================================================================

import type { Transporter } from 'nodemailer';
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

let transporter: Transporter | null | undefined;

export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key] ?? '';
    return String(value);
  });
}

/** Configura el transporter de nodemailer (o null si SMTP no está configurado). */
export function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  // Import dinámico: nodemailer sólo se usa al configurar SMTP.
  const nodemailer = require('nodemailer') as typeof import('nodemailer');
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export interface RenderedTemplate {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/** Busca plantilla (tenant específica primero, luego global) y la interpola. */
export async function renderTemplate(
  templateKey: string,
  vars: Record<string, unknown>,
  tenantId?: number | null
): Promise<RenderedTemplate | null> {
  const params: unknown[] = [templateKey];
  let where = 'template_key = ?';
  if (tenantId) {
    where = '(tenant_id = ? OR tenant_id IS NULL) AND template_key = ?';
    params.unshift(tenantId);
  } else {
    where = 'tenant_id IS NULL AND template_key = ?';
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT subject, body_html, body_text FROM email_templates
      WHERE ${where}
      ORDER BY tenant_id IS NULL ASC
      LIMIT 1`,
    params
  );
  const row = rows[0];
  if (!row) return null;
  return {
    subject: interpolate(String(row.subject ?? templateKey), vars),
    bodyHtml: interpolate(String(row.body_html ?? ''), vars),
    bodyText: interpolate(String(row.body_text ?? ''), vars),
  };
}

export interface SendEmailInput {
  to: string;
  templateKey: string;
  vars: Record<string, unknown>;
  tenantId?: number | null;
}

export type SendEmailResult =
  | { status: 'SENT'; messageId: string }
  | { status: 'DEV_UNCONFIGURED' | 'NO_TEMPLATE' };

/** Envía un correo transaccional por SMTP o lo simula en modo desarrollo. */
export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const template = await renderTemplate(input.templateKey, input.vars, input.tenantId);
  if (!template) return { status: 'NO_TEMPLATE' };

  const tr = getTransporter();
  if (!tr) {
    // FASE 9: no imprimir el cuerpo completo (evita PII/tokens de reseteo en logs).
    console.log(`[email:dev] Para: ${input.to} | Asunto: ${template.subject}`);
    return { status: 'DEV_UNCONFIGURED' };
  }

  const info = await tr.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: template.subject,
    text: template.bodyText,
    html: template.bodyHtml,
  });
  return { status: 'SENT', messageId: String(info.messageId) };
}

/** Envío directo (sin plantilla) cuando hace falta total control. */
export async function sendPlainEmail(input: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<SendEmailResult> {
  const tr = getTransporter();
  if (!tr) {
    // FASE 9: sin cuerpo en logs (PII).
    console.log(`[email:dev] Para: ${input.to} | Asunto: ${input.subject}`);
    return { status: 'DEV_UNCONFIGURED' };
  }
  const info = await tr.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { status: 'SENT', messageId: String(info.messageId) };
}

/** ¿Está SMTP configurado y disponible? */
export function smtpConfigured(): boolean {
  return getTransporter() !== null;
}