// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lnGamma } from '../src/core/math/gamma';
import { fitRegion, type FitOptions } from '../src/core/xrd/peaks/fit';
import {
  derivedGradients,
  equivalentEta,
  integralBreadth,
  parameterCount,
  peakArea,
  pearsonVIIAreaFactor,
  peakFromVector,
  profile,
  profileWithGradient,
  type FitProfileKind,
  type PeakParameters,
} from '../src/core/xrd/peaks/profiles';
import { seededRandom } from '../src/core/xrd/synthetic';

/*
 * Stage 16b validation of the Pearson VII and split pseudo-Voigt profiles (docs/validation.md):
 * (1) known answers: peaks generated with chosen parameters are recovered by the fit;
 * (2) independent checks: closed-form areas against numerical integration, exact limits
 *     (m = 1 is a Lorentzian, m → ∞ a Gaussian, wL = wR the symmetric pseudo-Voigt), analytic
 *     derivatives against finite differences, ln Γ against factorials and the duplication formula;
 * (3) invariance: shifting the angle axis or scaling the intensities changes only what it should.
 */

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

const pearson = (m: number, extra: Partial<PeakParameters> = {}): PeakParameters => ({
  height: 100,
  center: 30,
  fwhm: 0.3,
  eta: equivalentEta(m),
  shape: { kind: 'pearson-vii', m },
  ...extra,
});

const split = (fwhmLeft: number, fwhmRight: number, eta: number): PeakParameters => ({
  height: 100,
  center: 30,
  fwhm: (fwhmLeft + fwhmRight) / 2,
  eta,
  shape: { kind: 'split-pseudo-voigt', fwhmLeft, fwhmRight },
});

/**
 * ∫ f dx over one side of the peak, from x0 outwards, with x = x0 ± s·tan t (t from 0 to π/2),
 * so the long tails are integrated in full. Open midpoint rule on t (the integrand need not
 * vanish at t = π/2: for a Lorentzian it is constant).
 */
function sideIntegral(p: PeakParameters, sign: 1 | -1, scale: number): number {
  const n = 200000;
  const h = Math.PI / 2 / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * h;
    const c = Math.cos(t);
    sum += profile(p.center + sign * scale * Math.tan(t), p) * (scale / (c * c));
  }
  return sum * h;
}

const numericArea = (p: PeakParameters) =>
  sideIntegral(p, -1, p.fwhm / 2) + sideIntegral(p, 1, p.fwhm / 2);

/** Values from Python's math.lgamma, made by tests/fixtures/make_pearson_area.py. */
const python = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/pearson-area-python.json'), 'utf8'),
) as { lnGamma: [number, number][]; pearsonAreaFactor: [number, number][] };

