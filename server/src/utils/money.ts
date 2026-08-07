// ============================================================================
// CrediPay MDM - Formateo central de montos (Plan Maestro v2.9, FASE 5)
// Espejo server de `src/utils/formatters.ts` (formatCurrencyRD): formatea con
// el símbolo/separadores/decimals de la moneda configurada por tenant para que
// la IA de cobranza jamás escriba montos hardcodeados (RD$/USD/200).
// ============================================================================

export function formatMoney(
  value: number | string | null | undefined,
  currency: { symbol: string; decimals: number; thousand_separator: string; decimal_separator: string },
  withSymbol = true
): string {
  const n = Number(value);
  const { decimals, thousand_separator: thousandSeparator, decimal_separator: decimalSeparator, symbol } = currency;
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