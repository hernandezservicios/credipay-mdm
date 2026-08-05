// ============================================================
// CrediPay MDM - Motor financiero de préstamos (puro)
// Métodos de amortización configurables por tenant y cálculo
// de mora. Sin dependencias de BD para facilitar pruebas.
// ============================================================

export type AmortizationMethod =
  | 'FRENCH'
  | 'CUOTA_NIVELADA'
  | 'FLAT'
  | 'SIMPLE'
  | 'SALDO_INSOLUTO'
  | 'COMPOUND';

export const AMORTIZATION_METHODS: AmortizationMethod[] = [
  'FRENCH',
  'CUOTA_NIVELADA',
  'FLAT',
  'SIMPLE',
  'SALDO_INSOLUTO',
  'COMPOUND',
];

export const AMORTIZATION_LABELS: Record<AmortizationMethod, string> = {
  FRENCH: 'Francés (cuota fija)',
  CUOTA_NIVELADA: 'Cuota nivelada',
  FLAT: 'Tasa plana (interés fijo)',
  SIMPLE: 'Interés simple sobre saldo',
  SALDO_INSOLUTO: 'Saldo insoluto',
  COMPOUND: 'Interés compuesto',
};

export interface ScheduleRow {
  number: number;
  dueDate: string;
  amount: number;
  principalPart: number;
  interestPart: number;
  capitalBalanceBefore: number;
  capitalBalanceAfter: number;
}

export interface ScheduleInput {
  principal: number;
  annualRatePercent: number;
  installmentsCount: number;
  method: AmortizationMethod;
  startDate?: string;
}

export const round2 = (v: number): number => Math.round(v * 100) / 100;

function monthlyRate(annualRatePercent: number, method: AmortizationMethod): number {
  const annual = annualRatePercent / 100;
  if (method === 'COMPOUND') return Math.pow(1 + annual, 1 / 12) - 1;
  return annual / 12;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Cronograma de amortización
// ---------------------------------------------------------------------------

export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const { installmentsCount: n, method } = input;
  if (!(n > 0) || n > 120) throw new Error('invalid_count');
  if (!(input.principal > 0)) throw new Error('invalid_principal');
  if (input.annualRatePercent < 0) throw new Error('invalid_rate');

  const P = round2(input.principal);
  const r = monthlyRate(input.annualRatePercent, method);
  const rows: ScheduleRow[] = [];

  let balance = P;
  let fixedPayment = 0;
  let fixedInterestPart = 0;
  let flatInterestTotal = 0;

  if (method === 'FRENCH' || method === 'CUOTA_NIVELADA') {
    if (r === 0) {
      fixedPayment = round2(P / n);
    } else {
      fixedPayment = round2((P * r) / (1 - Math.pow(1 + r, -n)));
    }
  } else if (method === 'FLAT') {
    flatInterestTotal = round2(P * (input.annualRatePercent / 100) * (n / 12));
    fixedPayment = round2((P + flatInterestTotal) / n);
    fixedInterestPart = round2(flatInterestTotal / n);
  } else if (method === 'SIMPLE' || method === 'SALDO_INSOLUTO') {
    // Amortización de capital fija + interés sobre saldo (cuotas decrecientes)
  }

  for (let i = 1; i <= n; i++) {
    const balanceBefore = balance;
    let interestPart: number;
    let principalPart: number;
    let amount: number;

    if (method === 'FLAT') {
      interestPart = i === n ? round2(flatInterestTotal - fixedInterestPart * (n - 1)) : fixedInterestPart;
      principalPart = i === n ? balance : round2(P / n);
      amount = round2(principalPart + interestPart);
    } else if (method === 'SIMPLE' || method === 'SALDO_INSOLUTO') {
      interestPart = round2(balance * r);
      principalPart = i === n ? balance : round2(P / n);
      amount = round2(principalPart + interestPart);
    } else {
      // FRENCH / CUOTA_NIVELADA / COMPOUND
      if (i === n) {
        interestPart = round2(balance * r);
        amount = round2(balance + interestPart);
        principalPart = balance;
      } else {
        interestPart = round2(balance * r);
        amount = fixedPayment;
        principalPart = round2(amount - interestPart);
      }
    }

    balance = round2(balance - principalPart);
    rows.push({
      number: i,
      dueDate: addMonths(input.startDate || new Date().toISOString().slice(0, 10), i - 1),
      amount,
      principalPart,
      interestPart,
      capitalBalanceBefore: balanceBefore,
      capitalBalanceAfter: Math.max(0, balance),
    });
  }
  return rows;
}

