import { describe, expect, it } from 'vitest';
import { linearFit, weightedLinearFit } from '../src/core/math/linearFit';
import type { Cell } from '../src/core/xrd/reference/powder';
import {
  refineRietveld,
  type Estimate,
  type RietveldInput,
  type RietveldResult,
} from '../src/core/xrd/rietveld/refine';
import {
  labelUnit,
  refineSeries,
  relativeSlope,
  scientificText,
  seriesMethods,
  seriesOrder,
  seriesQuantities,
  valueFromName,
  type SeriesItem,
} from '../src/core/xrd/rietveld/sequential';

describe('weighted straight line', () => {
  it('recovers an exact line (synthetic)', () => {
    const x = [0, 1, 2, 3, 4];
    const fit = weightedLinearFit(
      x,
      x.map((v) => 2 - 0.5 * v),
      [1, 2, 0.5, 1, 3],
    );
    expect(fit?.slope).toBeCloseTo(-0.5, 12);
    expect(fit?.intercept).toBeCloseTo(2, 12);
    expect(fit?.rSquared).toBeCloseTo(1, 12);
    expect(fit?.slopeSigma).toBeCloseTo(0, 12);
  });

  it('equals the unweighted fit when every σ is the same', () => {
    const x = [0, 1, 2, 3];
    const y = [1.1, 2.9, 4.9, 7.1];
    const w = weightedLinearFit(x, y, [0.3, 0.3, 0.3, 0.3]);
    const u = linearFit(x, y);
    expect(w?.slope).toBeCloseTo(u?.slope as number, 12);
    expect(w?.intercept).toBeCloseTo(u?.intercept as number, 12);
    expect(w?.slopeSigma).toBeCloseTo(u?.slopeSigma as number, 12);
    expect(w?.interceptSigma).toBeCloseTo(u?.interceptSigma as number, 12);
  });

  it('matches numpy.polyfit(x, y, 1, w = 1/σ) with cov = True and cov = "unscaled"', () => {
    // Reference values computed in this project with numpy 2.5.3 (an independent
    // implementation) on the same numbers; the CI fixture repeats this on GSAS-II's cells.
    const fit = weightedLinearFit(
      [25, 125, 225, 325, 425],
      [3.24982, 3.25183, 3.25371, 3.25587, 3.2576],
      [0.00004, 0.00005, 0.00003, 0.00006, 0.00004],
    );
    if (!fit) throw new Error('no fit');
    const close = (ours: number, theirs: number) =>
      expect(Math.abs(ours - theirs) / Math.abs(theirs)).toBeLessThan(1e-9);
    close(fit.slope, 1.951552233462039e-5);
    close(fit.intercept, 3.249347479410972);
    close(fit.slopeSigma, 2.640820098863826e-7);
    close(fit.interceptSigma, 6.860993807370295e-5);
    close(fit.slopeSigmaUnscaled, 1.3276967361641144e-7);
    close(fit.interceptSigmaUnscaled, 3.449428110914064e-5);
  });

  it('does not depend on the order of the points or a common scale of σ (invariance)', () => {
    const x = [10, 40, 20, 30, 50];
    const y = [5.1, 6.7, 5.4, 6.2, 7.3];
    const s = [0.1, 0.2, 0.15, 0.1, 0.3];
    const a = weightedLinearFit(x, y, s);
    const b = weightedLinearFit([...x].reverse(), [...y].reverse(), [...s].reverse());
    const c = weightedLinearFit(
      x,
      y,
      s.map((v) => v * 7),
    );
    for (const other of [b, c]) {
      expect(other?.slope).toBeCloseTo(a?.slope as number, 12);
      expect(other?.intercept).toBeCloseTo(a?.intercept as number, 12);
      expect(other?.slopeSigma).toBeCloseTo(a?.slopeSigma as number, 12);
    }
    expect(c?.slopeSigmaUnscaled).toBeCloseTo((a?.slopeSigmaUnscaled as number) * 7, 12);
  });

  it('refuses fewer than two points, a zero σ or a single x', () => {
    expect(weightedLinearFit([1], [1], [1])).toBeNull();
    expect(weightedLinearFit([1, 2], [1, 2], [1, 0])).toBeNull();
    expect(weightedLinearFit([1, 1], [1, 2], [1, 1])).toBeNull();
    expect(weightedLinearFit([1, 2], [1, 2], [1, 1])?.slopeSigma).toBeNaN();
  });
});

