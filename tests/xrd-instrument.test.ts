// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  correctPeaks,
  correctWidth,
  RESOLUTION_LIMIT_RATIO,
  type CorrectionMethod,
} from '../src/core/xrd/instrument/correction';
import {
  fitInstrumentCurve,
  gsasToCaglioti,
  instrumentWidth,
  type InstrumentCurve,
} from '../src/core/xrd/instrument/curve';
import { splitVoigt, tchEta, tchFwhm, tchRho } from '../src/core/xrd/instrument/voigt';
import { detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitPeaks, fitRegion, type FitOptions } from '../src/core/xrd/peaks/fit';
import { generatePattern, seededRandom, type SyntheticPeak } from '../src/core/xrd/synthetic';

/*
 * Known-answer tests: sample peaks with a chosen width are broadened by a chosen instrument
 * function (by numerical convolution), fitted like real data, and corrected. The corrected
 * width must match the chosen sample width within the stated tolerance.
 */

const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const DEG = Math.PI / 180;

/** Fine grid for numerical convolution: u_k = k · H for |k| ≤ K, degrees. */
const H = 0.005;
const K = 3000;
const grid = Float64Array.from({ length: 2 * K + 1 }, (_, k) => (k - K) * H);

/** Area-normalised Gaussian and Lorentzian with FWHM w (degrees). */
const gaussian = (w: number) =>
  grid.map(
    (u) => (2 / w) * Math.sqrt(Math.LN2 / Math.PI) * Math.exp((-4 * Math.LN2 * u * u) / (w * w)),
  );
const lorentzian = (w: number) => grid.map((u) => w / (2 * Math.PI) / (u * u + (w * w) / 4));
const delta = () => grid.map((_, k) => (k === K ? 1 / H : 0));

/** Discrete convolution (a ⊗ b)(u_j) = Σ_k a(u_k) b(u_j − u_k) H on the same grid. */
function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let j = 0; j < a.length; j++) {
    let s = 0;
    const lo = Math.max(0, j - K);
    const hi = Math.min(a.length - 1, j + K);
    for (let k = lo; k <= hi; k++) s += (a[k] as number) * (b[j - k + K] as number);
    out[j] = s * H;
  }
  return out;
}

/** FWHM of a sampled single-peaked profile, with linear interpolation at half maximum. */
function measuredFwhm(f: Float64Array): number {
  const half = (f[K] as number) / 2;
  let k = K;
  while ((f[k + 1] as number) > half) k++;
  const a = f[k] as number;
  const b = f[k + 1] as number;
  return 2 * (grid[k] as number) + 2 * H * ((a - half) / (a - b));
}

/** Data like a diffractometer scan: profile × area on a flat background, with counting noise. */
function scan(shape: Float64Array, center: number, area: number, seed: number) {
  const random = seededRandom(seed);
  const x: number[] = [];
  const y: number[] = [];
  // Every second grid point (step 0.01°) within ±3°.
  for (let k = K - 600; k <= K + 600; k += 2) {
    const mean = 100 + area * (shape[k] as number);
    const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    x.push(center + (grid[k] as number));
    y.push(Math.round(mean + Math.sqrt(mean) * normal));
  }
  return { x: Float64Array.from(x), y: Float64Array.from(y) };
}

function fitOne(shape: Float64Array, center: number, options: FitOptions, seed = 1) {
  const { x, y } = scan(shape, center, 6000, seed);
  const region = fitRegion(
    x,
    y,
    { start: center - 3, end: center + 3, peaks: [{ center, width: 0.3 }] },
    options,
  );
  return region.peaks[0] as { fwhm: number; eta: number; sigma: { fwhm: number } };
}

describe('Thompson–Cox–Hastings relations', () => {
  it('η runs from 0 to 1 and ρ inverts it', () => {
    expect(tchEta(0)).toBe(0);
    expect(tchEta(1)).toBeCloseTo(1, 5);
    for (const eta of [0, 0.1, 0.37, 0.8, 1]) expect(tchEta(tchRho(eta))).toBeCloseTo(eta, 10);
  });

  it('pure shapes keep their width, and splitting then joining returns the total', () => {
    expect(tchFwhm(0.2, 0)).toBeCloseTo(0.2, 12);
    expect(tchFwhm(0, 0.2)).toBeCloseTo(0.2, 12);
    for (const eta of [0, 0.3, 0.6, 1]) {
      const { gaussian: g, lorentzian: l } = splitVoigt(0.25, eta);
      expect(tchFwhm(g, l)).toBeCloseTo(0.25, 9);
    }
    expect(splitVoigt(0.25, 0).lorentzian).toBeCloseTo(0, 9);
    expect(splitVoigt(0.25, 1).gaussian).toBeCloseTo(0, 6);
  });

  it('TCH total width is within 1 % of a numerically convolved Voigt', () => {
    for (const [g, l] of [
      [0.1, 0.05],
      [0.08, 0.08],
      [0.04, 0.12],
    ] as const) {
      const exact = measuredFwhm(convolve(gaussian(g), lorentzian(l)));
      expect(relative(tchFwhm(g, l), exact)).toBeLessThan(0.01);
    }
  });
});

