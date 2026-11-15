import { describe, expect, it } from 'vitest';
import {
  absorptionSignal,
  analyseTaucGap,
  fitBandGap,
  slopesOverSpan,
  steepestRise,
  suggestRegion,
  type RegionRule,
} from '../src/core/uvvis/tauc';
import { bandEdgeAbsorbance, seededNoise } from '../src/core/uvvis/synthetic';

// Stage 22, part B: the suggested Tauc region is anchored on the steepest point of the edge
// (docs/validation.md, section 22). The earlier rule ('widest') is kept for saved sessions.

const sd = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
};

describe('smoothed derivative', () => {
  const x = Float64Array.from({ length: 201 }, (_, i) => 2 + i * 0.01);

  it('is exact for a straight line, with zero uncertainty', () => {
    const { slope, sigma } = slopesOverSpan(
      x,
      x.map((v) => 3 - 2 * v),
    );
    for (let i = 10; i < 190; i++) {
      expect(slope[i]).toBeCloseTo(-2, 10);
      expect(sigma[i]).toBeCloseTo(0, 10);
    }
    expect(slope[2]).toBeNaN();
  });

  it('gives the derivative 2x of x² at the centre of a symmetric window (known answer)', () => {
    // Steps of 0.007 eV, so ±0.05 eV holds 7 points on each side whatever the rounding.
    const u = Float64Array.from({ length: 301 }, (_, i) => 2 + i * 0.007);
    const { slope } = slopesOverSpan(
      u,
      u.map((v) => v * v),
    );
    for (const i of [20, 150, 280]) expect(slope[i]).toBeCloseTo(2 * (u[i] as number), 9);
  });

  it('skips a window that holds a NaN', () => {
    const y = x.map((v) => v);
    y[100] = NaN;
    const { slope } = slopesOverSpan(x, y);
    expect(slope[100]).toBeNaN();
    expect(slope[97]).toBeNaN();
    expect(slope[110]).toBeCloseTo(1, 10);
  });
});

describe('a long straight stretch above the edge (recorded failure 2)', () => {
  // Edge at 3.20 eV rising with slope 10 to 3.40 eV, then a straight stretch of slope 2/3 to 6 eV
  // whose line meets the axis at 0.40 eV.
  const e = Float64Array.from({ length: 401 }, (_, i) => 2 + i * 0.01);
  const y = e.map((v) => (v < 3.2 ? 0 : v < 3.4 ? 10 * (v - 3.2) : 2 + (2 / 3) * (v - 3.4)));
  const gapBy = (rule: RegionRule, scale = 1) => {
    const ys = y.map((v) => v * scale);
    const region = suggestRegion(e, ys, rule) as [number, number];
    return fitBandGap(e, ys, ...region)?.egEv as number;
  };

  it('the earlier rule took the stretch (0.40 eV); the anchored rule finds 3.20 eV', () => {
    expect(gapBy('widest')).toBeCloseTo(0.4, 6);
    expect(Math.abs(gapBy('steepest') - 3.2)).toBeLessThan(0.02);
    const steep = steepestRise(e, y);
    expect(steep?.energyEv).toBeGreaterThanOrEqual(3.2);
    expect(steep?.energyEv).toBeLessThanOrEqual(3.4);
  });

  it('does not change when the curve is multiplied by 123', () => {
    expect(gapBy('steepest', 123)).toBeCloseTo(gapBy('steepest'), 9);
    expect(
      suggestRegion(
        e,
        y.map((v) => v * 123),
      ),
    ).toEqual(suggestRegion(e, y));
  });

  it('rejects a line that meets zero inside or above its window, or at or below zero energy', () => {
    // A falling then flat curve: no window describes an edge.
    const flat = e.map((v) => (v < 3 ? 1 : 1 + 1e-6 * (v - 3)));
    expect(suggestRegion(e, flat)).toBeNull();
  });
});

describe('the 19a edge with noise: 200 seeded copies', () => {
  // A = 1.2·√(E − 3.2)/E plus a level, 250 to 850 nm in 1 nm steps, noise σ 0.003 in A.
  const scatter = (level: number) => {
    const clean = bandEdgeAbsorbance({
      startNm: 250,
      endNm: 850,
      stepNm: 1,
      bandGapEv: 3.2,
      n: 0.5,
      strength: 1.2,
      baseline: level,
    });
    const gaps: Record<RegionRule, number[]> = { widest: [], steepest: [] };
    for (let seed = 1; seed <= 200; seed++) {
      const noise = seededNoise(seed, 0.003);
      const values = clean.values.map((v) => v + noise());
      const signal = absorptionSignal(
        clean.wavelengthNm,
        values,
        { kind: 'absorbance', scale: 'percent' },
        null,
      );
      for (const rule of ['widest', 'steepest'] as const) {
        const gap = analyseTaucGap(signal.energyEv, signal.signal, 2, {
          method: null,
          edgeRegion: null,
          baselineRegion: null,
          regionRule: rule,
        });
        gaps[rule].push(gap.fit?.egEv as number);
      }
    }
    return { before: sd(gaps.widest), now: sd(gaps.steepest), mean: gaps.steepest };
  };

  it.each([0, 0.2])(
    'level %f: the scatter of the suggested Eg is not larger than before',
    (level) => {
      const { before, now, mean } = scatter(level);
      // Measured (docs/validation.md, section 22): level 0, 0.00173 → 0.00162 eV; level 0.2,
      // 0.00179 → 0.00169 eV.
      expect(now).toBeLessThanOrEqual(before);
      const average = mean.reduce((a, b) => a + b, 0) / mean.length;
      expect(Math.abs(average - 3.2)).toBeLessThan(0.002);
    },
  );
});