describe('ln Γ', () => {
  it("agrees with Python's math.lgamma (an independent implementation)", () => {
    expect(python.lnGamma.length).toBeGreaterThan(10);
    for (const [z, value] of python.lnGamma) {
      expect(Math.abs(lnGamma(z) - value)).toBeLessThan(1e-13 * Math.max(1, Math.abs(value)));
    }
  });

  it('gives the Pearson VII area factor that Python computes from math.lgamma', () => {
    for (const [m, value] of python.pearsonAreaFactor) {
      expect(relative(pearsonVIIAreaFactor(m), value)).toBeLessThan(1e-13);
    }
  });

  it('matches (n − 1)! for n = 1 … 20', () => {
    let factorial = 1;
    for (let n = 1; n <= 20; n++) {
      if (n > 1) factorial *= n - 1;
      expect(Math.abs(lnGamma(n) - Math.log(factorial))).toBeLessThan(
        1e-12 * Math.max(1, Math.log(factorial)),
      );
    }
  });

  it('gives Γ(½) = √π and Γ(3/2) = √π / 2', () => {
    expect(Math.exp(lnGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 13);
    expect(Math.exp(lnGamma(1.5))).toBeCloseTo(Math.sqrt(Math.PI) / 2, 13);
  });

  it('satisfies the duplication formula Γ(z) Γ(z + ½) = 2^(1 − 2z) √π Γ(2z)', () => {
    for (const z of [0.1, 0.3, 0.55, 0.8, 1.7, 3.2, 7.9, 24.5]) {
      const left = lnGamma(z) + lnGamma(z + 0.5);
      const right = (1 - 2 * z) * Math.LN2 + 0.5 * Math.log(Math.PI) + lnGamma(2 * z);
      expect(Math.abs(left - right)).toBeLessThan(1e-12 * Math.max(1, Math.abs(left)));
    }
  });
});

describe('Pearson VII profile', () => {
  it('has height A at x0 and A/2 at x0 ± w/2 for any m', () => {
    for (const m of [0.6, 1, 1.5, 3, 10, 50]) {
      const p = pearson(m);
      expect(profile(p.center, p)).toBeCloseTo(p.height, 12);
      expect(profile(p.center - p.fwhm / 2, p)).toBeCloseTo(p.height / 2, 10);
      expect(profile(p.center + p.fwhm / 2, p)).toBeCloseTo(p.height / 2, 10);
    }
  });

  it('is exactly a Lorentzian at m = 1', () => {
    const p = pearson(1);
    const lorentzian: PeakParameters = { height: 100, center: 30, fwhm: 0.3, eta: 1 };
    for (let x = 28; x <= 32; x += 0.0137) {
      expect(Math.abs(profile(x, p) - profile(x, lorentzian))).toBeLessThan(1e-12);
    }
    expect(equivalentEta(1)).toBeCloseTo(1, 12);
    expect(peakArea(p)).toBeCloseTo(peakArea(lorentzian), 10);
  });

  it('tends to a Gaussian as m grows', () => {
    const gaussian: PeakParameters = { height: 100, center: 30, fwhm: 0.3, eta: 0 };
    let previous = Infinity;
    for (const m of [10, 100, 1000, 10000]) {
      let worst = 0;
      for (let x = 29; x <= 31; x += 0.001) {
        worst = Math.max(worst, Math.abs(profile(x, pearson(m)) - profile(x, gaussian)));
      }
      expect(worst).toBeLessThan(previous);
      previous = worst;
    }
    expect(previous).toBeLessThan(0.01); // m = 10 000: within 0.01 % of the height
    expect(relative(peakArea(pearson(1e5)), peakArea(gaussian))).toBeLessThan(1e-4);
    expect(equivalentEta(1e5)).toBeLessThan(1e-3);
  });

  it('closed-form area matches numerical integration', () => {
    for (const m of [1, 1.3, 2, 5, 20]) {
      const p = pearson(m);
      expect(relative(numericArea(p), peakArea(p))).toBeLessThan(1e-7);
      expect(integralBreadth(p)).toBeCloseTo(peakArea(p) / p.height, 12);
    }
  });

  it('equivalent η falls from 1 at m = 1 towards 0 and is capped for m < 1', () => {
    let previous = 1.0000001;
    for (const m of [1, 1.2, 1.5, 2, 3, 5, 10, 50]) {
      const eta = equivalentEta(m);
      expect(eta).toBeLessThan(previous);
      expect(eta).toBeGreaterThanOrEqual(0);
      previous = eta;
    }
    expect(equivalentEta(0.7)).toBe(1);
  });
});

describe('split pseudo-Voigt profile', () => {
  it('equals the symmetric pseudo-Voigt when the two widths are equal', () => {
    const p = split(0.3, 0.3, 0.4);
    const symmetric: PeakParameters = { height: 100, center: 30, fwhm: 0.3, eta: 0.4 };
    for (let x = 28; x <= 32; x += 0.0137) {
      expect(profile(x, p)).toBe(profile(x, symmetric));
    }
    expect(peakArea(p)).toBeCloseTo(peakArea(symmetric), 12);
  });

  it('is half height at x0 − wL/2 and x0 + wR/2, so its FWHM is (wL + wR)/2', () => {
    const p = split(0.2, 0.5, 0.3);
    expect(profile(30 - 0.1, p)).toBeCloseTo(50, 10);
    expect(profile(30 + 0.25, p)).toBeCloseTo(50, 10);
    expect(p.fwhm).toBeCloseTo(0.35, 15);
  });

  it('closed-form area matches numerical integration of each side', () => {
    for (const [wl, wr, eta] of [
      [0.2, 0.5, 0],
      [0.2, 0.5, 0.3],
      [0.6, 0.15, 1],
    ] as const) {
      const p = split(wl, wr, eta);
      const numeric = sideIntegral(p, -1, wl / 2) + sideIntegral(p, 1, wr / 2);
      expect(relative(numeric, peakArea(p))).toBeLessThan(1e-7);
    }
  });
});

/** Parameter vector of a peak, in the layout of parameterCount. */
function vectorOf(kind: FitProfileKind, p: PeakParameters): number[] {
  if (p.shape?.kind === 'pearson-vii') return [p.height, p.center, p.fwhm, p.shape.m];
  if (p.shape?.kind === 'split-pseudo-voigt')
    return [p.height, p.center, p.shape.fwhmLeft, p.shape.fwhmRight, p.eta];
  expect(parameterCount(kind)).toBe(4);
  return [p.height, p.center, p.fwhm, p.eta];
}

const SHAPES: [FitProfileKind, PeakParameters][] = [
  ['pseudo-voigt', { height: 100, center: 30, fwhm: 0.3, eta: 0.35 }],
  ['pearson-vii', pearson(0.8)],
  ['pearson-vii', pearson(1.7)],
  ['pearson-vii', pearson(12)],
  ['split-pseudo-voigt', split(0.2, 0.45, 0.35)],
];

describe('derivatives used by the fitter', () => {
  it.each(SHAPES)('%s: analytic profile gradient matches central differences', (kind, p) => {
    const v = vectorOf(kind, p);
    const g = new Float64Array(v.length);
    for (const x of [29.5, 29.88, 29.97, 30.02, 30.11, 30.6]) {
      const value = profileWithGradient(x, p, g);
      expect(value).toBeCloseTo(profile(x, p), 12);
      v.forEach((_, j) => {
        const h = 1e-6 * Math.max(1, Math.abs(v[j] as number));
        const up = v.slice();
        const down = v.slice();
        up[j] = (up[j] as number) + h;
        down[j] = (down[j] as number) - h;
        const numeric =
          (profile(x, peakFromVector(kind, up, 0)) - profile(x, peakFromVector(kind, down, 0))) /
          (2 * h);
        expect(Math.abs((g[j] as number) - numeric)).toBeLessThan(
          1e-5 * Math.max(1, Math.abs(numeric)),
        );
      });
    }
  });

  it.each(SHAPES)(
    '%s: gradients of FWHM, η, area and breadth match central differences',
    (kind, p) => {
      const v = vectorOf(kind, p);
      const gradients = derivedGradients(peakFromVector(kind, v, 0));
      const quantities = {
        fwhm: (q: PeakParameters) => q.fwhm,
        eta: (q: PeakParameters) => q.eta,
        area: peakArea,
        breadth: integralBreadth,
      };
      for (const [name, f] of Object.entries(quantities) as [
        keyof typeof quantities,
        (q: PeakParameters) => number,
      ][]) {
        v.forEach((_, j) => {
          const h = 1e-6 * Math.max(1, Math.abs(v[j] as number));
          const up = v.slice();
          const down = v.slice();
          up[j] = (up[j] as number) + h;
          down[j] = (down[j] as number) - h;
          const numeric =
            (f(peakFromVector(kind, up, 0)) - f(peakFromVector(kind, down, 0))) / (2 * h);
          expect(Math.abs((gradients[name][j] as number) - numeric)).toBeLessThan(
            1e-5 * Math.max(1, Math.abs(numeric)),
          );
        });
      }
    },
  );
});

/** A pattern of one peak on a flat background of 200 counts with seeded counting noise. */
function noisyPattern(peak: PeakParameters, seed: number | null, shift = 0, scale = 1) {
  const random = seed === null ? null : seededRandom(seed);
  const x = new Float64Array(601);
  const y = new Float64Array(601);
  for (let i = 0; i < x.length; i++) {
    x[i] = 28.5 + i * 0.005 + shift;
    const mean = 200 + profile(x[i] as number, { ...peak, center: peak.center + shift });
    let noise = 0;
    if (random) {
      // Box–Muller normal deviate, σ = √mean (counting statistics).
      const u = Math.max(1e-12, random());
      noise = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()) * Math.sqrt(mean);
    }
    y[i] = scale * (mean + noise);
  }
  return { x, y };
}

