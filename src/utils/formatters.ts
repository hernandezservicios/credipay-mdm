/**
 * Formato oficial de montos y fechas (Adenda v2.2, F3/F4).
 * Todo importe económico usa SOLO formatCurrencyRD(); toda fecha usa formatDate/formatDateTime().
 * La moneda es única por tenant (Adenda v2.5 / Plan Maestro v2.9, FASE 1):
 * se resuelve a través de setMoneyConfig(getConfig().currency) tras el login y NUNCA
 * se escribe por código en los componentes (F9).
 *
 * Resolver de moneda MODULE-LEVEL (sin Context/Provider/Store/Signals).
 */

export interface MoneyConfig {
  code: string;
  symbol: string;
  decimals: number;
  thousandSeparator: string;
  decimalSeparator: string;
}

const DEFAULT_MONEY_CONFIG: MoneyConfig = {
  code: 'DOP',
  symbol: 'RD$',
  decimals: 2,
  thousandSeparator: ',',
  decimalSeparator: '.',
};

let moneyConfig: MoneyConfig = { ...DEFAULT_MONEY_CONFIG };

/** Registra la config de moneda devuelta por `GET /config` (sección `currency`). */
export function setMoneyConfig(cfg: MoneyConfig | null | undefined): void {
  if (!cfg) {
    moneyConfig = { ...DEFAULT_MONEY_CONFIG };
    return;
  }
  moneyConfig = {
    code: cfg.code || DEFAULT_MONEY_CONFIG.code,
    symbol: cfg.symbol || DEFAULT_MONEY_CONFIG.symbol,
    decimals:
      Number.isFinite(cfg.decimals) && cfg.decimals >= 0
        ? cfg.decimals
        : DEFAULT_MONEY_CONFIG.decimals,
    thousandSeparator: cfg.thousandSeparator || DEFAULT_MONEY_CONFIG.thousandSeparator,
    decimalSeparator: cfg.decimalSeparator || DEFAULT_MONEY_CONFIG.decimalSeparator,
  };
}

/** Devuelve la configuración de moneda activa. */
export function getMoneyConfig(): MoneyConfig {
  return { ...moneyConfig };
}

/** Restablece el formato por defecto (DOP). Útil al salir de un tenant / logout. */
export function resetMoneyConfig(): void {
  moneyConfig = { ...DEFAULT_MONEY_CONFIG };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatCurrencyRD(
  value: number | string | null | undefined,
  withSymbol = true,
  symbol = moneyConfig.symbol
): string {
  const n = Number(value);
  const { decimals, thousandSeparator, decimalSeparator } = moneyConfig;
  if (!Number.isFinite(n)) {
    const zero = `0${decimalSeparator}${'0'.repeat(Math.max(0, decimals))}`;
    return withSymbol ? `${symbol}${zero}` : zero;
  }
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const intPart = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
  const sign = negative ? '-' : '';
  const amount = decimals > 0 ? `${intPart}${decimalSeparator}${dec}` : intPart;
  return `${sign}${withSymbol ? symbol : ''}${amount}`;
}

function parseAnyDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: unknown): string {
  const d = parseAnyDate(value);
  if (!d) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(value: unknown): string {
  const d = parseAnyDate(value);
  if (!d) return '—';
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 12 ? 'AM' : 'PM';
  return `${formatDate(d)} ${pad2(h12)}:${pad2(d.getMinutes())} ${period}`;
}

/** Convierte dd/MM/yyyy (entrada de usuario) a YYYY-MM-DD para el backend. */
export function toIsoDate(value: string): string {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return value.trim();
  return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
}