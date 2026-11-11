import type { PlotSeries } from './types';

export interface SeriesSource {
  id: string;
  name: string;
  x: Float64Array;
  y: Float64Array;
  unit: string;
  /** Palette index; defaults to the series' position. */
  colorIndex?: number;
  dashed?: boolean;
  quiet?: boolean;
}

export interface SeriesOptions {
  /** Divide each series by its own maximum so every series peaks at 1. */
  normalise: boolean;
  /** Vertical gap between series, as a fraction of the tallest series (0 to 1). */
  offsetFraction: number;
  /**
   * Stack without overlap: each series is lifted so its lowest point sits the gap above the
   * highest point of the series below it (like a stacked graph in Origin). Without it, series i
   * is simply lifted by i gaps, so tall peaks can still cross the next pattern.
   */
  stack?: boolean;
}

/**
 * Prepares series for drawing. Normalising divides by each series' own maximum. Offsetting
 * lifts series i by i × offsetFraction × (largest maximum), so the first series stays at the
 * bottom. Stacking lifts series i to (top of series i − 1) + offsetFraction × (largest
 * max − min span) − (its own minimum), so no two series overlap.
 */
export function prepareSeries(
  sources: readonly SeriesSource[],
  options: SeriesOptions,
): PlotSeries[] {
  const { scaled, transforms } = transformed(sources, options);
  return sources.map((s, i) => {
    const y = scaled[i] as Float64Array;
    const { shift } = transforms[i] as SeriesTransform;
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: shift === 0 ? y : y.map((v) => v + shift),
      readoutY: s.y,
      readoutUnit: s.unit,
      colorIndex: s.colorIndex ?? i,
      ...(s.dashed && { dashed: true }),
      ...(s.quiet && { quiet: true }),
    };
  });
}

/** How a series' y values are drawn: y_drawn = y × scale + shift. */
export interface SeriesTransform {
  scale: number;
  shift: number;
}

function transformed(sources: readonly SeriesSource[], options: SeriesOptions) {
  const maxima = sources.map((s) => s.y.reduce((m, v) => (v > m ? v : m), -Infinity));
  const scales = maxima.map((max) => (options.normalise && max > 0 ? 1 / max : 1));
  const scaled = sources.map((s, i) => {
    const max = maxima[i] as number;
    return scales[i] === 1 ? s.y : s.y.map((v) => v / max);
  });
  const tallest = options.normalise ? 1 : Math.max(...maxima);
  const shifts = options.stack
    ? stackShifts(scaled, options.offsetFraction)
    : scaled.map((_, i) => i * options.offsetFraction * tallest);
  const transforms = scales.map((scale, i) => ({ scale, shift: shifts[i] as number }));
  return { scaled, transforms };
}

/**
 * The transform prepareSeries applies to each source, so things drawn on a curve (such as peak
 * labels) can follow it when the curves are normalised, offset or stacked.
 */
export function seriesTransforms(
  sources: readonly SeriesSource[],
  options: SeriesOptions,
): SeriesTransform[] {
  return transformed(sources, options).transforms;
}

/** Lift of each series so that none overlaps the one below it, with a gap between them. */
function stackShifts(series: readonly Float64Array[], gapFraction: number): number[] {
  const ranges = series.map((y) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of y) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo <= hi ? { lo, hi } : { lo: 0, hi: 0 };
  });
  const gap = gapFraction * Math.max(0, ...ranges.map((r) => r.hi - r.lo));
  const shifts: number[] = [];
  let top = 0;
  ranges.forEach((r, i) => {
    const shift = i === 0 ? 0 : top + gap - r.lo;
    shifts.push(shift);
    top = r.hi + shift;
  });
  return shifts;
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