describe('width correction formulas', () => {
  it('invert the exact convolution laws', () => {
    expect(correctWidth(Math.hypot(0.3, 0.1), 0.1, 'gaussian').width).toBeCloseTo(0.3, 12);
    expect(correctWidth(0.4, 0.1, 'lorentzian').width).toBeCloseTo(0.3, 12);
    // Voigt with pure Gaussian or pure Lorentzian shapes reduces to the matching formula.
    expect(correctWidth(Math.hypot(0.3, 0.1), 0.1, 'voigt', 0, 0).width).toBeCloseTo(0.3, 6);
    expect(correctWidth(0.4, 0.1, 'voigt', 1, 1).width).toBeCloseTo(0.3, 6);
  });

  it('give zero when the instrument is as wide as the peak', () => {
    for (const method of ['gaussian', 'lorentzian', 'voigt'] as CorrectionMethod[]) {
      expect(correctWidth(0.1, 0.1, method, 0.5, 0.5).width).toBe(0);
      expect(correctWidth(0.1, 0.12, method, 0.5, 0.5).width).toBe(0);
    }
  });
});

describe('known instrument broadening is removed (numerical convolution, noisy fits)', () => {
  const center = 40;

  it('Gaussian sample ⊗ Gaussian instrument, Gaussian correction: within 2 %', () => {
    const sample = 0.25;
    const instrument = 0.1;
    const peak = fitOne(convolve(gaussian(sample), gaussian(instrument)), center, {
      profile: 'gaussian',
      fixedEta: null,
    });
    expect(relative(correctWidth(peak.fwhm, instrument, 'gaussian').width, sample)).toBeLessThan(
      0.02,
    );
  });

  it('Lorentzian sample ⊗ Lorentzian instrument, Lorentzian correction: within 3 %', () => {
    const sample = 0.2;
    const instrument = 0.08;
    const peak = fitOne(convolve(lorentzian(sample), lorentzian(instrument)), center, {
      profile: 'lorentzian',
      fixedEta: null,
    });
    expect(relative(correctWidth(peak.fwhm, instrument, 'lorentzian').width, sample)).toBeLessThan(
      0.03,
    );
  });

  it('Voigt sample ⊗ Voigt instrument, approximate Voigt correction: within 3 %', () => {
    const pv: FitOptions = { profile: 'pseudo-voigt', fixedEta: null };
    const sampleShape = convolve(gaussian(0.12), lorentzian(0.15));
    const instrumentShape = convolve(gaussian(0.07), lorentzian(0.03));
    const trueSample = measuredFwhm(sampleShape);
    const ins = fitOne(instrumentShape, center, pv, 2);
    const obs = fitOne(convolve(sampleShape, instrumentShape), center, pv, 3);
    const corrected = correctWidth(obs.fwhm, ins.fwhm, 'voigt', obs.eta, ins.eta).width;
    expect(relative(corrected, trueSample)).toBeLessThan(0.03);
    // The pure-shape formulas bracket the answer for a mixed shape and both miss it here.
    const g = correctWidth(obs.fwhm, ins.fwhm, 'gaussian').width;
    const l = correctWidth(obs.fwhm, ins.fwhm, 'lorentzian').width;
    expect(l).toBeLessThan(corrected);
    expect(g).toBeGreaterThan(corrected);
  });

  it('with no instrument broadening, the correction leaves the width alone', () => {
    const peak = fitOne(convolve(gaussian(0.2), delta()), center, {
      profile: 'gaussian',
      fixedEta: null,
    });
    expect(relative(peak.fwhm, 0.2)).toBeLessThan(0.02);
  });
});

