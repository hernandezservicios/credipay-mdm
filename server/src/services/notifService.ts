// ============================================================================
// CrediPay MDM - Fase 8
// notifService.ts
// Despacho de notificaciones multi-canal: IN_APP (tabla notifications),
// EMAIL (emailService / SMTP) y WHATSAPP (simulado o provider futuro).
// Resuelve el canal habilitado y la plantilla adecuada según reminder_type.
// ============================================================================

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db/pool.js';
import { sendTransactionalEmail } from './emailService.js';
import { getTenant } from './tenantService.js';

export type NotifChannel = 'EMAIL' | 'IN_APP' | 'WHATSAPP';

export interface DispatchReminderInput {
  tenantId: number;
  reminderType: string;
  channel: string;
  fullName: string;
  message: string;
  phone?: string;
  email?: string;
  clientId?: number;
}

async function tenantName(tenantId: number): Promise<string> {
  try {
    const t = await getTenant(tenantId);
    return t?.name ?? 'CrediPay';
  } catch {
    return 'CrediPay';
  }
}

function reminderTemplateKey(type: string): string {
  if (type === 'ALERTA_BLOQUEO' || type === 'ALERTA') return 'collection.lock_alert';
  if (type === 'CONFIRMACION_PAGO') return 'collection.payment_confirm';
  return 'collection.reminder';
}

function channelEnabled(channel: string, config: { whatsapp?: boolean; sms?: boolean; email?: boolean }): boolean {
  if (channel === 'EMAIL') return config.email !== false;
  if (channel === 'WHATSAPP') return config.whatsapp === true;
  return true;
}

function logDevSend(channel: string, vars: Record<string, unknown>): void {
  if (channel === 'WHATSAPP') {
    console.log(`[notif:dev][WHATSAPP] -> ${vars.client || ''} | ${vars.message || ''}`);
  }
}

/**
 * Despacha un recordatorio ya marcado como SENT a sus canales externos.
 * Se ejecuta en fire-and-forget desde collectionService (no bloquea la tx).
 */
export async function dispatchReminderChannels(
  tenantId: number,
  reminder: {
    reminder_type: string;
    channel: string;
    full_name: string;
    message: string;
    phone?: string | null;
    email?: string | null;
  }
): Promise<void> {
  try {
    const empresa = await tenantName(tenantId);
    const vars = {
      cliente: reminder.full_name,
      mensaje: reminder.message,
      empresa,
      client: reminder.full_name,
      message: reminder.message,
      phone: reminder.phone ?? '',
    };
    const channel = reminder.channel?.toUpperCase() as NotifChannel;
    if (channel === 'EMAIL') {
      await sendTransactionalEmail({
        to: reminder.email ?? '',
        templateKey: reminderTemplateKey(reminder.reminder_type),
        vars,
        tenantId,
      }).catch((err) => console.error('[notif] email recordatorio fallo:', err));
    } else if (channel === 'WHATSAPP') {
      logDevSend(channel, vars);
    }
  } catch (err) {
    console.error('[notif] dispatchReminderChannels error:', err);
  }
}

export interface NotifyPaymentInput {
  tenantId: number;
  clientName: string;
  clientEmail?: string | null;
  amount: number;
  reference: string;
  method: string;
}

/** Notificación IN_APP + email de recibo vinculado a un pago. */
export async function notifyPayment(input: NotifyPaymentInput): Promise<void> {
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, data)
       VALUES (?, NULL, 'PAGO', ?, ?, JSON_OBJECT('client', ?))`,
      [
        input.tenantId,
        `✅ Pago registrado · ${input.clientName}`,
        `Se registró un pago de RD\$${input.amount.toLocaleString()} (${input.method}).`,
        input.clientName,
      ]
    );
    if (input.clientEmail) {
      const empresa = await tenantName(input.tenantId);
      await sendTransactionalEmail({
        to: input.clientEmail,
        templateKey: 'email.payment_receipt',
        vars: {
          cliente: input.clientName,
          monto: `RD$${input.amount.toLocaleString()}`,
          referencia: input.reference,
          fecha: new Date().toISOString().slice(0, 10),
          metodo: input.method,
          empresa,
        },
        tenantId: input.tenantId,
      }).catch((err) => console.error('[notif] email recibo fallo:', err));
    }
  } catch (err) {
    console.error('[notif] notifyPayment error:', err);
  }
}

/** Crea una notificación IN_APP genérica (fire-and-forget). */
export async function notifyInApp(
  tenantId: number,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, data)
       VALUES (?, NULL, ?, ?, ?, ?)`,
      [tenantId, type, title, body, JSON.stringify(data ?? {})]
    );
  } catch (err) {
    console.error('[notif] notifyInApp error:', err);
  }
}