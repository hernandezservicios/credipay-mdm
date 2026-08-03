import { describe, expect, it } from 'vitest';
import { BILLING_CYCLE_LABEL, nextPeriodEnd } from '../services/planService.ts';

describe('nextPeriodEnd (avance de período según ciclo)', () => {
  const base = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00

  it('MONTHLY sum +1 mes', () => {
    expect(nextPeriodEnd('MONTHLY', base).getMonth()).toBe(base.getMonth() + 1);
  });

  it('QUARTERLY sum +3 meses', () => {
    expect(nextPeriodEnd('QUARTERLY', base).getMonth()).toBe(base.getMonth() + 3);
  });

  it('SEMI_ANNUAL +6 meses', () => {
    expect(nextPeriodEnd('SEMI_ANNUAL', base).getMonth()).toBe((base.getMonth() + 6) % 12);
  });

  it('ANNUAL mismo mes, año +1', () => {
    const next = nextPeriodEnd('ANNUAL', base);
    expect(next.getMonth()).toBe(base.getMonth());
    expect(next.getFullYear()).toBe(base.getFullYear() + 1);
  });

  it('ciclo anual respeta bisiesto (feb mar no se truncó)', () => {
    const feb = new Date(2024, 1, 29, 10, 0, 0);
    const next = nextPeriodEnd('ANNUAL', feb);
    expect(next.getFullYear()).toBe(2025);
  });
});

describe('BILLING_CYCLE_LABEL', () => {
  it('etiquetas traducidas para los 4 ciclos', () => {
    expect(BILLING_CYCLE_LABEL).toEqual({
      MONTHLY: 'Mensual',
      QUARTERLY: 'Trimestral',
      SEMI_ANNUAL: 'Semestral',
      ANNUAL: 'Anual',
    });
  });
});