function fitOne(
  kind: FitProfileKind,
  peak: PeakParameters,
  seed: number | null,
  shift = 0,
  scale = 1,
) {
  const { x, y } = noisyPattern(peak, seed, shift, scale);
  const options: FitOptions = { profile: kind, fixedEta: null };
  const region = fitRegion(
    x,
    y,
    { start: 29 + shift, end: 31 + shift, peaks: [{ center: 30.03 + shift, width: 0.25 }] },
    options,
  );
  const fitted = region.peaks[0];
  if (!fitted) throw new Error('no fit');
  return { region, fitted };
}

describe('fitting Pearson VII and split pseudo-Voigt peaks', () => {
  it('recovers a noise-free Pearson VII almost exactly', () => {
    const truth = pearson(1.8, { height: 3000 });
    const { region, fitted } = fitOne('pearson-vii', truth, null);
    expect(region.converged).toBe(true);
    expect(Math.abs(fitted.center - 30)).toBeLessThan(1e-6);
    expect(relative(fitted.fwhm, 0.3)).toBeLessThan(1e-5);
    expect(relative(fitted.shape?.kind === 'pearson-vii' ? fitted.shape.m : 0, 1.8)).toBeLessThan(
      1e-4,
    );
    expect(relative(fitted.area, peakArea(truth))).toBeLessThan(1e-5);
  });

  it('recovers a noisy Pearson VII within 4σ, with m and FWHM within 5 %', () => {
    const truth = pearson(2.5, { height: 3000 });
    for (const seed of [3, 11, 29]) {
      const { fitted } = fitOne('pearson-vii', truth, seed);
      const m = fitted.shape?.kind === 'pearson-vii' ? fitted.shape.m : NaN;
      const mSigma = fitted.sigma.shape?.kind === 'pearson-vii' ? fitted.sigma.shape.m : NaN;
      expect(relative(m, 2.5)).toBeLessThan(0.05);
      expect(Math.abs(m - 2.5)).toBeLessThan(4 * mSigma);
      expect(relative(fitted.fwhm, 0.3)).toBeLessThan(0.05);
      expect(Math.abs(fitted.fwhm - 0.3)).toBeLessThan(4 * fitted.sigma.fwhm);
      expect(relative(fitted.area, peakArea(truth))).toBeLessThan(0.03);
      expect(Math.abs(fitted.area - peakArea(truth))).toBeLessThan(4 * fitted.areaSigma);
    }
  });

  it('recovers a noise-free split pseudo-Voigt almost exactly', () => {
    const truth = { ...split(0.18, 0.4, 0.45), height: 3000 };
    const { fitted } = fitOne('split-pseudo-voigt', truth, null);
    const shape = fitted.shape?.kind === 'split-pseudo-voigt' ? fitted.shape : null;
    expect(relative(shape?.fwhmLeft ?? 0, 0.18)).toBeLessThan(1e-5);
    expect(relative(shape?.fwhmRight ?? 0, 0.4)).toBeLessThan(1e-5);
    expect(Math.abs(fitted.eta - 0.45)).toBeLessThan(1e-5);
    expect(relative(fitted.fwhm, 0.29)).toBeLessThan(1e-5);
  });

  it('recovers a noisy split pseudo-Voigt within 4σ', () => {
    const truth = { ...split(0.18, 0.4, 0.45), height: 3000 };
    for (const seed of [5, 17]) {
      const { fitted } = fitOne('split-pseudo-voigt', truth, seed);
      const shape = fitted.shape?.kind === 'split-pseudo-voigt' ? fitted.shape : null;
      const sigma = fitted.sigma.shape?.kind === 'split-pseudo-voigt' ? fitted.sigma.shape : null;
      if (!shape || !sigma) throw new Error('no shape');
      expect(Math.abs(shape.fwhmLeft - 0.18)).toBeLessThan(4 * sigma.fwhmLeft);
      expect(Math.abs(shape.fwhmRight - 0.4)).toBeLessThan(4 * sigma.fwhmRight);
      expect(Math.abs(fitted.fwhm - 0.29)).toBeLessThan(4 * fitted.sigma.fwhm);
      expect(Math.abs(fitted.eta - 0.45)).toBeLessThan(4 * fitted.sigma.eta);
    }
  });

  it.each([
    ['pearson-vii', pearson(2.2, { height: 3000 })],
    ['split-pseudo-voigt', { ...split(0.2, 0.35, 0.5), height: 3000 }],
  ] as [FitProfileKind, PeakParameters][])(
    '%s: shifting 2θ moves only the centre; scaling the counts scales only the heights',
    (kind, truth) => {
      const base = fitOne(kind, truth, 8).fitted;
      const shifted = fitOne(kind, truth, 8, 1.25).fitted;
      const scaled = fitOne(kind, truth, 8, 0, 3).fitted;
      expect(shifted.center - base.center).toBeCloseTo(1.25, 5);
      expect(relative(shifted.fwhm, base.fwhm)).toBeLessThan(1e-5);
      expect(relative(shifted.height, base.height)).toBeLessThan(1e-5);
      expect(relative(scaled.height, 3 * base.height)).toBeLessThan(1e-5);
      expect(relative(scaled.fwhm, base.fwhm)).toBeLessThan(1e-5);
      expect(Math.abs(scaled.eta - base.eta)).toBeLessThan(1e-5);
    },
  );
});
