import { describe, expect, it } from 'vitest';
import {
  computeRiskProfile,
  generateAiMessage,
  pickReminderType,
  overdueRuleText,
  type AiClientProfile,
  type AiMessageContext,
} from '../services/aiMessagingService.ts';

function baseProfile(overrides: Partial<AiClientProfile> = {}): AiClientProfile {
  return {
    fullName: 'Juan Pérez',
    phone: '8095551234',
    deviceModel: 'Xiaomi Redmi 13',
    mdmStatus: 'UNLOCKED',
    monthlyInstallment: 3000,
    overdueCount: 0,
    dueCount: 0,
    maxDaysOverdue: 0,
    totalPenalty: 0,
    totalDebt: 0,
    paidAmount: 4000,
    lastPaymentDaysAgo: 5,
    ...overrides,
  };
}

function dopCtx(overrides: Partial<AiMessageContext> = {}): AiMessageContext {
  return {
    currency: {
      code: 'DOP',
      name: 'Peso Dominicano',
      symbol: 'RD$',
      decimals: 2,
      thousand_separator: ',',
      decimal_separator: '.',
    },
    overdue: {
      type: 'FIXED',
      fixed_amount: 500,
      percentage_base: 'BALANCE',
      percentage_rate: 0,
      grace_days: 3,
      frequency: 'MONTHLY',
      max_amount: null,
      cap_percent: null,
    },
    ...overrides,
  };
}

describe('computeRiskProfile (scoring IA 0-100)', () => {
  it('cliente al día con pagos recientes -> BAJO', () => {
    const r = computeRiskProfile(baseProfile());
    expect(r.level).toBe('BAJO');
    expect(r.score).toBeLessThan(35);
  });

  it('dos cuotas vencidas (0-2 días) suben el score aunque sigan BAJO', () => {
    const r = computeRiskProfile(baseProfile({ dueCount: 2, paidAmount: 0, lastPaymentDaysAgo: null }));
    expect(r.level).toBe('BAJO');
    expect(r.score).toBeGreaterThanOrEqual(20);
    const alDia = computeRiskProfile(baseProfile());
    expect(r.score).toBeGreaterThan(alDia.score);
  });

  it('cuota atrasada + bloqueo -> ALTO', () => {
    const r = computeRiskProfile(
      baseProfile({ overdueCount: 1, maxDaysOverdue: 12, mdmStatus: 'LOCKED', paidAmount: 0, lastPaymentDaysAgo: null })
    );
    expect(r.level).toBe('ALTO');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('historial de pagos reduce el riesgo', () => {
    const a = computeRiskProfile(baseProfile({ overdueCount: 1, maxDaysOverdue: 6, paidAmount: 0, lastPaymentDaysAgo: null }));
    const b = computeRiskProfile(
      baseProfile({ overdueCount: 1, maxDaysOverdue: 6, paidAmount: 30000 })
    );
    expect(b.score).toBeLessThan(a.score);
  });

  it('score acotado en [0, 100] y techo en el peor caso', () => {
    const worst = computeRiskProfile(
      baseProfile({
        overdueCount: 5,
        dueCount: 2,
        maxDaysOverdue: 60,
        mdmStatus: 'LOCKED',
        paidAmount: 0,
        lastPaymentDaysAgo: null,
      })
    );
    expect(worst.score).toBe(95);
    expect(worst.level).toBe('ALTO');
    expect(worst.score).toBeLessThanOrEqual(100);
  });
});

describe('pickReminderType', () => {
  it('cuota atrasada -> ALERTA_BLOQUEO', () => {
    expect(pickReminderType(baseProfile({ overdueCount: 1 }))).toBe('ALERTA_BLOQUEO');
  });

  it('solo vencida -> RECORDATORIO', () => {
    expect(pickReminderType(baseProfile({ dueCount: 1 }))).toBe('RECORDATORIO');
  });
});

describe('generateAiMessage (config dinámica por tenant)', () => {
  it('ALERTA_BLOQUEO formatea con la moneda DOP configurada', () => {
    const msg = generateAiMessage(
      'ALERTA_BLOQUEO',
      baseProfile({ overdueCount: 1, totalDebt: 3200, totalPenalty: 200 }),
      dopCtx()
    );
    expect(msg).toContain('ATRASADO');
    expect(msg).toContain('RD$3,200.00');
    expect(msg).toContain('RD$200.00');
  });

  it('ALERTA_BLOQUEO muestra una DIVISA distinta (USD) según config del tenant', () => {
    const usd = baseProfile({ overdueCount: 1, totalDebt: 3200, totalPenalty: 0 });
    const msg = generateAiMessage('ALERTA_BLOQUEO', usd, {
      ...dopCtx(),
      currency: {
        code: 'USD',
        name: 'Dólar Estadounidense',
        symbol: 'US$',
        decimals: 2,
        thousand_separator: ',',
        decimal_separator: '.',
      },
    });
expect(msg).not.toContain('RD$');
    expect(msg).toContain('US$3,200.00');
  });

  it('RECORDATORIO usa la mora de overdueConfig (no 200 hardcodeado)', () => {
    const msg = generateAiMessage(
      'RECORDATORIO',
      baseProfile({ monthlyInstallment: 1500 }),
      dopCtx({ overdue: { ...dopCtx().overdue, fixed_amount: 350 } })
    );
    expect(msg).toContain('Juan Pérez');
    expect(msg).toContain('1,500');
    expect(msg).toContain('RD$350');
    expect(msg).not.toContain('RD$200');
    expect(msg).toContain('bloqueo');
  });

  it('RECORDATORIO con mora PORCENTUAL describe la regla', () => {
    const msg = generateAiMessage(
      'RECORDATORIO',
      baseProfile({ monthlyInstallment: 1500 }),
      dopCtx({
        overdue: {
          ...dopCtx().overdue,
          type: 'PERCENTAGE',
          percentage_base: 'BALANCE',
          percentage_rate: 5,
          fixed_amount: 0,
        },
      })
    );
    expect(msg).toContain('5% de mora sobre el saldo');
    expect(msg).not.toContain('RD$200');
  });

  it('CONFIRMACION_PAGO confirma desbloqueo', () => {
    const msg = generateAiMessage('CONFIRMACION_PAGO', baseProfile(), dopCtx());
    expect(msg).toContain('DESBLOQUEADO');
  });
});

describe('overdueRuleText (mora dinámica FASE 5)', () => {
  it('FIXED → monto formateado con la moneda del tenant', () => {
    const cfg = { ...dopCtx().overdue, fixed_amount: 500 };
    expect(overdueRuleText(cfg, dopCtx().currency)).toBe('una mora fija de RD$500.00');
  });

  it('PERCENTAGE → regla porcentual sin símbolo fijo', () => {
    const cfg = {
      ...dopCtx().overdue,
      type: 'PERCENTAGE' as const,
      percentage_base: 'CAPITAL' as const,
      percentage_rate: 2.5,
    };
    expect(overdueRuleText(cfg, dopCtx().currency)).toBe('2.5% de mora sobre el capital');
  });
});