describe('series helpers', () => {
  it('suggests the value from the last number of a file name', () => {
    expect(valueFromName('ZnO_300C.xy')).toBe(300);
    expect(valueFromName('Zn1-xMgxO_x0.05.xye')).toBe(0.05);
    expect(valueFromName('run 2, 12,5 h.csv')).toBe(12.5);
    expect(valueFromName('pattern.xy')).toBeNull();
  });

  it('orders by value, keeping the given order for equal values', () => {
    const items = [
      { value: 3, n: 'a' },
      { value: 1, n: 'b' },
      { value: 3, n: 'c' },
      { value: 2, n: 'd' },
    ];
    expect(seriesOrder(items).map((i) => i.n)).toEqual(['b', 'd', 'a', 'c']);
  });
});

const est = (value: number, refined = true, esd = 0.001): Estimate => ({ value, esd, refined });
const cellEstimates = (c: Cell): Record<keyof Cell, Estimate> => ({
  a: est(c.a),
  b: est(c.b),
  c: est(c.c),
  alpha: est(c.alpha, false, 0),
  beta: est(c.beta, false, 0),
  gamma: est(c.gamma, false, 0),
});

describe('sequential refinement (order, copying forward, failures)', () => {
  const base = { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 };
  const item = (id: string, value: number): SeriesItem => ({
    id,
    name: `${id}.xy`,
    value,
    input: {
      phases: [{ id: 'p', name: 'P', cell: base }],
    } as unknown as RietveldInput,
  });
  // A stand-in refinement: the cell grows by 0.01 Å from wherever it starts; pattern "bad" fails.
  const seen: { a: number; start: Cell }[] = [];
  const fake = ((input: RietveldInput) => {
    const start = (input.phases[0] as { cell: Cell }).cell;
    seen.push({ a: start.a, start });
    if (start === bad) return { ok: false, error: 'no fit' };
    const cell = { ...start, a: start.a + 0.01, b: start.b + 0.01 };
    return {
      ok: true,
      phases: [
        {
          id: 'p',
          name: 'P',
          cell: cellEstimates(cell),
          volume: est(100),
          weightFraction: null,
          size: null,
          microstrain: null,
        },
      ],
      stats: { rwp: 0.05, chi2: 1.2 },
      zero: est(0, false, 0),
      converged: true,
      warnings: [],
    } as unknown as RietveldResult;
  }) as typeof refineRietveld;
  const bad: Cell = { ...base };

  it('refines in order of value and starts each pattern from the previous refined cell', () => {
    seen.length = 0;
    const points = refineSeries([item('t3', 300), item('t1', 100), item('t2', 200)], true, fake);
    expect(points.map((p) => p.id)).toEqual(['t1', 't2', 't3']);
    expect(seen.map((s) => s.a)).toEqual([4, 4.01, 4.02].map((v) => expect.closeTo(v, 12)));
    expect(points.map((p) => p.phases[0]?.cell.a.value)).toEqual(
      [4.01, 4.02, 4.03].map((v) => expect.closeTo(v, 12)),
    );
  });

  it('starts every pattern from the input cell without copying forward', () => {
    seen.length = 0;
    refineSeries([item('t1', 100), item('t2', 200)], false, fake);
    expect(seen.map((s) => s.a)).toEqual([4, 4]);
  });

  it('keeps going after a failed pattern, from the last good result', () => {
    seen.length = 0;
    // First in the series, so it starts from its own (failing) cell rather than a copied one.
    const failing = item('x', 50);
    failing.input = { phases: [{ id: 'p', name: 'P', cell: bad }] } as unknown as RietveldInput;
    const points = refineSeries([item('t1', 100), failing, item('t2', 200)], true, fake);
    expect(points.map((p) => p.error)).toEqual(['no fit', null, null]);
    expect(seen.map((s) => s.a)).toEqual([4, 4, 4.01]);
  });

  it('lists a, c and V for a hexagonal cell (b follows a), then R_wp and χ²', () => {
    const points = refineSeries([item('t1', 100), item('t2', 200)], true, (input) => {
      const result = fake(input) as RietveldResult;
      const phase = result.phases[0] as RietveldResult['phases'][number];
      // b follows a exactly, as refine.ts reports it.
      phase.cell.b = { ...phase.cell.a };
      return result;
    });
    expect(seriesQuantities(points).map((q) => q.label)).toEqual([
      'P: a',
      'P: c',
      'P: V',
      'R_wp',
      'χ²',
    ]);
  });
});