describe('instrument curves', () => {
  const truth = { u: 0.004, v: -0.002, w: 0.003 };
  const angles = [21.4, 30.4, 37.4, 43.5, 49.0, 54.1, 63.2, 67.5, 71.6, 75.6, 79.4];
  const widthAt = (tt: number) => {
    const t = Math.tan((tt / 2) * DEG);
    return Math.sqrt(truth.u * t * t + truth.v * t + truth.w);
  };

  it('a Caglioti fit to exact points recovers U, V and W', () => {
    const fit = fitInstrumentCurve(
      angles.map((twoTheta) => ({ twoTheta, fwhm: widthAt(twoTheta) })),
      'caglioti',
    );
    expect(fit).not.toBeNull();
    const curve = fit?.curve as Extract<InstrumentCurve, { kind: 'caglioti' }>;
    expect(curve.u).toBeCloseTo(truth.u, 10);
    expect(curve.v).toBeCloseTo(truth.v, 10);
    expect(curve.w).toBeCloseTo(truth.w, 10);
    expect(fit?.rms).toBeLessThan(1e-10);
  });

  it('a quadratic fit to points on a parabola is exact; with n = m points no σ is given', () => {
    const f = (x: number) => 0.05 + 0.001 * x + 2e-5 * x * x;
    const fit = fitInstrumentCurve(
      [20, 40, 60, 80].map((twoTheta) => ({ twoTheta, fwhm: f(twoTheta) })),
      'quadratic',
    );
    expect(instrumentWidth(fit?.curve as InstrumentCurve, 50).fwhm).toBeCloseTo(f(50), 10);
    const exact = fitInstrumentCurve(
      [20, 50, 80].map((twoTheta) => ({ twoTheta, fwhm: f(twoTheta) })),
      'quadratic',
    );
    expect(exact?.messages.some((m) => m.level === 'warning')).toBe(true);
    expect(instrumentWidth(exact?.curve as InstrumentCurve, 50).sigma).toBe(0);
    expect(fitInstrumentCurve([{ twoTheta: 30, fwhm: 0.1 }], 'linear')).toBeNull();
  });

  it('linear-fit σ matches the textbook straight-line formula', () => {
    const points = [
      { twoTheta: 20, fwhm: 0.081 },
      { twoTheta: 40, fwhm: 0.089 },
      { twoTheta: 60, fwhm: 0.104 },
      { twoTheta: 80, fwhm: 0.108 },
      { twoTheta: 100, fwhm: 0.123 },
    ];
    const fit = fitInstrumentCurve(points, 'linear');
    const n = points.length;
    const mean = points.reduce((s, p) => s + p.twoTheta, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.twoTheta - mean) ** 2, 0);
    const ybar = points.reduce((s, p) => s + p.fwhm, 0) / n;
    const slope = points.reduce((s, p) => s + (p.twoTheta - mean) * (p.fwhm - ybar), 0) / sxx;
    const ssr = points.reduce((s, p) => s + (p.fwhm - ybar - slope * (p.twoTheta - mean)) ** 2, 0);
    const s2 = ssr / (n - 2);
    const at = 90;
    const expected = Math.sqrt(s2 * (1 / n + (at - mean) ** 2 / sxx));
    const got = instrumentWidth(fit?.curve as InstrumentCurve, at);
    expect(got.fwhm).toBeCloseTo(ybar + slope * (at - mean), 12);
    expect(got.sigma).toBeCloseTo(expected, 12);
  });

  it('a curve with negative FWHM² gives no width there', () => {
    const curve: InstrumentCurve = { kind: 'caglioti', u: 0, v: -0.01, w: 0.001, covariance: null };
    expect(instrumentWidth(curve, 80).fwhm).toBeNaN();
  });

  it('GSAS-II σ² in centidegrees² converts to FWHM² in degrees²', () => {
    // GSAS-II: FWHM(°) = 2.35482 · √(σ² in centideg²) / 100.
    const c = gsasToCaglioti(2, -1, 5);
    const t = Math.tan((50 / 2) * DEG);
    const sigma2 = 2 * t * t - t + 5;
    const fwhm = Math.sqrt(c.u * t * t + c.v * t + c.w);
    expect(fwhm).toBeCloseTo((2.35482 * Math.sqrt(sigma2)) / 100, 5);
  });

  it('end to end: a synthetic standard gives the instrument curve, and a broadened sample is corrected', () => {
    // Standard: Gaussian peaks whose width follows the Caglioti law above, with counting noise.
    const standardPeaks: SyntheticPeak[] = angles.map((center) => ({
      center,
      fwhm: widthAt(center),
      height: 20000,
      eta: 0,
    }));
    const standard = generatePattern({
      start: 15,
      end: 85,
      step: 0.01,
      peaks: standardPeaks,
      background: { constant: 100, amplitude: 0, decay: 1 },
      noiseSeed: 11,
    });
    const found = detectPeaks(standard.twoTheta, standard.intensity, {
      prominencePercent: 3,
      minSeparationDeg: 0.1,
    });
    expect(found).toHaveLength(angles.length);
    const regions = fitPeaks(
      standard.twoTheta,
      standard.intensity,
      found.map((p) => ({ center: p.center, width: p.width })),
      { profile: 'gaussian', fixedEta: null },
    );
    const points = regions.flatMap((r) =>
      r.peaks.map((p) => ({ twoTheta: p.center, fwhm: p.fwhm })),
    );
    const curve = fitInstrumentCurve(points, 'caglioti')?.curve as InstrumentCurve;
    for (const tt of [25, 45, 65, 78]) {
      expect(relative(instrumentWidth(curve, tt).fwhm, widthAt(tt))).toBeLessThan(0.02);
    }

    // Sample: true width 0.15° everywhere, broadened by the instrument (Gaussian ⊗ Gaussian).
    const sampleWidth = 0.15;
    const sampleAngles = [28, 47, 69];
    const sample = generatePattern({
      start: 20,
      end: 80,
      step: 0.01,
      peaks: sampleAngles.map((center) => ({
        center,
        fwhm: Math.hypot(sampleWidth, widthAt(center)),
        height: 8000,
        eta: 0,
      })),
      background: { constant: 100, amplitude: 0, decay: 1 },
      noiseSeed: 12,
    });
    const fitted = fitPeaks(
      sample.twoTheta,
      sample.intensity,
      sampleAngles.map((center) => ({ center, width: 0.2 })),
      { profile: 'gaussian', fixedEta: null },
    ).flatMap((r) => r.peaks);
    const corrected = correctPeaks(
      fitted.map((p) => ({
        twoTheta: p.center,
        fwhm: p.fwhm,
        fwhmSigma: p.sigma.fwhm,
        eta: p.eta,
      })),
      { curve, method: 'gaussian', instrumentEta: () => 0, coveredRange: [21.4, 79.4] },
    );
    for (const c of corrected) {
      expect(relative(c.corrected, sampleWidth)).toBeLessThan(0.03);
      expect(c.correctedSigma).toBeGreaterThan(0);
      expect(c.limited).toBe(false);
      expect(c.messages).toHaveLength(0);
    }
  });
});

