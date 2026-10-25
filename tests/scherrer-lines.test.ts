// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { originFit } from '../src/core/math/linearFit';
import { linearScherrer, sahadatScherrer, type SizePeak } from '../src/core/xrd/size/methods';

const settings = { k: 0.9, lambdaNm: 0.15405929, modulusGPa: null };
const DEG = Math.PI / 180;

/** Widths of pure size broadening for crystallites of size D nm: β = Kλ / (D cos θ). */
const sizeOnly = (
  d: number,
  angles: number[],
  wobble: (i: number) => number = () => 1,
): SizePeak[] =>
  angles.map((twoTheta, i) => ({
    twoTheta,
    beta: ((settings.k * settings.lambdaNm) / (d * Math.cos((twoTheta / 2) * DEG))) * wobble(i),
    betaSigma: 0,
    modulusGPa: null,
  }));

describe('cos θ against 1/β (linear straight-line and Sahadat–Scherrer)', () => {
  const angles = [25, 32, 38, 48, 55, 63, 70];

  it('recover the size of pure size broadening exactly', () => {
    const peaks = sizeOnly(25, angles);
    expect(linearScherrer(peaks, settings).size?.value).toBeCloseTo(25, 6);
    expect(sahadatScherrer(peaks, settings).size?.value).toBeCloseTo(25, 6);
    expect(sahadatScherrer(peaks, settings).fit?.intercept).toBe(0);
  });

  it('differ when the widths scatter, the origin line staying near the true size', () => {
    // ±5 % scatter on the widths, no trend with angle.
    const peaks = sizeOnly(
      25,
      angles,
      (i) => [1.05, 0.95, 1.04, 0.96, 1.05, 0.95, 1.0][i] as number,
    );
    const origin = sahadatScherrer(peaks, settings).size?.value as number;
    expect(origin).toBeGreaterThan(23);
    expect(origin).toBeLessThan(27);
    expect(linearScherrer(peaks, settings).size?.value).not.toBeCloseTo(origin, 1);
  });

  it('gives no size, with an error, when cos θ falls as 1/β rises', () => {
    // Widths shrinking with angle: 1/β rises while cos θ falls, a negative slope.
    const peaks = angles.map((twoTheta, i) => ({
      twoTheta,
      beta: 0.002 * (angles.length - i),
      betaSigma: 0,
      modulusGPa: null,
    }));
    const result = linearScherrer(peaks, settings);
    expect(result.fit?.slope).toBeLessThan(0);
    expect(result.size?.value).toBeNaN();
    expect(result.messages.some((m) => m.level === 'error')).toBe(true);
  });
});

describe('line through the origin', () => {
  it('matches the closed form and its uncertainty', () => {
    const fit = originFit([1, 2, 3, 4], [2.1, 3.9, 6.2, 7.8]);
    // slope = Σxy / Σx² = 59.7 / 30.
    expect(fit?.slope).toBeCloseTo(59.7 / 30, 12);
    const ssr = [2.1, 3.9, 6.2, 7.8].reduce((s, y, i) => s + (y - (59.7 / 30) * (i + 1)) ** 2, 0);
    expect(fit?.slopeSigma).toBeCloseTo(Math.sqrt(ssr / 3 / 30), 12);
  });
});
