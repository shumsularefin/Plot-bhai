// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fitPeaks, kAlpha2Copy, regionValue } from '../src/core/xrd/peaks/fit';
import { ANODES } from '../src/core/xrd/radiation';
import { generatePattern } from '../src/core/xrd/synthetic';

const pair = { lambda1: ANODES.Cu.kAlpha1, lambda2: ANODES.Cu.kAlpha2, ratio: 0.5 };
const peaks = [
  { center: 28.9, fwhm: 0.12, height: 5000, eta: 0.5 },
  { center: 76.5, fwhm: 0.15, height: 3000, eta: 0.5 },
];
const pattern = generatePattern({
  start: 25,
  end: 80,
  step: 0.01,
  peaks,
  background: { constant: 100, amplitude: 0, decay: 1 },
  kAlpha2: pair,
});
const guesses = peaks.map((p) => ({ center: p.center, width: 0.2 }));
const options = { profile: 'pseudo-voigt' as const, fixedEta: null };

describe('fitting data that still contain Kα2', () => {
  it('recovers the Kα1 position, width and height when each peak is fitted as a Kα1 + Kα2 pair', () => {
    const regions = fitPeaks(pattern.twoTheta, pattern.intensity, guesses, {
      ...options,
      kAlpha2: pair,
    });
    const fitted = regions.flatMap((r) => r.peaks);
    expect(fitted).toHaveLength(2);
    fitted.forEach((f, i) => {
      const truth = peaks[i] as (typeof peaks)[number];
      expect(f.center).toBeCloseTo(truth.center, 3);
      expect(f.fwhm / truth.fwhm).toBeCloseTo(1, 2);
      expect(f.height / truth.height).toBeCloseTo(1, 2);
    });
    // The drawn model includes the Kα2 partner.
    const region = regions[1] as (typeof regions)[number];
    const partner = kAlpha2Copy(fitted[1] as (typeof fitted)[number], pair);
    expect(partner).not.toBeNull();
    expect(regionValue(region, partner?.peak.center as number)).toBeGreaterThan(1000);
  });

  it('gives too broad a width at high angle when Kα2 is ignored', () => {
    const regions = fitPeaks(pattern.twoTheta, pattern.intensity, guesses, options);
    const high = regions.flatMap((r) => r.peaks).find((p) => p.center > 70);
    expect((high?.fwhm ?? 0) / 0.15).toBeGreaterThan(1.15);
  });

  it('places the Kα2 partner by Bragg’s law: sin θ2 = (λ2/λ1) sin θ1', () => {
    const copy = kAlpha2Copy({ height: 10, center: 76.5, fwhm: 0.1, eta: 0.5 }, pair);
    const s = (pair.lambda2 / pair.lambda1) * Math.sin((76.5 * Math.PI) / 360);
    expect(copy?.peak.center).toBeCloseTo((360 / Math.PI) * Math.asin(s), 10);
    expect(copy?.peak.height).toBe(5);
    // d(2θ2)/d(2θ1) against a numerical derivative.
    const h = 1e-5;
    const ahead = kAlpha2Copy({ height: 10, center: 76.5 + h, fwhm: 0.1, eta: 0.5 }, pair);
    const numeric = ((ahead?.peak.center as number) - (copy?.peak.center as number)) / h;
    expect(copy?.dCenter).toBeCloseTo(numeric, 5);
  });
});
