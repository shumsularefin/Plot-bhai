import { tickStep, ticks } from 'd3-array';

export interface Tick {
  value: number;
  label: string;
}

/** "Nice" tick positions (1, 2 or 5 × 10ⁿ apart) with labels using just enough decimals. */
export function niceTicks(start: number, stop: number, count: number): Tick[] {
  const step = tickStep(start, stop, count);
  const decimals = Math.max(0, Math.ceil(-Math.log10(Math.abs(step)) - 1e-9));
  // U+2212 is the typographic minus sign used in publications.
  return ticks(start, stop, count).map((value) => ({
    value,
    label: value.toFixed(decimals).replace(/^-/, '−'),
  }));
}
