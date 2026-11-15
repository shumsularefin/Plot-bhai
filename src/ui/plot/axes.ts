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

/**
 * Nice ticks for an axis `lengthPx` long, at most `count` of them and at least `minGapPx` apart,
 * so tick labels on a short panel never run into each other. Asks d3 for fewer ticks until the
 * gap fits; always returns what d3 gives for a count of 1 as the last resort.
 */
export function spacedTicks(
  start: number,
  stop: number,
  count: number,
  lengthPx: number,
  minGapPx: number,
): Tick[] {
  const span = Math.abs(stop - start);
  for (let n = Math.max(1, Math.round(count)); n > 1; n--) {
    const t = niceTicks(start, stop, n);
    const step = t.length > 1 ? Math.abs((t[1] as Tick).value - (t[0] as Tick).value) : span;
    if (!(span > 0) || (step / span) * lengthPx >= minGapPx) return t;
  }
  return niceTicks(start, stop, 1);
}
