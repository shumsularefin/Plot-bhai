import { weightedLinearFit } from '../../core/math/linearFit';
import {
  seriesMethods,
  seriesQuantities,
  valueFromName,
  type SeriesPoint,
  type SeriesQuantity,
  type SeriesTrend,
} from '../../core/xrd/rietveld/sequential';
import type { SeriesSettings, XrdData } from './data';

export const DEFAULT_SERIES: SeriesSettings = {
  label: 'Temperature (°C)',
  values: {},
  excluded: [],
  copyForward: true,
  result: null,
};

/** The series value of a pattern: as typed, else from its file name, else its position (1, 2 …). */
export function seriesValue(series: SeriesSettings, data: XrdData, id: string): number | null {
  const typed = series.values[id];
  if (typed !== undefined) return typed;
  const index = data.patterns.findIndex((p) => p.id === id);
  const pattern = data.patterns[index];
  return pattern ? (valueFromName(pattern.name) ?? index + 1) : null;
}

/**
 * The chosen quantity (the first one when the key is missing or unknown) and the weighted straight
 * line through it against the series value. No line when fewer than two points have a positive
 * standard uncertainty (R_wp and χ² have none, so they get no line).
 */
export function seriesTrend(
  points: readonly SeriesPoint[],
  key: string | undefined,
): { quantities: SeriesQuantity[]; quantity: SeriesQuantity | null; trend: SeriesTrend | null } {
  const quantities = seriesQuantities(points);
  const quantity = quantities.find((q) => q.key === key) ?? quantities[0] ?? null;
  if (!quantity) return { quantities, quantity, trend: null };
  const used = points.flatMap((p, i) => {
    const v = quantity.values[i];
    return v && v.esd > 0 && Number.isFinite(v.value) ? [{ x: p.value, ...v }] : [];
  });
  const fit =
    used.length === points.filter((_, i) => quantity.values[i]).length
      ? weightedLinearFit(
          used.map((u) => u.x),
          used.map((u) => u.value),
          used.map((u) => u.esd),
        )
      : null;
  const trend = fit && {
    label: quantity.label,
    unit: quantity.unit,
    fit,
    start: fit.intercept + fit.slope * Math.min(...used.map((u) => u.x)),
  };
  return { quantities, quantity, trend };
}

/** The methods sentences of the stored series result; empty when there is none. */
export function seriesMethodsFor(series: SeriesSettings | undefined): string {
  const points = series?.result?.points;
  if (!series || !points || points.length === 0) return '';
  const { trend } = seriesTrend(points, series.quantity);
  return seriesMethods({ label: series.label, points, copyForward: series.copyForward, trend });
}
