/**
 * Config de mora del tenant (FASE 3 — Mora desde Backend).
 * Se resuelve a través de setOverdueConfig(GET /config → overdueConfig) tras el
 * login y NUNCA se escribe por código en los componentes (F9). Espejo del tipo
 * OverdueConfig del servidor (server/src/services/loanEngine.ts).
 *
 * Resolver MODULE-LEVEL (sin Context/Provider/Store/Signals) — mismo patrón que
 * el resolver de moneda (FASE 1, src/utils/formatters.ts).
 */

export interface OverdueRuntimeConfig {
  type: 'FIXED' | 'PERCENTAGE';
  fixed_amount: number;
  percentage_base: 'CAPITAL' | 'INSTALLMENT' | 'BALANCE';
  percentage_rate: number;
  grace_days: number;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONE_TIME';
  max_amount: number | null;
  cap_percent: number | null;
}

const DEFAULT_OVERDUE_CONFIG: OverdueRuntimeConfig = {
  type: 'FIXED',
  fixed_amount: 200,
  percentage_base: 'BALANCE',
  percentage_rate: 0,
  grace_days: 3,
  frequency: 'MONTHLY',
  max_amount: null,
  cap_percent: null,
};

let overdueConfig: OverdueRuntimeConfig = { ...DEFAULT_OVERDUE_CONFIG };

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Registra la config de mora devuelta por `GET /config` (sección overdueConfig). */
export function setOverdueConfig(cfg: Partial<OverdueRuntimeConfig> | null | undefined): void {
  if (!cfg) {
    overdueConfig = { ...DEFAULT_OVERDUE_CONFIG };
    return;
  }
  overdueConfig = {
    type: cfg.type === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED',
    fixed_amount: num(cfg.fixed_amount, DEFAULT_OVERDUE_CONFIG.fixed_amount),
    percentage_base:
      cfg.percentage_base === 'CAPITAL' || cfg.percentage_base === 'INSTALLMENT' || cfg.percentage_base === 'BALANCE'
        ? cfg.percentage_base
        : DEFAULT_OVERDUE_CONFIG.percentage_base,
    percentage_rate: num(cfg.percentage_rate),
    grace_days: num(cfg.grace_days, DEFAULT_OVERDUE_CONFIG.grace_days),
    frequency:
      cfg.frequency === 'DAILY' || cfg.frequency === 'WEEKLY' || cfg.frequency === 'MONTHLY' || cfg.frequency === 'ONE_TIME'
        ? cfg.frequency
        : DEFAULT_OVERDUE_CONFIG.frequency,
    max_amount: cfg.max_amount == null ? null : num(cfg.max_amount),
    cap_percent: cfg.cap_percent == null ? null : num(cfg.cap_percent),
  };
}

/** Devuelve la configuración de mora activa (copia). */
export function getOverdueConfig(): OverdueRuntimeConfig {
  return { ...overdueConfig };
}

/** Restablece la config por defecto. Útil al salir de un tenant / logout. */
export function resetOverdueConfig(): void {
  overdueConfig = { ...DEFAULT_OVERDUE_CONFIG };
}

/** Días de gracia antes de aplicar mora (+bloqueo MDM). */
export function overdueGraceDays(): number {
  return Math.max(0, overdueConfig.grace_days);
}

/**
 * Texto corto del tipo de mora para leyendas compartidas:
 *  - FIXED: "FATE fijos de mora"
 *  - PERCENTAGE: "Z% de mora sobre BASE"
 */
export function overdueRuleText(): string {
  const c = overdueConfig;
  if (c.type === 'PERCENTAGE') {
    const base = c.percentage_base === 'CAPITAL' ? 'capital' : c.percentage_base === 'INSTALLMENT' ? 'cuota' : 'saldo';
    return `${c.percentage_rate}% de mora sobre ${base}`;
  }
  return `Mora fija aplicada por cuota`;
}

/** Texto de estado corto para tabs/filtros: patrón "+3 días, +MONTO mora". */
export function overdueStatusText(forStatus: 'VENCIDO' | 'ATRASADO'): string {
  const grace = overdueGraceDays();
  if (forStatus === 'ATRASADO') {
    const mora =
      overdueConfig.type === 'FIXED'
        ? `+${overdueConfig.fixed_amount} mora`
        : `+${overdueConfig.percentage_rate}% mora`;
    return `Atrasado (+${grace} d, ${mora} & Bloqueado MDM)`;
  }
  return `Vencido (0 a ${Math.max(1, grace - 1)} días - Período de gracia)`;
}