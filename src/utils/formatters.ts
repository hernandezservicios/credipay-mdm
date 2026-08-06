/**
 * Formato oficial de montos y fechas (Adenda v2.2, F3/F4).
 * Todo importe económico usa SOLO formatCurrencyRD(); toda fecha usa formatDate/formatDateTime().
 * La moneda (RD$) vive únicamente aquí; ningún componente la escribe por código (F9).
 */

const CURRENCY_SYMBOL = 'RD$';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatCurrencyRD(
  value: number | string | null | undefined,
  withSymbol = true,
  symbol = CURRENCY_SYMBOL
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return withSymbol ? `${symbol}0.00` : '0.00';
  const negative = n < 0;
  const parts = Math.abs(n).toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = negative ? '-' : '';
  return `${sign}${withSymbol ? symbol : ''}${intPart}.${parts[1]}`;
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
