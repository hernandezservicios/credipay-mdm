import { describe, expect, it } from 'vitest';
import {
  computeRiskProfile,
  generateAiMessage,
  pickReminderType,
  type AiClientProfile,
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

describe('generateAiMessage', () => {
  it('ALERTA_BLOQUEO contiene estado y total a pagar', () => {
    const msg = generateAiMessage(
      'ALERTA_BLOQUEO',
      baseProfile({ overdueCount: 1, totalDebt: 3200, totalPenalty: 200 })
    );
    expect(msg).toContain('ATRASADO');
    expect(msg).toContain('3,200');
    expect(msg).toContain('200');
  });

  it('CONFIRMACION_PAGO confirma desbloqueo', () => {
    const msg = generateAiMessage('CONFIRMACION_PAGO', baseProfile());
    expect(msg).toContain('DESBLOQUEADO');
  });

  it('RECORDATORIO menciona la regla de bloqueo', () => {
    const msg = generateAiMessage('RECORDATORIO', baseProfile({ monthlyInstallment: 1500 }));
    expect(msg).toContain('Juan Pérez');
    expect(msg).toContain('1,500');
    expect(msg).toContain('bloqueo');
  });
});