export interface LoanSummary {
  principal: number;
  annualRatePercent: number;
  method: AmortizationMethod;
  installmentsCount: number;
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  schedule: ScheduleRow[];
}

export function loanQuote(input: ScheduleInput & { startDate?: string }): LoanSummary {
  const schedule = buildSchedule(input as ScheduleInput);
  const totalPayment = round2(schedule.reduce((s, r) => s + r.amount, 0));
  const totalInterest = round2(schedule.reduce((s, r) => s + r.interestPart, 0));
  return {
    principal: round2(input.principal),
    annualRatePercent: input.annualRatePercent,
    method: input.method,
    installmentsCount: input.installmentsCount,
    monthlyPayment: schedule[0]?.amount ?? 0,
    totalPayment,
    totalInterest,
    schedule,
  };
}

// ---------------------------------------------------------------------------
// Mora configurable
// ---------------------------------------------------------------------------

export type OverdueType = 'FIXED' | 'PERCENTAGE';
export type OverdueFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONE_TIME';
export type PercentageBase = 'CAPITAL' | 'INSTALLMENT' | 'BALANCE';

export interface OverdueConfig {
  type: OverdueType;
  fixed_amount: number;
  percentage_base: PercentageBase;
  percentage_rate: number;
  grace_days: number;
  frequency: OverdueFrequency;
  max_amount: number | null;
  cap_percent: number | null;
}

export const DEFAULT_OVERDUE_CONFIG: OverdueConfig = {
  type: 'FIXED',
  fixed_amount: 0,
  percentage_base: 'BALANCE',
  percentage_rate: 0,
  grace_days: 3,
  frequency: 'MONTHLY',
  max_amount: null,
  cap_percent: null,
};

export interface PenaltyInput {
  config: OverdueConfig;
  installmentAmount: number;
  capitalBalanceBefore: number;
  dueDate: string;
  lastCalc: string | null;
  today: string;
}

export interface PenaltyResult {
  penalty: number;
  daysLate: number;
  periods: number;
  amount: number;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}

export function overduePenalty(input: PenaltyInput): PenaltyResult {
  const c = input.config;
  const daysLate = daysBetween(input.dueDate, input.today);
  if (daysLate <= (c.grace_days ?? 0)) {
    return { penalty: 0, daysLate, periods: 0, amount: round2(input.installmentAmount) };
  }

  const overdueDays = daysLate - (c.grace_days ?? 0);
  const periodDays = c.frequency === 'DAILY' ? 1 : c.frequency === 'WEEKLY' ? 7 : 30;
  let periods = c.frequency === 'ONE_TIME' ? 1 : Math.max(1, Math.floor(overdueDays / periodDays));

  if (input.lastCalc && c.frequency !== 'ONE_TIME') {
    const sinceCalc = daysBetween(input.lastCalc, input.today);
    const extraPeriods = Math.floor(sinceCalc / periodDays);
    periods = Math.max(1, Math.min(periods, extraPeriods > 0 ? extraPeriods : 1));
  }

  let base: number;
  if (c.type === 'FIXED') {
    base = round2(c.fixed_amount || 0);
  } else {
    const ref =
      c.percentage_base === 'CAPITAL'
        ? round2(input.capitalBalanceBefore)
        : c.percentage_base === 'BALANCE'
          ? round2(input.capitalBalanceBefore + input.installmentAmount)
          : round2(input.installmentAmount);
    base = round2((ref * (c.percentage_rate || 0)) / 100);
  }

  let penalty = round2(base * periods);
  if (c.max_amount != null && penalty > c.max_amount) penalty = round2(c.max_amount);
  if (c.cap_percent != null && penalty > round2(input.installmentAmount * c.cap_percent)) {
    penalty = round2(input.installmentAmount * c.cap_percent);
  }
  return { penalty, daysLate, periods, amount: round2(round2(input.installmentAmount) + penalty) };
}

// ---------------------------------------------------------------------------
// Recalendarización (reestructuración / refinanciamiento)
// ---------------------------------------------------------------------------

export interface RestructureInput {
  remainingPrincipal: number;
  remainingInterest: number;
  pendingPenalty: number;
  annualRatePercent: number;
  method: AmortizationMethod;
  installmentsCount: number;
  startDate: string;
  additionalAmount: number;
}

export function restructureSchedule(input: RestructureInput): LoanSummary {
  const principal = round2(input.remainingPrincipal + input.remainingInterest + input.pendingPenalty + input.additionalAmount);
  return loanQuote({
    principal,
    annualRatePercent: input.annualRatePercent,
    method: input.method,
    installmentsCount: input.installmentsCount,
    startDate: input.startDate,
  });
}
