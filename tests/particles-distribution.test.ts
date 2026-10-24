import { describe, expect, it } from 'vitest';
import {
  betterFit,
  cleanSizes,
  countWarning,
  cumulative,
  fitLognormal,
  fitNormal,
  freedmanDiaconisBins,
  histogram,
  lognormalPdf,
  normalPdf,
  percentile,
  sturgesBins,
  summarise,
} from '../src/core/particles/distribution';
import { seededRandom } from '../src/core/xrd/synthetic';

function must<T>(value: T | null): T {
  if (value === null) throw new Error('expected a value');
  return value;
}

const ONE_TO_TEN = cleanSizes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** Lognormal sample by the Box–Muller transform: x = exp(μ + σ z). */
function lognormalSample(n: number, mu: number, sigma: number, seed: number): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: n }, () => {
    const z = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    return Math.exp(mu + sigma * z);
  });
}

describe('percentiles and summary (hand-computed)', () => {
  // n = 10: position h = 9p/100, so P10 = 1.9, P50 = 5.5, P90 = 9.1 for the values 1 … 10.
  it('interpolates linearly between the sorted values', () => {
    expect(percentile(ONE_TO_TEN, 10)).toBeCloseTo(1.9, 12);
    expect(percentile(ONE_TO_TEN, 50)).toBeCloseTo(5.5, 12);
    expect(percentile(ONE_TO_TEN, 90)).toBeCloseTo(9.1, 12);
    expect(percentile(ONE_TO_TEN, 0)).toBe(1);
    expect(percentile(ONE_TO_TEN, 100)).toBe(10);
  });

  it('summarises 1 … 10: mean 5.5, sample SD √(82.5/9), span (9.1 − 1.9)/5.5', () => {
    const s = must(summarise(ONE_TO_TEN));
    expect(s.count).toBe(10);
    expect(s.mean).toBeCloseTo(5.5, 12);
    expect(s.sd).toBeCloseTo(Math.sqrt(82.5 / 9), 12);
    expect(s.median).toBeCloseTo(5.5, 12);
    expect([s.d10, s.d50, s.d90]).toEqual([
      expect.closeTo(1.9, 12),
      expect.closeTo(5.5, 12),
      expect.closeTo(9.1, 12),
    ]);
    expect(s.span).toBeCloseTo(7.2 / 5.5, 12);
    expect([s.min, s.max]).toEqual([1, 10]);
  });

  it('handles one value and no values', () => {
    const one = must(summarise(cleanSizes([7])));
    expect(one.d10).toBe(7);
    expect(one.sd).toBeNaN();
    expect(summarise(cleanSizes([]))).toBeNull();
  });

  it('drops values that cannot be diameters and sorts the rest', () => {
    expect(Array.from(cleanSizes([3, NaN, 1, -2, 0, Infinity, 2]))).toEqual([1, 2, 3]);
  });
});

describe('histogram', () => {
  it('Sturges: ⌈log₂ n⌉ + 1', () => {
    expect(sturgesBins(8)).toBe(4);
    expect(sturgesBins(100)).toBe(8);
    expect(sturgesBins(1)).toBe(1);
  });

  // IQR = P75 − P25 = 7.75 − 3.25 = 4.5, width = 2 · 4.5 / ∛10 = 4.1776, range 9, so 3 bins.
  it('Freedman–Diaconis on 1 … 10 gives 3 bins', () => {
    expect(freedmanDiaconisBins(ONE_TO_TEN)).toBe(3);
  });

  it('falls back to Sturges when the IQR is zero', () => {
    const sorted = cleanSizes([5, 5, 5, 5, 5, 5, 5, 5, 9]);
    expect(freedmanDiaconisBins(sorted)).toBe(sturgesBins(9));
  });

  it('counts values in equal bins; the largest value closes the last bin', () => {
    const h = histogram(cleanSizes([1, 2, 2, 3, 4]), 'manual', 2);
    expect(h.edges).toEqual([1, 2.5, 4]);
    expect(h.counts).toEqual([3, 2]);
    expect(h.binWidth).toBe(1.5);
  });

  it('keeps every value, whatever the method', () => {
    const sorted = cleanSizes(lognormalSample(500, 3, 0.4, 1));
    for (const method of ['freedman-diaconis', 'sturges', 'manual'] as const) {
      const h = histogram(sorted, method, 25);
      expect(h.counts.reduce((a, b) => a + b, 0)).toBe(500);
      expect(h.edges).toHaveLength(h.counts.length + 1);
    }
  });

  it('draws one bar when all values are equal', () => {
    const h = histogram(cleanSizes([4, 4, 4]), 'sturges');
    expect(h.counts).toEqual([3]);
    expect(h.edges[0]).toBeLessThan(4);
    expect(h.edges[1]).toBeGreaterThan(4);
  });

  it('limits a manual request to a sensible number of bins', () => {
    expect(histogram(ONE_TO_TEN, 'manual', 100000).counts).toHaveLength(200);
    expect(histogram(ONE_TO_TEN, 'manual', 0).counts).toHaveLength(1);
  });

  it('cumulative curve ends at 1', () => {
    const c = cumulative(cleanSizes([3, 1, 2]));
    expect(Array.from(c.share)).toEqual([1 / 3, 2 / 3, 1]);
    expect(Array.from(c.x)).toEqual([1, 2, 3]);
  });
});

