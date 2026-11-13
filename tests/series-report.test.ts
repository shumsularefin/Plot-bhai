import { describe, expect, it } from 'vitest';
import type { Estimate } from '../src/core/xrd/rietveld/refine';
import type { SeriesPoint } from '../src/core/xrd/rietveld/sequential';
import type { XrdData } from '../src/modules/xrd/data';
import { DEFAULT_SERIES, seriesTrend, seriesValue } from '../src/modules/xrd/seriesReport';

const est = (value: number, esd: number, refined = true): Estimate => ({ value, esd, refined });
const point = (value: number, a: number, esd = 1e-4): SeriesPoint => ({
  id: String(value),
  name: `${value}.xy`,
  value,
  error: null,
  stats: {
    rwp: 0.05,
    rexp: 0.04,
    rp: 0.04,
    chi2: 1.5,
    gof: 1.2,
    durbinWatson: 2,
    berarLelann: 1.13,
  } as SeriesPoint['stats'],
  zero: est(0, 0, false),
  converged: true,
  phases: [
    {
      id: 'p',
      name: 'P',
      cell: {
        a: est(a, esd),
        b: est(a, esd),
        c: est(a, esd),
        alpha: est(90, 0, false),
        beta: est(90, 0, false),
        gamma: est(90, 0, false),
      },
      volume: est(a ** 3, 3 * a * a * esd),
      weightFraction: null,
      size: null,
      microstrain: null,
    },
  ],
  warnings: [],
});

describe('series report', () => {
  it('takes the typed value, else the file name, else the position', () => {
    const data = {
      patterns: [
        { id: 'x', name: 'ZnO_300C.xy' },
        { id: 'y', name: 'sample.xy' },
      ],
    } as unknown as XrdData;
    expect(seriesValue(DEFAULT_SERIES, data, 'x')).toBe(300);
    expect(seriesValue(DEFAULT_SERIES, data, 'y')).toBe(2);
    expect(seriesValue({ ...DEFAULT_SERIES, values: { x: 25 } }, data, 'x')).toBe(25);
    expect(seriesValue({ ...DEFAULT_SERIES, values: { x: null } }, data, 'x')).toBeNull();
  });

  it('fits a line through the chosen quantity, starting from its lowest value', () => {
    // Cubic: only a is listed (b and c follow it); a = 4 + 1e-4·T exactly.
    const points = [point(300, 4.03), point(100, 4.01), point(200, 4.02)];
    const { quantities, quantity, trend } = seriesTrend(points, undefined);
    expect(quantities.map((q) => q.label)).toEqual(['P: a', 'P: V', 'R_wp', 'χ²']);
    expect(quantity?.key).toBe('p:a');
    expect(trend?.fit.slope).toBeCloseTo(1e-4, 12);
    expect(trend?.start).toBeCloseTo(4.01, 12);
  });

  it('fits no line through R_wp, which has no uncertainty', () => {
    const { trend } = seriesTrend([point(1, 4), point(2, 4.1)], 'rwp');
    expect(trend).toBeNull();
  });
});