describe('resolution warnings', () => {
  const run = (fwhm: number, b: number) =>
    correctPeaks([{ twoTheta: 30, fwhm, fwhmSigma: 0.001, eta: 0 }], {
      curve: { kind: 'constant', fwhm: b },
      method: 'gaussian',
      instrumentEta: () => 0,
    })[0];

  it('flags a corrected width of zero or less, with no number given', () => {
    const r = run(0.1, 0.12);
    expect(r?.corrected).toBeNaN();
    expect(r?.limited).toBe(true);
    expect(r?.messages[0]?.text).toContain(
      'Limited by instrument resolution, size is a lower limit',
    );
  });

  it(`flags an instrument width of ${100 * RESOLUTION_LIMIT_RATIO} % of the observed width or more`, () => {
    expect(run(0.1, 0.085)?.limited).toBe(true);
    expect(run(0.1, 0.085)?.corrected).toBeGreaterThan(0);
    expect(run(0.1, 0.05)?.limited).toBe(false);
  });

  it('propagates σ for the Gaussian correction: σβ = √((B σB)² + (b σb)²) / β', () => {
    const curve: InstrumentCurve = { kind: 'constant', fwhm: 0.1 };
    const [r] = correctPeaks([{ twoTheta: 30, fwhm: 0.3, fwhmSigma: 0.004, eta: 0 }], {
      curve,
      method: 'gaussian',
      instrumentEta: () => 0,
    });
    const beta = Math.sqrt(0.09 - 0.01);
    expect(r?.correctedSigma).toBeCloseTo((0.3 * 0.004) / beta, 8);
  });

  it('warns when a peak lies outside the standard range', () => {
    const [r] = correctPeaks([{ twoTheta: 90, fwhm: 0.3, fwhmSigma: 0, eta: 0 }], {
      curve: { kind: 'constant', fwhm: 0.1 },
      method: 'gaussian',
      instrumentEta: () => 0,
      coveredRange: [20, 80],
    });
    expect(r?.messages.some((m) => m.text.includes('extrapolated'))).toBe(true);
  });
});