describe('fits', () => {
  // [1, 2, 3]: mean 2, ML variance 2/3, ℓ = −1.5 ln(2π · 2/3) − 1.5.
  it('normal fit by maximum likelihood on [1, 2, 3]', () => {
    const fit = must(fitNormal(cleanSizes([1, 2, 3])));
    expect(fit.mean).toBe(2);
    expect(fit.sigma).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(fit.logLikelihood).toBeCloseTo(-1.5 * Math.log((2 * Math.PI * 2) / 3) - 1.5, 12);
  });

  // x = e¹, e³: ln x = 1, 3, so μ = 2 and σ² = 1; ℓ = −(1 + 3) − ln(2π) − 1.
  it('lognormal fit by maximum likelihood on [e, e³]', () => {
    const fit = must(fitLognormal(cleanSizes([Math.E, Math.E ** 3])));
    expect(fit.mu).toBeCloseTo(2, 12);
    expect(fit.sigma).toBeCloseTo(1, 12);
    expect(fit.median).toBeCloseTo(Math.E ** 2, 10);
    expect(fit.mean).toBeCloseTo(Math.exp(2.5), 10);
    expect(fit.geometricSd).toBeCloseTo(Math.E, 12);
    expect(fit.logLikelihood).toBeCloseTo(-4 - Math.log(2 * Math.PI) - 1, 10);
  });

  it('recovers the parameters of a known lognormal sample', () => {
    // Median exp(3.5) ≈ 33.1 nm, σ = 0.35. With 20 000 values the error of μ is σ/√n ≈ 0.0025.
    const fit = must(fitLognormal(cleanSizes(lognormalSample(20000, 3.5, 0.35, 42))));
    expect(fit.mu).toBeCloseTo(3.5, 1);
    expect(Math.abs(fit.mu - 3.5)).toBeLessThan(0.01);
    expect(Math.abs(fit.sigma - 0.35) / 0.35).toBeLessThan(0.02);
    expect(Math.abs(fit.median - Math.exp(3.5)) / Math.exp(3.5)).toBeLessThan(0.01);
  });

  it('recovers a known normal sample', () => {
    const random = seededRandom(7);
    const values = Array.from(
      { length: 20000 },
      () => 50 + 5 * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()),
    );
    const fit = must(fitNormal(cleanSizes(values)));
    expect(Math.abs(fit.mean - 50)).toBeLessThan(0.2);
    expect(Math.abs(fit.sigma - 5) / 5).toBeLessThan(0.02);
  });

  it('prefers the lognormal for a skewed sample and the normal for a symmetric one', () => {
    const skewed = cleanSizes(lognormalSample(2000, 3, 0.6, 3));
    expect(betterFit(fitNormal(skewed), fitLognormal(skewed))).toBe('lognormal');
    const random = seededRandom(11);
    const symmetric = cleanSizes(
      Array.from(
        { length: 2000 },
        () => 100 + 4 * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()),
      ),
    );
    expect(betterFit(fitNormal(symmetric), fitLognormal(symmetric))).toBe('normal');
  });

  it('refuses to fit one value or identical values', () => {
    expect(fitNormal(cleanSizes([5]))).toBeNull();
    expect(fitLognormal(cleanSizes([5, 5, 5]))).toBeNull();
    expect(betterFit(null, null)).toBeNull();
  });

  it('densities integrate to one', () => {
    let a = 0;
    let b = 0;
    for (let x = 0.005; x < 400; x += 0.01) {
      a += lognormalPdf(x, { mu: 3, sigma: 0.4 }) * 0.01;
      b += normalPdf(x, { mean: 100, sigma: 20 }) * 0.01;
    }
    expect(a).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
    expect(lognormalPdf(-1, { mu: 0, sigma: 1 })).toBe(0);
  });
});

describe('count warning', () => {
  it('warns below 100 and not at 100', () => {
    expect(countWarning(0)).toMatch(/No particles/);
    expect(countWarning(99)).toMatch(/Only 99 particles/);
    expect(countWarning(100)).toBeNull();
  });
});
