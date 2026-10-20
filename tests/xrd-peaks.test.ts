// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitPeaks, fitRegion, groupRegions, type FitOptions } from '../src/core/xrd/peaks/fit';
import {
  integralBreadth,
  peakArea,
  profile,
  profileWithGradient,
  type PeakParameters,
} from '../src/core/xrd/peaks/profiles';
import { braggD, braggDSigma, peakTable, toCsv } from '../src/core/xrd/peaks/table';
import { generatePattern, type SyntheticPeak } from '../src/core/xrd/synthetic';

/*
 * Known-answer tests: synthetic peaks with chosen parameters on a flat background, with seeded
 * counting noise (σ = √counts), must be recovered within the tolerances stated in each test.
 */

const STEP = 0.01;
const BACKGROUND = 200;

function pattern(peaks: SyntheticPeak[], seed: number | undefined, start = 20, end = 40) {
  return generatePattern({
    start,
    end,
    step: STEP,
    peaks,
    background: { constant: BACKGROUND, amplitude: 0, decay: 1 },
    ...(seed !== undefined && { noiseSeed: seed }),
  });
}

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('peak profiles', () => {
  const p: PeakParameters = { height: 50, center: 30, fwhm: 0.4, eta: 0.35 };

  it('closed-form area and integral breadth match numerical integration', () => {
    for (const eta of [0, 0.35, 1]) {
      const q = { ...p, eta };
      // Trapezoid rule over ±2000 FWHM (the Lorentzian tail beyond that is < 0.02 % of the area).
      const half = 2000 * q.fwhm;
      const h = q.fwhm / 200;
      let sum = 0;
      for (let x = q.center - half; x <= q.center + half; x += h) sum += profile(x, q) * h;
      expect(relative(sum, peakArea(q))).toBeLessThan(5e-4);
      expect(integralBreadth(q)).toBeCloseTo(peakArea(q) / q.height, 12);
    }
  });

  it('analytic derivatives match finite differences', () => {
    const g = new Float64Array(4);
    const x = 30.13;
    profileWithGradient(x, p, g);
    const keys = ['height', 'center', 'fwhm', 'eta'] as const;
    keys.forEach((key, j) => {
      const h = 1e-6;
      const up = profile(x, { ...p, [key]: p[key] + h });
      const down = profile(x, { ...p, [key]: p[key] - h });
      expect(g[j]).toBeCloseTo((up - down) / (2 * h), 5);
    });
  });
});

