/**
 * Motor de pagos puro (sin base de datos ni efectos).
 * Blueprint D22/D26: distribucion de un cobro en cascada sobre cuotas
 * pendientes, respetando application_order y overpayment_mode configurables
 * (tenant_settings.payment_config). Regla R16: toda validacion financiera
 * vive aqui (backend) y es unit-testable.
 */

export type PaymentBucket = 'penalty' | 'interest' | 'principal' | 'future' | 'credit_balance';

export interface PaymentConfig {
  application_order: PaymentBucket[];
  overpayment_mode: 'PREPAY' | 'CREDIT_BALANCE';
  rounding: number;
}

export interface InstallmentItem {
  installmentId: number;
  creditId: number;
  installmentNumber: number;
  dueDate: string | Date;
  total: number;
  paid: number;
  penaltyAmount: number;
  status: string;
}

export interface AllocatedLine {
  installmentId: number;
  installmentNumber: number;
  creditId: number;
  allocated: number;
  bucket: PaymentBucket;
  becamePaid: boolean;
  remainingAfter: number;
}

export interface PlanResult {
  totalAllocated: number;
  allocations: AllocatedLine[];
  remainder: number;
  coveredInstallmentIds: number[];
}

export interface SimulateInput {
  installments: InstallmentItem[];
  amount: number;
  config: PaymentConfig;
}

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  application_order: ['penalty', 'interest', 'principal', 'future', 'credit_balance'],
  overpayment_mode: 'PREPAY',
  rounding: 2,
};

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export function normalizeConfig(partial?: Partial<PaymentConfig> | null): PaymentConfig {
  const order =
    Array.isArray(partial?.application_order) && partial!.application_order!.length
      ? partial!.application_order!
      : DEFAULT_PAYMENT_CONFIG.application_order;
  const overpayment_mode =
    partial?.overpayment_mode === 'CREDIT_BALANCE' ? 'CREDIT_BALANCE' : 'PREPAY';
  const rounding =
    Number.isFinite(partial?.rounding) ? Math.max(0, Math.min(4, Number(partial?.rounding))) : 2;
  return { application_order: order, overpayment_mode, rounding };
}

function isPendingStatus(status: string): boolean {
  return status === 'PENDIENTE' || status === 'VENCIDO' || status === 'ATRASADO';
}

function dateKey(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

/**
 * Distribuye `amount` entre cuotas pendientes (cascada) respetando el orden
 * de aplicacion configurado. Funcion pura: no toca la base de datos.
 */
export function allocatePayment(input: SimulateInput): PlanResult {
  const config = normalizeConfig(input.config);
  const digits = config.rounding;
  const amount = round(Math.max(0, input.amount), digits);
  if (amount <= 0) {
    return { totalAllocated: 0, allocations: [], remainder: 0, coveredInstallmentIds: [] };
  }

  const firstBucket = config.application_order[0] ?? 'principal';

  const pending = [...input.installments]
    .filter((i) => isPendingStatus(i.status))
    .sort((a, b) => {
      const da = dateKey(a.dueDate);
      const db = dateKey(b.dueDate);
      return da !== db ? da.localeCompare(db) : a.installmentNumber - b.installmentNumber;
    });

  let remaining = amount;
  const allocations: AllocatedLine[] = [];
  const covered = new Set<number>();

  const push = (item: InstallmentItem, allocated: number, bucket: PaymentBucket): void => {
    const newPaid = round(item.paid + allocated, digits);
    allocations.push({
      installmentId: item.installmentId,
      installmentNumber: item.installmentNumber,
      creditId: item.creditId,
      allocated,
      bucket,
      becamePaid: newPaid >= item.total,
      remainingAfter: round(Math.max(0, item.total - newPaid), digits),
    });
    if (allocated > 0) covered.add(item.installmentId);
  };

  // 1) Penalizaciones de mora (si el tenant las prioriza)
  if (firstBucket === 'penalty') {
    for (const item of pending) {
      if (remaining <= 0) break;
      const penaltyDue = round(Math.max(0, item.penaltyAmount), digits);
      if (penaltyDue <= 0) continue;
      const applied = round(Math.min(penaltyDue, remaining), digits);
      if (applied <= 0) continue;
      remaining = round(remaining - applied, digits);
      push(item, applied, 'penalty');
    }
  }

  // 2) Saldo de cada cuota (principal + interes), cascada por fecha/numero
  for (const item of pending) {
    if (remaining <= 0) break;
    const outstanding = round(Math.max(0, item.total - item.paid), digits);
    if (outstanding <= 0) continue;
    const applied = round(Math.min(outstanding, remaining), digits);
    if (applied <= 0) continue;
    remaining = round(remaining - applied, digits);
    push(item, applied, 'principal');
  }

  return {
    totalAllocated: round(amount - remaining, digits),
    allocations,
    remainder: remaining,
    coveredInstallmentIds: Array.from(covered),
  };
}