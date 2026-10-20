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

export function formatNumber(value: number, maxDecimals = 4): string {
  return Number(value.toFixed(maxDecimals)).toString();
}
