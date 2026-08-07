// ============================================================================
// CrediPay MDM - Fase 6 / Plan Maestro v2.9 FASE 5
// aiMessagingService.ts
// Módulo "IA de cobranza": scoring de riesgo por cliente y generación
// determinista de mensajes de WhatsApp personalizados por tono. La lógica es
// transparente y auditable (reglas + plantillas), preparada para migrar a un
// proveedor GenAI (LLM) sin cambiar el contrato de salida.
//
// FASE 5 (Plan Maestro v2.9): los mensajes se generan con la configuración
// dinámica del tenant (moneda + mora) obtenida vía getPlatformConfig(); NO hay
// símbolos de moneda ni montos hardcodeados (RD$/USD/200).
// ============================================================================

import type { CurrencyConfig } from './configService.js';
import type { OverdueConfig } from './loanEngine.js';
import { formatMoney } from '../utils/money.js';

export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO';
export type ReminderType = 'RECORDATORIO' | 'ALERTA_BLOQUEO' | 'CONFIRMACION_PAGO';

export interface AiClientProfile {
  fullName: string;
  phone: string;
  deviceModel: string | null;
  mdmStatus: string;
  monthlyInstallment: number;
  overdueCount: number; // cuotas ATRASADO
  dueCount: number; // cuotas VENCIDO
  maxDaysOverdue: number;
  totalPenalty: number;
  totalDebt: number; // total a pagar considerando mora
  paidAmount: number; // histórico pagado
  lastPaymentDaysAgo: number | null;
}

export interface AiMessageContext {
  currency: CurrencyConfig;
  overdue: OverdueConfig;
}

export interface RiskResult {
  score: number; // 0..100
  level: RiskLevel;
}

/** Score de riesgo 0-100 basado en mora, bloqueo e historial de pagos. */
export function computeRiskProfile(p: AiClientProfile): RiskResult {
  let score = 0;
  if (p.dueCount > 0) score += 20;
  if (p.overdueCount > 0) score += 35;
  if (p.maxDaysOverdue > 0) score += Math.min(30, p.maxDaysOverdue * 4);
  if (p.mdmStatus === 'LOCKED') score += 10;
  if (p.paidAmount > 0) score -= Math.min(20, Math.floor(p.paidAmount / p.monthlyInstallment) * 3);
  if (p.lastPaymentDaysAgo !== null && p.lastPaymentDaysAgo <= 10) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const level: RiskLevel = score >= 70 ? 'ALTO' : score >= 35 ? 'MEDIO' : 'BAJO';
  return { score, level };
}

/**
 * Genera el mensaje de WhatsApp personalizado según el tipo de comunicación.
 * Regla inteligente: si el cliente tiene cuotas atrasadas o el equipo está
 * bloqueado, se emite ALERTA_BLOQUEO; de lo contrario RECORDATORIO.
 * CONFIRMACION_PAGO se usa tras registrar un pago (desbloqueo).
 */
export function pickReminderType(p: AiClientProfile): ReminderType {
  if (p.overdueCount > 0) return 'ALERTA_BLOQUEO';
  return 'RECORDATORIO';
}

// Mora a mostrar: suma real del backend; si aún es 0 y el plan es mora FIJA,
// muestra el monto configurado en overdueConfig (nunca un valor hardcodeado).
function moraShowAmount(p: AiClientProfile, ctx: AiMessageContext): number {
  if (p.totalPenalty > 0) return p.totalPenalty;
  if (ctx.overdue.type === 'FIXED') return ctx.overdue.fixed_amount;
  return 0;
}

/** Texto de la regla de mora en lenguaje natural (FIXED/PERCENTAGE). */
export function overdueRuleText(cfg: OverdueConfig, currency: CurrencyConfig): string {
  if (cfg.type === 'PERCENTAGE') {
    const base = cfg.percentage_base === 'CAPITAL' ? 'el capital' : cfg.percentage_base === 'INSTALLMENT' ? 'la cuota' : 'el saldo';
    return `${cfg.percentage_rate}% de mora sobre ${base}`;
  }
  return `una mora fija de ${formatMoney(cfg.fixed_amount, currency)}`;
}

export function generateAiMessage(type: ReminderType, p: AiClientProfile, ctx: AiMessageContext): string {
  const device = p.deviceModel || 'celular';
  const installment = formatMoney(p.monthlyInstallment, ctx.currency);
  const mora = formatMoney(moraShowAmount(p, ctx), ctx.currency);
  const total = formatMoney(p.totalDebt || p.monthlyInstallment, ctx.currency);
  const graceDays = Math.max(0, ctx.overdue.grace_days);

  if (type === 'ALERTA_BLOQUEO') {
    return [
      '🔴 AVISO DE SISTEMA CREDIPAY MDM - CRÉDITO DE CELULAR',
      '',
      `Estimado(a) *${p.fullName}*,`,
      `Le informamos que su cuota mensual de *${device}* ha superado los ${graceDays} día(s) ` +
        'de gracia y ha cambiado a estado *ATRASADO*.',
      '',
      `🔒 *Estado del Equipo:* ${p.mdmStatus === 'LOCKED' ? 'BLOQUEADO (MDM)' : 'EN EVALUACIÓN'}`,
      `💵 *Monto de Cuota:* ${installment}`,
      `⚠️ *Mora aplicada:* ${mora}`,
      `👉 *Total para Desbloquear:* ${total}`,
      '',
      'Tan pronto realice su pago por WhatsApp o en nuestras tiendas, el sistema ' +
        'ejecutará el *desbloqueo de pantalla automáticamente en segundos*. ¡Contáctenos!',
    ].join('\n');
  }

  if (type === 'CONFIRMACION_PAGO') {
    return [
      '🟢 CONFIRMACIÓN DE PAGO & DESBLOQUEO CREDIPAY',
      '',
      `¡Hola *${p.fullName}*! Hemos recibido exitosamente su pago de crédito para el *${device}*.`,
      '',
      '🔓 *Estado del Celular:* OPERATIVO / DESBLOQUEADO',
      '✅ Gracias por mantener su crédito al día. Su próxima cuota vence según el calendario.',
    ].join('\n');
  }

  // RECORDATORIO / amigable
  return [
    `Hola *${p.fullName}*, le saludamos de su financiamiento de celular *${device}* 📱 con CrediPay.`,
    '',
    `Le recordamos que su cuota mensual de *${installment}* está en fecha de vencimiento. `,
    `Recuerde que el sistema aplica un bloqueo de pantalla automático y ${overdueRuleText(ctx.overdue, ctx.currency)} ` +
      `tras cumplir ${graceDays} día(s) de vencido.`,
    '',
    'Para pagar o reportar su depósito, escríbanos por aquí. ¡Que tenga un excelente día! ✨',
  ].join('\n');
}