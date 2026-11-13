// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTION } from '../src/core/xrd/peaks/detect';
import { fitPeaks, type FitOptions } from '../src/core/xrd/peaks/fit';
import { allRegionsFit, fitScore, improveFit } from '../src/core/xrd/peaks/improve';
import { generatePattern } from '../src/core/xrd/synthetic';

// Synthetic counts with Poisson-like noise: a strong peak with a shoulder 0.3° away, a single
// peak, an unresolved pair 0.4° apart (one starting guess between them) and a sharp peak.
const truth = [
  { center: 30, fwhm: 0.15, height: 3000, eta: 0.6 },
  { center: 30.3, fwhm: 0.15, height: 700, eta: 0.6 },
  { center: 33, fwhm: 0.15, height: 2000, eta: 0.6 },
  { center: 40, fwhm: 0.3, height: 1500, eta: 0.6 },
  { center: 40.4, fwhm: 0.3, height: 1200, eta: 0.6 },
  { center: 47.2, fwhm: 0.2, height: 1500, eta: 0.6 },
];
const pattern = generatePattern({
  start: 25,
  end: 50,
  step: 0.01,
  peaks: truth,
  background: { constant: 200, amplitude: 0, decay: 1 },
  noiseSeed: 7,
});
const x = pattern.twoTheta;
const y = pattern.intensity;
const guesses = [
  { center: 30, width: 0.2 },
  { center: 33, width: 0.2 },
  { center: 40.2, width: 0.5 },
  { center: 47.2, width: 0.2 },
];
const pv: FitOptions = { profile: 'pseudo-voigt', fixedEta: null };
const centres = (regions: ReturnType<typeof fitPeaks>) =>
  regions.flatMap((r) => r.peaks.map((p) => p.center));

describe('improving a peak fit until it fits', () => {
  it('recovers every true peak, starting from four guesses for six peaks', () => {
    const first = fitPeaks(x, y, guesses, pv);
    expect(allRegionsFit(first)).toBe(false);
    const result = improveFit(x, y, guesses, pv, DEFAULT_DETECTION, 0.01);
    expect(result.stopped).toBe('fits');
    expect(allRegionsFit(result.regions)).toBe(true);
    const found = centres(result.regions);
    expect(found).toHaveLength(truth.length);
    truth.forEach((t, i) => expect(Math.abs((found[i] as number) - t.center)).toBeLessThan(0.02));
    const peaks = result.regions.flatMap((r) => r.peaks);
    truth.forEach((t, i) => expect((peaks[i] as { fwhm: number }).fwhm / t.fwhm).toBeCloseTo(1, 1));
    for (const r of result.regions) expect(r.reducedChiSquared).toBeLessThan(2.5);
    expect(result.score).toBeLessThan(fitScore(x, y, first, pv));
  });

  it('changes nothing when the fit already fits (idempotent)', () => {
    const start = truth.map((t) => ({ center: t.center, width: t.fwhm }));
    const once = improveFit(x, y, start, pv, DEFAULT_DETECTION, 0.01);
    expect(once.rounds).toBe(0);
    expect(once.stopped).toBe('fits');
    const again = improveFit(
      x,
      y,
      once.regions.flatMap((r) => r.peaks.map((p) => ({ center: p.center, width: p.fwhm }))),
      pv,
      DEFAULT_DETECTION,
      0.01,
    );
    expect(again.rounds).toBe(0);
    expect(centres(again.regions)).toHaveLength(truth.length);
  });

  it('removes a duplicate peak on the same position', () => {
    const start = [
      ...truth.map((t) => ({ center: t.center, width: t.fwhm })),
      { center: 33.02, width: 0.15 },
    ];
    const result = improveFit(x, y, start, pv, DEFAULT_DETECTION, 0.01);
    expect(centres(result.regions)).toHaveLength(truth.length);
  });

  it('with Gaussian peaks on pseudo-Voigt data, offers pseudo-Voigt instead of adding tail peaks', () => {
    const exact = truth.map((t) => ({ center: t.center, width: t.fwhm }));
    const gaussian: FitOptions = { profile: 'gaussian', fixedEta: null };
    const result = improveFit(x, y, exact, gaussian, DEFAULT_DETECTION, 0.01);
    expect(result.stopped).toBe('shape');
    expect(centres(result.regions)).toHaveLength(truth.length);
    expect(result.shape?.options.profile).toBe('pseudo-voigt');
    expect(allRegionsFit(result.shape?.regions ?? [])).toBe(true);
  });

  it('with Gaussian data, keeps Gaussian and still adds the missed shoulder', () => {
    const g = generatePattern({
      start: 25,
      end: 38,
      step: 0.01,
      peaks: truth.slice(0, 3).map((t) => ({ ...t, eta: 0 })),
      background: { constant: 200, amplitude: 0, decay: 1 },
      noiseSeed: 3,
    });
    const gaussian: FitOptions = { profile: 'gaussian', fixedEta: null };
    const result = improveFit(
      g.twoTheta,
      g.intensity,
      [
        { center: 30, width: 0.2 },
        { center: 33, width: 0.2 },
      ],
      gaussian,
      DEFAULT_DETECTION,
      0.01,
    );
    expect(result.stopped).toBe('fits');
    expect(result.shape).toBeUndefined();
    const found = centres(result.regions);
    expect(found).toHaveLength(3);
    expect(found[1]).toBeCloseTo(30.3, 1);
  });

  it('does not add peaks to pure noise', () => {
    const flat = generatePattern({
      start: 25,
      end: 38,
      step: 0.01,
      peaks: [{ center: 30, fwhm: 0.15, height: 3000, eta: 0.6 }],
      background: { constant: 200, amplitude: 0, decay: 1 },
      noiseSeed: 11,
    });
    const result = improveFit(
      flat.twoTheta,
      flat.intensity,
      [{ center: 30, width: 0.2 }],
      pv,
      DEFAULT_DETECTION,
      0.01,
    );
    expect(centres(result.regions)).toHaveLength(1);
    expect(result.added).toEqual([]);
  });
});
