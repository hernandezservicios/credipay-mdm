import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  daysBetween,
  loanQuote,
  overduePenalty,
  round2,
} from '../services/loanEngine.ts';
import { defaultPlatformConfig } from '../services/configService.ts';

describe('buildSchedule (motor financiero)', () => {
  it('FRENCH: cuota fija con interés sobre saldo', () => {
    const schedule = buildSchedule({
      principal: 10000,
      annualRatePercent: 12,
      installmentsCount: 12,
      method: 'FRENCH',
    });
    expect(schedule).toHaveLength(12);
    const payments = schedule.map((r) => r.amount);
    expect(payments[0]).toBeCloseTo(payments[11], 0);
    const total = round2(schedule.reduce((s, r) => s + r.amount, 0));
    expect(total).toBeGreaterThan(10000);
    expect(schedule[0].capitalBalanceBefore).toBe(10000);
    expect(schedule[11].capitalBalanceAfter).toBe(0);
    // Interés del primer mes = 10000 * 1% = 100
    expect(schedule[0].interestPart).toBeCloseTo(100, 0);
    // Capital se amortiza gradualmente
    expect(schedule[0].principalPart).toBeLessThan(schedule[11].principalPart);
  });

  it('FLAT: interés plano sobre el capital inicial', () => {
    const schedule = buildSchedule({
      principal: 12000,
      annualRatePercent: 24,
      installmentsCount: 12,
      method: 'FLAT',
    });
    const totalInterest = round2(schedule.reduce((s, r) => s + r.interestPart, 0));
    // 12000 * 24% * 1 año = 2880
    expect(totalInterest).toBe(2880);
    const total = round2(schedule.reduce((s, r) => s + r.amount, 0));
    expect(total).toBe(14880);
  });

  it('SIMPLE / SALDO_INSOLUTO: capital fijo con cuotas decrecientes', () => {
    const schedule = buildSchedule({
      principal: 12000,
      annualRatePercent: 12,
      installmentsCount: 12,
      method: 'SIMPLE',
    });
    expect(schedule[0].principalPart).toBe(1000);
    expect(schedule[11].principalPart).toBe(1000);
    expect(schedule[0].amount).toBeGreaterThan(schedule[11].amount);
    expect(schedule[11].capitalBalanceAfter).toBe(0);
  });

  it('COMPOUND: capitalización mensual compuesta', () => {
    const quote = loanQuote({
      principal: 10000,
      annualRatePercent: 12,
      installmentsCount: 12,
      method: 'COMPOUND',
    });
    const simple = loanQuote({
      principal: 10000,
      annualRatePercent: 12,
      installmentsCount: 12,
      method: 'SIMPLE',
    });
    // La capitalización compuesta genera más interés que la simple
    expect(quote.totalInterest).toBeGreaterThan(simple.totalInterest);
    expect(quote.schedule).toHaveLength(12);
  });

  it('CUOTA_NIVELADA equivale a FRENCH', () => {
    const a = loanQuote({ principal: 5000, annualRatePercent: 18, installmentsCount: 24, method: 'FRENCH' });
    const b = loanQuote({ principal: 5000, annualRatePercent: 18, installmentsCount: 24, method: 'CUOTA_NIVELADA' });
    expect(a.monthlyPayment).toBe(b.monthlyPayment);
    expect(a.totalInterest).toBe(b.totalInterest);
  });

  it('tasa 0: cuotas puras sin interés', () => {
    const quote = loanQuote({ principal: 36000, annualRatePercent: 0, installmentsCount: 12, method: 'FRENCH' });
    expect(quote.monthlyPayment).toBe(3000);
    expect(quote.totalInterest).toBe(0);
    expect(quote.totalPayment).toBe(36000);
  });

  it('valida entradas inválidas', () => {
    expect(() =>
      buildSchedule({ principal: 1000, annualRatePercent: 10, installmentsCount: 0, method: 'FRENCH' })
    ).toThrow('invalid_count');
    expect(() =>
      buildSchedule({ principal: 0, annualRatePercent: 10, installmentsCount: 12, method: 'FRENCH' })
    ).toThrow('invalid_principal');
    expect(() =>
      buildSchedule({ principal: 1000, annualRatePercent: -5, installmentsCount: 12, method: 'FRENCH' })
    ).toThrow('invalid_rate');
  });
});

describe('overduePenalty (mora configurable)', () => {
  const base = {
    config: {
      type: 'FIXED' as const,
      fixed_amount: 200,
      percentage_base: 'BALANCE' as const,
      percentage_rate: 0,
      grace_days: 3,
      frequency: 'MONTHLY' as const,
      max_amount: null,
      cap_percent: null,
    },
    installmentAmount: 1000,
    capitalBalanceBefore: 5000,
  };

  it('no penaliza dentro del período de gracia', () => {
    const r = overduePenalty({ ...base, dueDate: '2026-08-01', lastCalc: null, today: '2026-08-02' });
    expect(r.penalty).toBe(0);
    expect(r.daysLate).toBe(1);
  });

  it('penaliza monto fijo por período una vez superada la gracia', () => {
    const r = overduePenalty({ ...base, dueDate: '2026-07-01', lastCalc: null, today: '2026-08-05' });
    expect(r.daysLate).toBe(35);
    expect(r.penalty).toBeGreaterThanOrEqual(200);
  });

  it('porcentaje sobre el saldo (BALANCE) calcula sobre capital + cuota', () => {
    const r = overduePenalty({
      config: {
        ...base.config,
        type: 'PERCENTAGE',
        percentage_rate: 2,
        grace_days: 0,
        frequency: 'ONE_TIME',
      },
      installmentAmount: 1000,
      capitalBalanceBefore: 4000,
      dueDate: '2026-07-01',
      lastCalc: null,
      today: '2026-07-10',
    });
    // 2% sobre (4000 + 1000) = 100
    expect(r.penalty).toBe(100);
  });

  it('aplica tope máximo configurado', () => {
    const r = overduePenalty({
      ...base,
      config: { ...base.config, fixed_amount: 500, max_amount: 250 },
      dueDate: '2026-01-01',
      lastCalc: null,
      today: '2026-08-05',
    });
    expect(r.penalty).toBeLessThanOrEqual(250);
  });

  it('no aplica penalizaciones acumuladas anteriores (lastCalc reciente)', () => {
    const r = overduePenalty({
      ...base,
      dueDate: '2026-07-01',
      lastCalc: '2026-08-04',
      today: '2026-08-05',
    });
    // Solo se acumula el período desde el último cálculo (1 día → 1 período)
    expect(r.periods).toBe(1);
  });
});

describe('daysBetween', () => {
  it('calcula días entre fechas', () => {
    expect(daysBetween('2026-08-01', '2026-08-05')).toBe(4);
    expect(daysBetween('2026-08-05', '2026-08-01')).toBe(0);
  });
});

describe('defaultPlatformConfig', () => {
  it('incluye todas las secciones requeridas', () => {
    const cfg = defaultPlatformConfig();
    expect(cfg.companyInfo.currency).toBe('DOP');
    expect(cfg.loanConfig.default_method).toBe('FRENCH');
    expect(cfg.overdueConfig.grace_days).toBe(3);
    expect(Array.isArray(cfg.integrations)).toBe(true);
  });

  it('hereda moneda y zona horaria del tenant', () => {
    const cfg = defaultPlatformConfig({ currency_code: 'USD', timezone: 'America/New_York' });
    expect(cfg.companyInfo.currency).toBe('USD');
    expect(cfg.companyInfo.timezone).toBe('America/New_York');
  });
});
