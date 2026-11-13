import type { DetectionOptions } from './detect';
import {
  fitPeaks,
  hasEtaChoice,
  regionValue,
  type FitOptions,
  type PeakGuess,
  type RegionFit,
} from './fit';
import { missedPeaks } from './missed';
import { parameterCount } from './profiles';
import { lowerBoundIndex } from './search';

/** At most this many rounds of changes after the first fit. */
export const MAX_ROUNDS = 8;

/** Region checks that mean the model does not yet describe the data (see fit.ts). */
const MISFIT_CHECKS = new Set(['misfit', 'low-r-squared', 'background-low']);

export interface ImprovedFit {
  regions: RegionFit[];
  /** Rounds of changes that were kept. */
  rounds: number;
  /** Centres (degrees 2θ) of peaks added and removed over all kept rounds. */
  added: number[];
  removed: number[];
  /**
   * Why the loop stopped: 'fits' (no region flagged and no missed peak), 'no-change' (nothing
   * left to add or remove), 'no-gain' (the next change did not lower the score, so it was not
   * kept), 'max-rounds', or 'shape' (Gaussian or Lorentzian peaks whose misfit is their shape;
   * see `shape`).
   */
  stopped: 'fits' | 'no-change' | 'no-gain' | 'max-rounds' | 'shape';
  /** Score of the kept fit (see fitScore). */
  score: number;
  /**
   * When stopped is 'shape': the same peaks fitted as pseudo-Voigt (η free), which scored lower.
   * Peaks are then not added, because a Gaussian or Lorentzian leaves humps in the residual on
   * both sides of every peak whose real shape lies between them, and filling those with extra
   * peaks would fit the data with peaks that do not exist.
   */
  shape?: { options: FitOptions; regions: RegionFit[]; score: number };
}

/**
 * Score of a fit for comparing two fits of the same pattern, lower is better, in the spirit of
 * the Bayesian information criterion:
 *   S = Σ_regions [ SSR_r / σ_r² + m_r ln n_r ]
 * with SSR_r the sum of squared residuals of region r over its n_r points, σ_r its noise level
 * (RegionFit.noiseSd; 1 when it could not be estimated) and m_r its free parameters (two for the
 * background line plus those of each peak, without η when η is fixed). A peak is kept only when
 * it lowers SSR/σ² by more than its parameters' ln n each, so the loop does not fit noise.
 * x in degrees 2θ, y in intensity units.
 */
export function fitScore(
  x: Float64Array,
  y: Float64Array,
  regions: readonly RegionFit[],
  options: FitOptions,
): number {
  // Gaussian and Lorentzian have η fixed at 0 or 1; the pseudo-Voigts when the user fixes it.
  const etaFixed = !hasEtaChoice(options.profile) || options.fixedEta !== null;
  const perPeak =
    parameterCount(options.profile) - (etaFixed && options.profile !== 'pearson-vii' ? 1 : 0);
  let score = 0;
  for (const region of regions) {
    const i0 = lowerBoundIndex(x, region.start);
    const i1 = Math.min(x.length, lowerBoundIndex(x, region.end + 1e-12));
    const n = i1 - i0;
    if (n <= 0) continue;
    let ssr = 0;
    for (let i = i0; i < i1; i++)
      ssr += ((y[i] as number) - regionValue(region, x[i] as number)) ** 2;
    const sigma = region.noiseSd > 0 ? region.noiseSd : 1;
    score += ssr / sigma ** 2 + (2 + perPeak * region.peaks.length) * Math.log(n);
  }
  return score;
}

/** True when no region is flagged as not describing its data. */
export function allRegionsFit(regions: readonly RegionFit[]): boolean {
  return regions.every((r) => r.messages.every((m) => !MISFIT_CHECKS.has(m.check)));
}

/**
 * The changes of one round, the rules the fit step has always applied once, and a merge:
 * - remove peaks whose width shrank to one data step (noise) or whose height went to zero;
 * - of two fitted peaks closer than the detection's minimum separation, remove the one with the
 *   smaller area (two peaks on one position are one peak);
 * - add the peaks the residual shows were missed (missedPeaks: the same tests as detection);
 * - remove a very broad peak (over 4 × the median width) that an added peak falls inside, since
 *   it was standing in for the missed ones.
 * step: the data step in degrees.
 */
