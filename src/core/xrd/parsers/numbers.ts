const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses a plain decimal number such as "12.5", "-3" or "1e4". Returns NaN for anything else,
 * including empty strings (which Number() would turn into 0).
 */
export function parseNumber(text: string): number {
  return NUMBER.test(text) ? Number(text) : NaN;
}

/** Splits whitespace-separated numbers, as used in XRDML lists. Returns null if any item is not a number. */
export function parseNumberList(text: string): number[] | null {
  const items = text.trim().split(/\s+/);
  if (items.length === 1 && items[0] === '') return [];
  const values = items.map(parseNumber);
  return values.some(Number.isNaN) ? null : values;
}

/** Parses typed numbers such as "1650, 1685.5 1720;1730" (commas, semicolons or spaces); null when any entry is not a number. */
export function parseTypedNumbers(text: string): number[] | null {
  const values = text
    .split(/[\s,;]+/)
    .filter((p) => p !== '')
    .map(Number);
  return values.every(Number.isFinite) ? values : null;
}

export function formatNumber(value: number, maxDecimals = 4): string {
  return Number(value.toFixed(maxDecimals)).toString();
}
