import type { PlotSeries } from './types';

export interface SeriesSource {
  id: string;
  name: string;
  x: Float64Array;
  y: Float64Array;
  unit: string;
}

export interface SeriesOptions {
  /** Divide each series by its own maximum so every series peaks at 1. */
  normalise: boolean;
  /** Vertical gap between stacked series, as a fraction of the tallest series (0 to 1). */
  offsetFraction: number;
}

/**
 * Prepares series for drawing. Normalising divides by each series' own maximum. Offsetting
 * lifts series i by i × offsetFraction × (largest maximum), so the first series stays at the
 * bottom.
 */
export function prepareSeries(
  sources: readonly SeriesSource[],
  options: SeriesOptions,
): PlotSeries[] {
  const maxima = sources.map((s) => s.y.reduce((m, v) => (v > m ? v : m), -Infinity));
  const scaled = sources.map((s, i) => {
    const max = maxima[i] as number;
    return options.normalise && max > 0 ? s.y.map((v) => v / max) : s.y;
  });
  const tallest = options.normalise ? 1 : Math.max(...maxima);
  const gap = options.offsetFraction * tallest;
  return sources.map((s, i) => {
    const y = scaled[i] as Float64Array;
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: gap === 0 || i === 0 ? y : y.map((v) => v + i * gap),
      readoutY: s.y,
      readoutUnit: s.unit,
      colorIndex: i,
    };
  });
}

/** Overall x extent of all series. */
export function xExtent(series: readonly PlotSeries[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    if (s.x.length === 0) continue;
    lo = Math.min(lo, s.x[0] as number);
    hi = Math.max(hi, s.x[s.x.length - 1] as number);
  }
  return [lo, hi];
}