describe('series methods text', () => {
  const point = (value: number, error: string | null = null) =>
    ({ id: String(value), name: `${value}.xy`, value, error, phases: [] }) as unknown as Parameters<
      typeof seriesMethods
    >[0]['points'][number];

  it('reads the unit from the label and writes powers of ten', () => {
    expect(labelUnit('Temperature (°C)')).toBe('°C');
    expect(labelUnit('Composition x')).toBe('');
    expect(scientificText(1.951552e-5, 2.6408e-7)).toBe('(1.952 ± 0.026) × 10⁻⁵');
    expect(scientificText(3.2493, 0.00007)).toBe('3.249300 ± 0.000070');
  });

  it('gives the relative slope (1/y₀)·dy/dx: a thermal expansion coefficient', () => {
    // a = 3.25 (1 + 6e-6 (T − 25)): slope 1.95e-5 Å/°C, y₀ = 3.25 Å at 25 °C → 6e-6 per °C.
    const fit = weightedLinearFit(
      [25, 125, 225],
      [25, 125, 225].map((t) => 3.25 * (1 + 6e-6 * (t - 25))),
      [1e-5, 1e-5, 1e-5],
    );
    if (!fit) throw new Error('no fit');
    expect(relativeSlope({ fit, start: fit.intercept + fit.slope * 25 }).value).toBeCloseTo(
      6e-6,
      15,
    );
  });

  it('says how the patterns started, which failed, and the line', () => {
    const fit = weightedLinearFit([25, 125, 225], [3.25, 3.2521, 3.2539], [1e-4, 1e-4, 1e-4]);
    if (!fit) throw new Error('no fit');
    const text = seriesMethods({
      label: 'Temperature (°C)',
      points: [point(25), point(125), point(225), point(325, 'no fit')],
      copyForward: true,
      trend: { label: 'ZnO: a', unit: 'Å', fit, start: 3.25 },
    });
    expect(text).toContain('The 4 patterns of the series (temperature 25 to 325 °C)');
    expect(text).toContain('each starting from the unit cells refined on the previous pattern');
    expect(text).toContain('1 pattern could not be refined and is left out');
    // Slope by hand: Σ(x − x̄)(y − ȳ) / Σ(x − x̄)² = 0.39 / 20000 = 1.95e-5 Å per °C.
    expect(text).toContain('slope of (1.950 ± 0.087) × 10⁻⁵ Å per °C');
    expect(
      seriesMethods({ label: 'x', points: [point(1)], copyForward: false, trend: null }),
    ).toContain('each starting from the reference unit cells');
    const two = weightedLinearFit([1, 2], [3.25, 3.26], [1e-4, 1e-4]);
    if (!two) throw new Error('no fit');
    const short = seriesMethods({
      label: 'x',
      points: [point(1), point(2)],
      copyForward: true,
      trend: { label: 'P: a', unit: 'Å', fit: two, start: 3.25 },
    });
    expect(short).toContain('through two points, so without an uncertainty');
    expect(short).not.toContain('NaN');
  });
});