describe('peak detection', () => {
  const truth: SyntheticPeak[] = [
    { center: 23, fwhm: 0.2, height: 3000, eta: 0.5 },
    { center: 27.5, fwhm: 0.25, height: 800, eta: 0.5 },
    { center: 33, fwhm: 0.3, height: 5000, eta: 0.5 },
    { center: 37, fwhm: 0.2, height: 400, eta: 0.5 },
  ];

  it('finds every synthetic peak in noisy data and nothing else (prominence 3 %)', () => {
    const { twoTheta, intensity } = pattern(truth, 1);
    const found = detectPeaks(twoTheta, intensity, { prominencePercent: 3, minSeparationDeg: 0.1 });
    expect(found.map((f) => Math.round(f.center * 10) / 10)).toEqual([23, 27.5, 33, 37]);
    found.forEach((f, i) => {
      const t = truth[i] as SyntheticPeak;
      expect(Math.abs(f.center - t.center)).toBeLessThanOrEqual(2 * STEP);
      // Width at half prominence approximates the FWHM.
      expect(relative(f.width, t.fwhm)).toBeLessThan(0.3);
    });
  });

  it('a higher threshold drops the small peaks', () => {
    const { twoTheta, intensity } = pattern(truth, 1);
    const found = detectPeaks(twoTheta, intensity, {
      prominencePercent: 20,
      minSeparationDeg: 0.1,
    });
    expect(found.map((f) => Math.round(f.center))).toEqual([23, 33]);
  });

  it('computes topographic prominence like SciPy', () => {
    const y = Float64Array.of(0, 2, 1, 5, 1, 3, 0);
    const x = Float64Array.from(y, (_, i) => i);
    const found = detectPeaks(x, y, { prominencePercent: 0, minSeparationDeg: 0 });
    // Peak 2 at x=1: walks left to 0, right to 5 (higher) → bases 0 and 1 → prominence 1.
    expect(found.map((f) => [f.center, f.prominence])).toEqual([
      [1, 1],
      [3, 5],
      [5, 2],
    ]);
  });

  it('minimum separation keeps the more prominent of two close peaks', () => {
    const y = Float64Array.of(0, 4, 3, 5, 0, 0);
    const x = Float64Array.from(y, (_, i) => i * 0.05);
    const found = detectPeaks(x, y, { prominencePercent: 0, minSeparationDeg: 0.15 });
    expect(found).toHaveLength(1);
    expect(found[0]?.center).toBeCloseTo(0.15, 12);
  });

  it('handles 50,000 noisy points quickly', () => {
    const big = generatePattern({
      start: 5,
      end: 80,
      step: 0.0015,
      peaks: truth,
      background: { constant: 200, amplitude: 0, decay: 1 },
      noiseSeed: 2,
    });
    expect(big.twoTheta.length).toBeGreaterThan(49_000);
    const start = performance.now();
    detectPeaks(big.twoTheta, big.intensity, { prominencePercent: 3, minSeparationDeg: 0.1 });
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('fitting single noisy peaks', () => {
  const cases: [string, FitOptions, number][] = [
    ['Gaussian', { profile: 'gaussian', fixedEta: null }, 0],
    ['Lorentzian', { profile: 'lorentzian', fixedEta: null }, 1],
    ['pseudo-Voigt with η free', { profile: 'pseudo-voigt', fixedEta: null }, 0.4],
    ['pseudo-Voigt with η fixed', { profile: 'pseudo-voigt', fixedEta: 0.4 }, 0.4],
  ];

  it.each(cases)(
    '%s: centre within 0.003°, FWHM, height and area within 3 %',
    (_name, options, eta) => {
      const truth: SyntheticPeak = { center: 30.123, fwhm: 0.32, height: 4000, eta };
      const { twoTheta, intensity } = pattern([truth], 7);
      const [region] = fitPeaks(twoTheta, intensity, [{ center: 30.1, width: 0.25 }], options);
      const peak = region?.peaks[0];
      if (!region || !peak) throw new Error('no fit');
      expect(region.converged).toBe(true);
      expect(region.rSquared).toBeGreaterThan(0.99);
      expect(Math.abs(peak.center - truth.center)).toBeLessThan(0.003);
      expect(relative(peak.fwhm, truth.fwhm)).toBeLessThan(0.03);
      expect(relative(peak.height, truth.height)).toBeLessThan(0.03);
      expect(relative(peak.area, peakArea(truth))).toBeLessThan(0.03);
      expect(Math.abs(peak.eta - eta)).toBeLessThan(0.1);
      // Uncertainties are positive and the truth lies within 4σ.
      expect(peak.sigma.center).toBeGreaterThan(0);
      expect(Math.abs(peak.center - truth.center)).toBeLessThan(4 * peak.sigma.center);
      expect(Math.abs(peak.fwhm - truth.fwhm)).toBeLessThan(4 * peak.sigma.fwhm);
    },
  );

  it('noise-free data are fitted almost exactly', () => {
    const truth: SyntheticPeak = { center: 31, fwhm: 0.3, height: 1000, eta: 0.6 };
    const { twoTheta, intensity } = pattern([truth], undefined);
    const [region] = fitPeaks(twoTheta, intensity, [{ center: 30.95, width: 0.2 }], {
      profile: 'pseudo-voigt',
      fixedEta: null,
    });
    const peak = region?.peaks[0];
    expect(Math.abs((peak?.center ?? 0) - 31)).toBeLessThan(1e-3);
    expect(relative(peak?.fwhm ?? 0, 0.3)).toBeLessThan(0.01);
    expect(Math.abs((peak?.eta ?? 0) - 0.6)).toBeLessThan(0.02);
  });

  it('uncertainties are realistic: the true centre is within 2σ in most of 40 noisy repeats', () => {
    const truth: SyntheticPeak = { center: 30, fwhm: 0.3, height: 800, eta: 0.5 };
    let inside = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { twoTheta, intensity } = pattern([truth], seed, 28, 32);
      const peak = fitPeaks(twoTheta, intensity, [{ center: 30.02, width: 0.3 }], {
        profile: 'pseudo-voigt',
        fixedEta: 0.5,
      })[0]?.peaks[0];
      if (peak && Math.abs(peak.center - truth.center) < 2 * peak.sigma.center) inside++;
    }
    // About 95 % expected for well-estimated σ; allow for the small sample.
    expect(inside).toBeGreaterThanOrEqual(33);
  });
});

describe('two overlapping peaks', () => {
  const truth: SyntheticPeak[] = [
    { center: 30.0, fwhm: 0.3, height: 3000, eta: 0.5 },
    { center: 30.25, fwhm: 0.3, height: 1800, eta: 0.5 },
  ];

  it('are grouped into one region', () => {
    const regions = groupRegions(
      [
        { center: 30, width: 0.3 },
        { center: 30.25, width: 0.3 },
        { center: 35, width: 0.3 },
      ],
      20,
      40,
    );
    expect(regions.map((r) => r.peaks.length)).toEqual([2, 1]);
  });

  it('are both recovered: centres within 0.005°, FWHM and heights within 5 %', () => {
    const { twoTheta, intensity } = pattern(truth, 3);
    const regions = fitPeaks(
      twoTheta,
      intensity,
      [
        { center: 29.98, width: 0.25 },
        { center: 30.28, width: 0.25 },
      ],
      {
        profile: 'pseudo-voigt',
        fixedEta: null,
      },
    );
    expect(regions).toHaveLength(1);
    const peaks = regions[0]?.peaks ?? [];
    expect(peaks).toHaveLength(2);
    peaks.forEach((peak, i) => {
      const t = truth[i] as SyntheticPeak;
      expect(Math.abs(peak.center - t.center)).toBeLessThan(0.005);
      expect(relative(peak.fwhm, t.fwhm)).toBeLessThan(0.05);
      expect(relative(peak.height, t.height)).toBeLessThan(0.05);
    });
  });
});

describe('peak table', () => {
  it('Bragg d-spacing round-trips and its uncertainty matches a finite difference', () => {
    const lambda = 1.54059292;
    const d = 2.5;
    const twoTheta = (2 * Math.asin(lambda / (2 * d)) * 180) / Math.PI;
    expect(braggD(twoTheta, lambda)).toBeCloseTo(d, 12);
    const h = 1e-5;
    const numeric = Math.abs(braggD(twoTheta + h, lambda) - braggD(twoTheta - h, lambda)) / (2 * h);
    expect(braggDSigma(twoTheta, 0.01, lambda)).toBeCloseTo(numeric * 0.01, 9);
  });

  it('builds rows with radians, relative intensity and CSV output', () => {
    const { twoTheta, intensity } = pattern(
      [
        { center: 25, fwhm: 0.3, height: 1000, eta: 0.5 },
        { center: 35, fwhm: 0.3, height: 4000, eta: 0.5 },
      ],
      4,
    );
    const regions = fitPeaks(
      twoTheta,
      intensity,
      [
        { center: 25, width: 0.3 },
        { center: 35, width: 0.3 },
      ],
      {
        profile: 'pseudo-voigt',
        fixedEta: null,
      },
    );
    const rows = peakTable(regions, 1.54059292);
    expect(rows.map((r) => Math.round(r.twoTheta))).toEqual([25, 35]);
    expect(rows[1]?.relativeIntensity).toBe(100);
    expect(rows[0]?.relativeIntensity).toBeCloseTo(25, -0.5);
    expect(rows[0]?.fwhmRad).toBeCloseTo(((rows[0]?.fwhm ?? 0) * Math.PI) / 180, 12);
    const csv = toCsv(rows, [
      { header: '2θ (°)', value: (r) => r.twoTheta },
      { header: 'note, quoted', value: () => 'a "b"' },
    ]);
    expect(csv.split('\r\n')[0]).toBe('2θ (°),"note, quoted"');
    expect(csv.split('\r\n')[1]).toMatch(/^2\d\.\d+,"a ""b"""$/);
  });
});

describe('performance', () => {
  it('fits 30 peaks in well under a few seconds', () => {
    const truth: SyntheticPeak[] = Array.from({ length: 30 }, (_, i) => ({
      center: 12 + i * 2.2 + (i % 3 === 0 ? 0 : 0.3),
      fwhm: 0.15 + (i % 5) * 0.05,
      height: 500 + ((i * 937) % 4000),
      eta: 0.5,
    }));
    const { twoTheta, intensity } = generatePattern({
      start: 10,
      end: 80,
      step: 0.0015,
      peaks: truth,
      background: { constant: 200, amplitude: 0, decay: 1 },
      noiseSeed: 9,
    });
    // Start from rough positions (detection on raw noisy data is tested separately).
    const guesses = truth.map((t, i) => ({
      center: t.center + (i % 2 ? 0.02 : -0.02),
      width: t.fwhm * 0.8,
    }));
    const start = performance.now();
    const regions = fitPeaks(twoTheta, intensity, guesses, {
      profile: 'pseudo-voigt',
      fixedEta: null,
    });
    expect(performance.now() - start).toBeLessThan(3000);
    const fitted = regions.flatMap((r) => r.peaks);
    expect(fitted).toHaveLength(30);
    fitted.forEach((peak, i) =>
      expect(Math.abs(peak.center - (truth[i] as SyntheticPeak).center)).toBeLessThan(0.005),
    );
  });

  it('reports too few points instead of fitting nonsense', () => {
    const x = Float64Array.of(1, 2, 3, 4, 5);
    const region = fitRegion(
      x,
      x,
      { start: 1, end: 5, peaks: [{ center: 3, width: 1 }] },
      { profile: 'gaussian', fixedEta: null },
    );
    expect(region.messages[0]?.text).toContain('Too few data points');
  });
});
