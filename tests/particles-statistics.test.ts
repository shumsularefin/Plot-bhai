// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanSizes, summarise } from '../src/core/particles/distribution';
import {
  andersonDarlingNormal,
  coefficientOfVariation,
  meanConfidenceInterval,
  momentMeans,
  studentTQuantile,
  volumePercentiles,
} from '../src/core/particles/statistics';
import { seededRandom } from '../src/core/xrd/synthetic';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing value');
  return value;
}

/* Known answers and invariance checks for src/core/particles/statistics.ts (docs/validation.md, 19f). */

function normalSample(n: number, mean: number, sd: number, seed: number): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: n }, () => {
    const u = Math.max(1e-12, random());
    const v = random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  });
}

describe('Student t quantile', () => {
  // NIST/SEMATECH e-Handbook §1.3.6.7.2, 0.975 column, as printed (three decimals).
  it.each([
    [1, 12.706],
    [2, 4.303],
    [5, 2.571],
    [10, 2.228],
    [30, 2.042],
    [100, 1.984],
  ])('ν = %i gives the NIST table value %f', (nu, value) => {
    expect(studentTQuantile(0.975, nu)).toBeCloseTo(value, 3);
  });

  it('tends to the normal 1.960 for many degrees of freedom', () => {
    expect(studentTQuantile(0.975, 1e6)).toBeCloseTo(1.96, 3);
  });

  it('rejects probabilities outside (0.5, 1)', () => {
    expect(studentTQuantile(0.4, 5)).toBeNaN();
    expect(studentTQuantile(1, 5)).toBeNaN();
  });
});

describe('Confidence interval of the mean', () => {
  it('reproduces the NIST worked example (§1.3.5.2, N = 195)', () => {
    const ci = must(meanConfidenceInterval(9.26146, 0.02279, 195));
    expect(ci.t).toBeCloseTo(1.9723, 4);
    expect(ci.lower).toBeCloseTo(9.258242, 5);
    expect(ci.upper).toBeCloseTo(9.264679, 5);
  });

  it('covers the true mean in about 95 % of repeated samples', () => {
    let covered = 0;
    const trials = 2000;
    for (let k = 0; k < trials; k++) {
      const s = must(summarise(cleanSizes(normalSample(12, 50, 5, 1000 + k))));
      const ci = must(meanConfidenceInterval(s.mean, s.sd, s.count));
      if (ci.lower <= 50 && 50 <= ci.upper) covered++;
    }
    expect(covered / trials).toBeGreaterThan(0.935);
    expect(covered / trials).toBeLessThan(0.965);
  });

  it('needs two values', () => {
    expect(meanConfidenceInterval(5, NaN, 1)).toBeNull();
  });
});

describe('Moment means and volume percentiles', () => {
  it('equal sizes give the size itself for every mean and percentile', () => {
    const sorted = cleanSizes([7, 7, 7, 7]);
    expect(momentMeans(sorted)).toEqual({ d10: 7, d32: 7, d43: 7 });
    expect(volumePercentiles(sorted)).toEqual({ dv10: 7, dv50: 7, dv90: 7, span: 0 });
    const s = must(summarise(sorted));
    expect(coefficientOfVariation(s.sd, s.mean)).toBe(0);
  });

  it('one 1 µm and one 10 µm sphere: the volume weighting follows the large one', () => {
    const m = must(momentMeans(cleanSizes([1, 10])));
    expect(m.d10).toBe(5.5);
    expect(m.d32).toBeCloseTo(1001 / 101, 12);
    expect(m.d43).toBeCloseTo(10001 / 1001, 12);
    // 1/1001 of the volume is in the small sphere, so even Dv10 is the large one.
    expect(must(volumePercentiles(cleanSizes([1, 10]))).dv10).toBe(10);
  });

  it('D[1,0] ≤ D[3,2] ≤ D[4,3] and Dv50 ≥ number D50 for a spread of sizes', () => {
    const sorted = cleanSizes(normalSample(500, 40, 8, 7));
    const m = must(momentMeans(sorted));
    const v = must(volumePercentiles(sorted));
    expect(m.d10).toBeLessThan(m.d32);
    expect(m.d32).toBeLessThan(m.d43);
    expect(v.dv50).toBeGreaterThan(must(summarise(sorted)).d50);
  });

  it('scaling the sizes scales every mean and percentile; order does not matter', () => {
    const values = normalSample(200, 30, 6, 3);
    const a = must(momentMeans(cleanSizes(values)));
    const b = must(momentMeans(cleanSizes(values.map((v) => v * 2.5).reverse())));
    expect(b.d10).toBeCloseTo(2.5 * a.d10, 9);
    expect(b.d32).toBeCloseTo(2.5 * a.d32, 9);
    expect(b.d43).toBeCloseTo(2.5 * a.d43, 9);
    const va = must(volumePercentiles(cleanSizes(values)));
    const vb = must(volumePercentiles(cleanSizes(values.map((v) => v * 2.5))));
    expect(vb.dv50).toBeCloseTo(2.5 * va.dv50, 9);
    expect(vb.span).toBeCloseTo(va.span, 9);
  });
});

describe('Anderson–Darling', () => {
  it('does not change when the sizes are scaled or shifted', () => {
    const values = normalSample(100, 30, 6, 11);
    const a = must(andersonDarlingNormal(values));
    const b = must(andersonDarlingNormal(values.map((v) => 3 * v + 10)));
    expect(b.a2).toBeCloseTo(a.a2, 9);
  });

  it('accepts about 95 % of normal samples at the 5 % level', () => {
    let rejected = 0;
    const trials = 1000;
    for (let k = 0; k < trials; k++) {
      if (must(andersonDarlingNormal(normalSample(50, 10, 2, 5000 + k))).rejected) rejected++;
    }
    expect(rejected / trials).toBeGreaterThan(0.03);
    expect(rejected / trials).toBeLessThan(0.07);
  });

  it('rejects a clearly two-peaked sample', () => {
    const values = [...normalSample(100, 20, 1, 1), ...normalSample(100, 40, 1, 2)];
    expect(must(andersonDarlingNormal(values)).rejected).toBe(true);
  });

  it('needs two different values', () => {
    expect(andersonDarlingNormal([5, 5, 5])).toBeNull();
  });
});
