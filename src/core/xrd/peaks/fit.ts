import { levenbergMarquardt } from '../../math/levenbergMarquardt';
import { lowerBoundIndex } from './search';
import {
  integralBreadth,
  integralBreadthGradient,
  peakArea,
  peakAreaGradient,
  profile,
  profileWithGradient,
  type PeakParameters,
  type ProfileKind,
} from './profiles';
import type { DataMessage } from '../types';

/** A starting position for one peak. Degrees 2θ. */
export interface PeakGuess {
  center: number;
  /** Approximate FWHM, degrees. */
  width: number;
}

export interface FitOptions {
  profile: ProfileKind;
  /** Pseudo-Voigt only: a fixed Lorentzian fraction, or null to fit it. */
  fixedEta: number | null;
}

/** Fitted peak with standard uncertainties (σ, from the covariance matrix). */
export interface PeakFit extends PeakParameters {
  sigma: PeakParameters;
  /** Area, intensity × degrees. */
  area: number;
  areaSigma: number;
  /** Integral breadth = area / height, degrees. */
  breadth: number;
  breadthSigma: number;
  messages: DataMessage[];
}

/** One group of overlapping peaks fitted together with a linear background. */
export interface RegionFit {
  /** Fitted range, degrees 2θ. */
  start: number;
  end: number;
  /** Background = intercept + slope × (2θ − pivot), intensity units. */
  background: { intercept: number; slope: number; pivot: number };
  peaks: PeakFit[];
  /** Coefficient of determination over the region: 1 − SSR / SST. */
  rSquared: number;
  converged: boolean;
  iterations: number;
  messages: DataMessage[];
}

/** Each peak's region extends this many widths either side of its centre. */
const REGION_WIDTHS = 3;

/**
 * Groups peaks whose ranges (centre ± 3 × width) overlap, so overlapping peaks are fitted
 * together. Returns [start, end] ranges in degrees with the guesses inside each, clipped to
 * the data range [xMin, xMax].
 */
export function groupRegions(
  guesses: readonly PeakGuess[],
  xMin: number,
  xMax: number,
): { start: number; end: number; peaks: PeakGuess[] }[] {
  const sorted = [...guesses].sort((a, b) => a.center - b.center);
  const regions: { start: number; end: number; peaks: PeakGuess[] }[] = [];
  for (const g of sorted) {
    const start = Math.max(xMin, g.center - REGION_WIDTHS * g.width);
    const end = Math.min(xMax, g.center + REGION_WIDTHS * g.width);
    const last = regions[regions.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.peaks.push(g);
    } else {
      regions.push({ start, end, peaks: [g] });
    }
  }
  return regions;
}

const PARAMS_PER_PEAK = 4;

/**
 * Fits one region: the sum of k peaks (see profiles.ts) plus a straight background line,
 * by bounded Levenberg–Marquardt. Bounds: height ≥ 0; centre within one starting width of its
 * guess; FWHM between one data step and the region width; 0 ≤ η ≤ 1.
 * x in degrees 2θ (increasing), y in intensity units.
 */
