/**
 * Formats a value with its standard uncertainty, rounding σ to two significant figures and the
 * value to the same decimal place: (31.77123, 0.00083) → "31.77123 ± 0.00083",
 * (1234.5, 56) → "1235 ± 56". Without a usable σ the value gets `fallbackDigits` significant
 * figures. A σ of NaN means the uncertainty could not be determined: the value is then given to
 * 4 significant figures followed by "± n/a", so it is never mistaken for an exact number.
 */
export function formatWithSigma(value: number, sigma: number, fallbackDigits = 5): string {
  if (!Number.isFinite(value)) return '–';
  if (Number.isNaN(sigma)) return `${Number(value.toPrecision(4))} ± n/a`;
  if (!(sigma > 0) || !Number.isFinite(sigma))
    return Number(value.toPrecision(fallbackDigits)).toString();
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(sigma)));
  return `${value.toFixed(decimals)} ± ${sigma.toFixed(decimals)}`;
}
