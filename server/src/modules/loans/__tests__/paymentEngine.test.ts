import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  normalizeConfig,
  DEFAULT_PAYMENT_CONFIG,
  type InstallmentItem,
  type PaymentConfig,
} from '../paymentEngine.js';

const CONFIG: PaymentConfig = DEFAULT_PAYMENT_CONFIG;

function inst(partial: Partial<InstallmentItem>): InstallmentItem {
  return {
    installmentId: 1,
    creditId: 10,
    installmentNumber: 1,
    dueDate: '2026-01-10',
    total: 1000,
    paid: 0,
    penaltyAmount: 0,
    status: 'PENDIENTE',
    ...partial,
  };
}

describe('normalizeConfig', () => {
  it('usa defaults cuando no hay config', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_PAYMENT_CONFIG);
    expect(normalizeConfig({})).toEqual(DEFAULT_PAYMENT_CONFIG);
  });

  it('respeta configuracion parcial', () => {
    const cfg = normalizeConfig({ overpayment_mode: 'CREDIT_BALANCE', rounding: 0 });
    expect(cfg.overpayment_mode).toBe('CREDIT_BALANCE');
    expect(cfg.rounding).toBe(0);
    expect(cfg.application_order).toEqual(DEFAULT_PAYMENT_CONFIG.application_order);
  });
});

describe('allocatePayment', () => {
  it('devuelve plan vacio para monto <= 0', () => {
    const plan = allocatePayment({ installments: [inst({})], amount: 0, config: CONFIG });
    expect(plan.totalAllocated).toBe(0);
    expect(plan.allocations).toEqual([]);
    expect(plan.remainder).toBe(0);
  });

  it('cubre la primera cuota y fluye el excedente a la siguiente', () => {
    const plan = allocatePayment({
      installments: [
        inst({ installmentId: 1, installmentNumber: 1, dueDate: '2026-01-10', total: 500 }),
        inst({ installmentId: 2, installmentNumber: 2, dueDate: '2026-02-10', total: 500 }),
      ],
      amount: 700,
      config: CONFIG,
    });

    expect(plan.totalAllocated).toBe(700);
    expect(plan.remainder).toBe(0);
    expect(plan.allocations).toHaveLength(2);
    expect(plan.allocations[0]).toMatchObject({ installmentId: 1, allocated: 500, becamePaid: true, remainingAfter: 0 });
    expect(plan.allocations[1]).toMatchObject({ installmentId: 2, allocated: 200, becamePaid: false, remainingAfter: 300 });
    expect(plan.coveredInstallmentIds).toEqual([1, 2]);
  });

  it('aplica primero la mora (penalty) si application_order la prioriza', () => {
    const config = normalizeConfig({ application_order: ['penalty', 'principal', 'future'] });
    const plan = allocatePayment({
      installments: [inst({ total: 1000, paid: 0, penaltyAmount: 200 })],
      amount: 300,
      config,
    });

    expect(plan.allocations).toHaveLength(2);
    expect(plan.allocations[0]).toMatchObject({ bucket: 'penalty', allocated: 200 });
    expect(plan.allocations[1]).toMatchObject({ bucket: 'principal', allocated: 100 });
    expect(plan.totalAllocated).toBe(300);
  });

  it('no reparte sobre cuotas ya pagadas ni canceladas', () => {
    const plan = allocatePayment({
      installments: [
        inst({ installmentId: 1, total: 1000, paid: 1000, status: 'PAGADO' }),
        inst({ installmentId: 2, total: 1000, status: 'CANCELADO' }),
        inst({ installmentId: 3, total: 1000 }),
      ],
      amount: 500,
      config: CONFIG,
    });

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].installmentId).toBe(3);
    expect(plan.remainder).toBe(0);
  });

  it('excedente mayor al total pendiente queda como remainder (saldo a favor)', () => {
    const plan = allocatePayment({
      installments: [inst({ total: 1000 })],
      amount: 1500,
      config: CONFIG,
    });

    expect(plan.totalAllocated).toBe(1000);
    expect(plan.remainder).toBe(500);
    expect(plan.allocations[0]).toMatchObject({ becamePaid: true });
  });
});