export function fitRegion(
  x: Float64Array,
  y: Float64Array,
  region: { start: number; end: number; peaks: readonly PeakGuess[] },
  options: FitOptions,
): RegionFit {
  const i0 = lowerBoundIndex(x, region.start);
  const i1 = Math.min(x.length, lowerBoundIndex(x, region.end + 1e-12));
  const xs = x.subarray(i0, i1);
  const ys = y.subarray(i0, i1);
  const n = xs.length;
  const k = region.peaks.length;
  const m = 2 + PARAMS_PER_PEAK * k;
  const step = n > 1 ? ((xs[n - 1] as number) - (xs[0] as number)) / (n - 1) : 1;
  const pivot = ((xs[0] as number) + (xs[n - 1] as number)) / 2;
  const messages: DataMessage[] = [];

  if (n < m + 2) {
    return {
      start: region.start,
      end: region.end,
      background: { intercept: 0, slope: 0, pivot },
      peaks: [],
      rSquared: NaN,
      converged: false,
      iterations: 0,
      messages: [
        {
          level: 'error',
          text: `Too few data points (${n}) to fit ${k} peak${k === 1 ? '' : 's'} here.`,
        },
      ],
    };
  }

  // Starting background: a line through the averages of the first and last three points.
  const edge = Math.min(3, Math.floor(n / 4));
  const mean = (a: Float64Array) => a.reduce((s, v) => s + v, 0) / a.length;
  const yLeft = mean(ys.subarray(0, edge));
  const yRight = mean(ys.subarray(n - edge));
  const slope0 = (yRight - yLeft) / ((xs[n - 1] as number) - (xs[0] as number) || 1);
  const background0 = (v: number) => (yLeft + yRight) / 2 + slope0 * (v - pivot);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of ys) {
    yMin = Math.min(yMin, v);
    yMax = Math.max(yMax, v);
  }
  const range = Math.max(yMax - yMin, 1e-12);

  const initial = new Float64Array(m);
  const lower = new Float64Array(m).fill(-Infinity);
  const upper = new Float64Array(m).fill(Infinity);
  const free = new Array<boolean>(m).fill(true);
  initial[0] = (yLeft + yRight) / 2;
  initial[1] = slope0;
  region.peaks.forEach((g, p) => {
    const o = 2 + PARAMS_PER_PEAK * p;
    const at = Math.min(n - 1, Math.max(0, lowerBoundIndex(xs, g.center)));
    const width = Math.min(Math.max(g.width, 2 * step), (xs[n - 1] as number) - (xs[0] as number));
    const reach = Math.max(width, 2 * step);
    initial[o] = Math.max((ys[at] as number) - background0(g.center), range * 0.01);
    initial[o + 1] = g.center;
    initial[o + 2] = width;
    initial[o + 3] =
      options.profile === 'gaussian'
        ? 0
        : options.profile === 'lorentzian'
          ? 1
          : (options.fixedEta ?? 0.5);
    lower[o] = 0;
    upper[o] = 3 * range;
    lower[o + 1] = Math.max(xs[0] as number, g.center - reach);
    upper[o + 1] = Math.min(xs[n - 1] as number, g.center + reach);
    lower[o + 2] = step;
    upper[o + 2] = (xs[n - 1] as number) - (xs[0] as number);
    lower[o + 3] = 0;
    upper[o + 3] = 1;
    free[o + 3] = options.profile === 'pseudo-voigt' && options.fixedEta === null;
  });

  const gradient = new Float64Array(PARAMS_PER_PEAK);
  const peakAt = (p: Float64Array, o: number): PeakParameters => ({
    height: p[o] as number,
    center: p[o + 1] as number,
    fwhm: p[o + 2] as number,
    eta: p[o + 3] as number,
  });
  const result = levenbergMarquardt({
    y: ys,
    initial,
    lower,
    upper,
    free,
    evaluate(p, model, jacobian) {
      const peaks = region.peaks.map((_, q) => peakAt(p, 2 + PARAMS_PER_PEAK * q));
      for (let i = 0; i < n; i++) {
        const xi = xs[i] as number;
        let value = (p[0] as number) + (p[1] as number) * (xi - pivot);
        if (jacobian) {
          const row = i * m;
          jacobian[row] = 1;
          jacobian[row + 1] = xi - pivot;
          peaks.forEach((peak, q) => {
            value += profileWithGradient(xi, peak, gradient);
            jacobian.set(gradient, row + 2 + PARAMS_PER_PEAK * q);
          });
        } else {
          for (const peak of peaks) value += profile(xi, peak);
        }
        model[i] = value;
      }
    },
  });

  const p = result.parameters;
  const cov = (a: number, b: number) => result.covariance[a * m + b] as number;
  const propagate = (o: number, g: readonly number[]) => {
    let v = 0;
    for (let s = 0; s < PARAMS_PER_PEAK; s++) {
      for (let t = 0; t < PARAMS_PER_PEAK; t++)
        v += (g[s] as number) * (g[t] as number) * cov(o + s, o + t);
    }
    return Math.sqrt(Math.max(0, v));
  };

  const peaks: PeakFit[] = region.peaks.map((_, q) => {
    const o = 2 + PARAMS_PER_PEAK * q;
    const peak = peakAt(p, o);
    const sigma = peakAt(result.standardErrors, o);
    const notes: DataMessage[] = [];
    if (result.atBound[o + 2] && peak.fwhm <= step * 1.000001) {
      notes.push({
        level: 'warning',
        text: 'The width hit its lower limit (one data step). This may be noise rather than a real peak.',
      });
    } else if (peak.fwhm < 3 * step) {
      notes.push({
        level: 'warning',
        text: 'Fewer than three data points across the peak width, so width and shape are poorly defined.',
      });
    }
    if (result.atBound[o]) {
      notes.push({
        level: 'warning',
        text: 'The fitted height is zero, so this peak may not be real. Consider removing it.',
      });
    }
    if (result.atBound[o + 1]) {
      notes.push({
        level: 'warning',
        text: 'The centre moved to the edge of its allowed range. Check the starting position.',
      });
    }
    if (free[o + 3] && result.atBound[o + 3]) {
      notes.push({
        level: 'info',
        text: `η reached ${peak.eta < 0.5 ? '0 (pure Gaussian)' : '1 (pure Lorentzian)'}.`,
      });
    }
    if (sigma.fwhm > 0.2 * peak.fwhm) {
      notes.push({ level: 'warning', text: 'The width is uncertain by more than 20 %.' });
    }
    return {
      ...peak,
      sigma,
      area: peakArea(peak),
      areaSigma: propagate(o, peakAreaGradient(peak)),
      breadth: integralBreadth(peak),
      breadthSigma: propagate(o, integralBreadthGradient(peak)),
      messages: notes,
    };
  });

  const yMean = mean(ys);
  let sst = 0;
  for (const v of ys) sst += (v - yMean) ** 2;
  const rSquared = sst > 0 ? 1 - result.ssr / sst : NaN;
  if (!result.converged) {
    messages.push({
      level: 'warning',
      text: `The fit did not converge within ${result.iterations} iterations, so results may be unreliable.`,
    });
  }
  if (rSquared < 0.9) {
    messages.push({
      level: 'warning',
      text: 'R² is below 0.9: the model does not describe this region well. Check for missing or extra peaks.',
    });
  }
  return {
    start: xs[0] as number,
    end: xs[n - 1] as number,
    background: { intercept: p[0] as number, slope: p[1] as number, pivot },
    peaks,
    rSquared,
    converged: result.converged,
    iterations: result.iterations,
    messages,
  };
}

/** Background plus all peaks of a region at x. */
export function regionValue(region: RegionFit, x: number): number {
  let value = region.background.intercept + region.background.slope * (x - region.background.pivot);
  for (const peak of region.peaks) value += profile(x, peak);
  return value;
}

/**
 * Groups the guesses into regions and fits each one in turn. onProgress is called after each
 * region with (done, total).
 */
export function fitPeaks(
  x: Float64Array,
  y: Float64Array,
  guesses: readonly PeakGuess[],
  options: FitOptions,
  onProgress?: (done: number, total: number) => void,
): RegionFit[] {
  const regions = groupRegions(guesses, x[0] as number, x[x.length - 1] as number);
  return regions.map((region, i) => {
    const fit = fitRegion(x, y, region, options);
    onProgress?.(i + 1, regions.length);
    return fit;
  });
}