export function proposeChanges(
  x: Float64Array,
  y: Float64Array,
  regions: readonly RegionFit[],
  detection: DetectionOptions,
  step: number,
): { guesses: PeakGuess[]; added: number[]; removed: number[] } {
  const fitted = regions.flatMap((r) => r.peaks);
  const added = missedPeaks(x, y, regions, detection);
  const widths = fitted.map((p) => p.fwhm).sort((a, b) => a - b);
  const median = widths[widths.length >> 1] ?? 0;
  const removed = fitted.filter(
    (p) =>
      p.fwhm <= step * 1.01 ||
      !(p.height > 0) ||
      fitted.some(
        (q) =>
          q !== p &&
          Math.abs(q.center - p.center) < detection.minSeparationDeg &&
          (q.area > p.area || (q.area === p.area && q.center < p.center)),
      ) ||
      (p.fwhm > 4 * median && added.some((a) => Math.abs(a.center - p.center) < p.fwhm)),
  );
  const guesses = [
    ...fitted.filter((p) => !removed.includes(p)).map((p) => ({ center: p.center, width: p.fwhm })),
    ...added.map((p) => ({ center: p.center, width: p.width })),
  ].sort((a, b) => a.center - b.center);
  return { guesses, added: added.map((p) => p.center), removed: removed.map((p) => p.center) };
}

/**
 * Fits the peaks, then keeps improving the set of peaks until the regions fit: each round
 * applies proposeChanges and fits again from the fitted peaks, and the round is kept only when
 * it lowers fitScore. It stops when no region is flagged (χ²ν ≤ 4, R² ≥ 0.9, background meets
 * the data) and the residual shows no missed peak, when there is nothing left to change, when a
 * round does not lower the score, or after MAX_ROUNDS rounds.
 *
 * Every fit itself already runs Levenberg–Marquardt to convergence; what a poor fit needs is a
 * different model (a missing peak, a spurious one), which is what each round changes. The
 * profile shape is the user's choice and is not changed here. A Gaussian or Lorentzian that
 * needed changes is compared with the same improvement run as pseudo-Voigt (η free): when that
 * scores lower, the shape is the problem, and the result is the first fit with the user's shape,
 * stopped 'shape', with the pseudo-Voigt fit in `shape` for the user to choose.
 *
 * onProgress(round, done, total) is called after each region of each fit (round 0 = first fit).
 */
export function improveFit(
  x: Float64Array,
  y: Float64Array,
  guesses: readonly PeakGuess[],
  options: FitOptions,
  detection: DetectionOptions,
  step: number,
  onProgress?: (round: number, done: number, total: number) => void,
): ImprovedFit {
  const own = improveWith(x, y, guesses, options, detection, step, onProgress);
  const fixedShape = options.profile === 'gaussian' || options.profile === 'lorentzian';
  if (!fixedShape || (own.result.rounds === 0 && own.result.stopped === 'fits')) return own.result;
  const shapeOptions: FitOptions = { ...options, profile: 'pseudo-voigt', fixedEta: null };
  const other = improveWith(x, y, guesses, shapeOptions, detection, step, onProgress).result;
  if (!(other.score < own.result.score)) return own.result;
  return {
    regions: own.first,
    rounds: 0,
    added: [],
    removed: [],
    stopped: 'shape',
    score: fitScore(x, y, own.first, options),
    shape: { options: shapeOptions, regions: other.regions, score: other.score },
  };
}

/** The improvement loop of improveFit for one profile; also returns the first fit. */
function improveWith(
  x: Float64Array,
  y: Float64Array,
  guesses: readonly PeakGuess[],
  options: FitOptions,
  detection: DetectionOptions,
  step: number,
  onProgress?: (round: number, done: number, total: number) => void,
): { first: RegionFit[]; result: ImprovedFit } {
  const first = fitPeaks(x, y, guesses, options, (d, t) => onProgress?.(0, d, t));
  let regions = first;
  let score = fitScore(x, y, regions, options);
  const added: number[] = [];
  const removed: number[] = [];
  const done = (rounds: number, stopped: ImprovedFit['stopped']) => ({
    first,
    result: { regions, rounds, added, removed, stopped, score },
  });
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const change = proposeChanges(x, y, regions, detection, step);
    if (change.added.length === 0 && change.removed.length === 0)
      return done(round - 1, allRegionsFit(regions) ? 'fits' : 'no-change');
    if (change.guesses.length === 0) return done(round - 1, 'no-change');
    const next = fitPeaks(x, y, change.guesses, options, (d, t) => onProgress?.(round, d, t));
    const nextScore = fitScore(x, y, next, options);
    if (!(nextScore < score)) return done(round - 1, 'no-gain');
    regions = next;
    score = nextScore;
    added.push(...change.added);
    removed.push(...change.removed);
  }
  return done(MAX_ROUNDS, 'max-rounds');
}
