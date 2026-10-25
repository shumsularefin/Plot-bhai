import { absorbanceFromPercentT, mapValues, percentTFromAbsorbance } from '../uvvis/conversions';
import { formatNumber } from '../xrd/parsers/numbers';
import { cutIntoData } from '../xrd/process/background';
import { savitzkyGolay } from '../xrd/process/savitzkyGolay';
import type { DataMessage } from '../xrd/types';
import { alsBaseline, arplsBaseline } from '../math/whittaker';
import { polynomialBaseline, rubberBandBaseline } from './baseline';
import type { FtirKind, FtirSpectrum, ValueScale } from './types';

export type BaselineMethod = 'arpls' | 'rubber-band' | 'polynomial' | 'als';
export type NormaliseMethod = 'max' | 'minmax';

export interface FtirProcessing {
  baseline: {
    enabled: boolean;
    method: BaselineMethod;
    /** Polynomial degree. */
    degree: number;
    /** arPLS and ALS smoothness λ as a power of ten: λ = 10^logLambda (λ in points⁴). */
    logLambda: number;
    /** ALS weight of points above the curve. */
    p: number;
  };
  smoothing: { enabled: boolean; window: number; order: number };
  normalise: { enabled: boolean; method: NormaliseMethod };
}

/**
 * Defaults of my own choosing, adjustable on screen; not published constants. arPLS with
 * λ = 10⁶ is the default baseline because it gave the smallest error on the synthetic spectra
 * with known baselines in tests/baseline-validation.test.ts.
 */
export const DEFAULT_FTIR_PROCESSING: FtirProcessing = {
  baseline: { enabled: false, method: 'arpls', degree: 3, logLambda: 6, p: 0.01 },
  smoothing: { enabled: false, window: 11, order: 3 },
  normalise: { enabled: false, method: 'max' },
};

export type FtirStep = keyof FtirProcessing;

export interface FtirProcessed {
  wavenumber: Float64Array;
  /** Absorbance after the enabled steps (peaks point up). */
  absorbance: Float64Array;
  /** The baseline that was subtracted, in absorbance, or null when none was. */
  baseline: Float64Array | null;
  messages: Partial<Record<FtirStep, DataMessage[]>>;
}

/**
 * Absorbance of a spectrum: the values themselves, or A = 2 − log₁₀(%T) = −log₁₀(T) for
 * transmittance. NaN where transmittance is zero or negative.
 */
export function toAbsorbance(
  values: Float64Array,
  kind: FtirKind,
  scale: ValueScale,
): Float64Array {
  if (kind === 'absorbance') return values;
  return mapValues(values, (v) => absorbanceFromPercentT(scale === 'percent' ? v : v * 100));
}

/** Transmittance in percent from absorbance: %T = 100 · 10^(−A). */
export function toPercentTransmittance(absorbance: Float64Array): Float64Array {
  return mapValues(absorbance, percentTFromAbsorbance);
}

function stepSpread(x: Float64Array): number {
  const steps: number[] = [];
  for (let i = 1; i < x.length; i++) steps.push((x[i] as number) - (x[i - 1] as number));
  steps.sort((a, b) => a - b);
  return (
    ((steps[steps.length - 1] as number) - (steps[0] as number)) /
    (steps[Math.floor(steps.length / 2)] as number)
  );
}

/**
 * Runs the enabled steps in the order baseline, smoothing, normalisation, always on absorbance
 * (transmittance is converted first, so peaks point up). Points where the absorbance cannot be
 * calculated are removed first and counted in a message. Baseline: the chosen curve is subtracted.
 * Smoothing: Savitzky–Golay, needs evenly spaced wavenumbers. Normalisation: 'max' divides by the
 * highest absorbance; 'minmax' maps the lowest to 0 and the highest to 1. The input is never changed.
 */
export function processSpectrum(
  spectrum: Pick<FtirSpectrum, 'wavenumber' | 'values' | 'kind' | 'scale'>,
  settings: FtirProcessing,
): FtirProcessed {
  const messages: FtirProcessed['messages'] = {};
  const note = (step: FtirStep, level: DataMessage['level'], text: string) => {
    (messages[step] ??= []).push({ level, text });
  };
  let x = spectrum.wavenumber;
  let a = toAbsorbance(spectrum.values, spectrum.kind, spectrum.scale);
  const keep: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) keep.push(i);
  if (keep.length < a.length) {
    x = Float64Array.from(keep, (i) => x[i] as number);
    a = Float64Array.from(keep, (i) => a[i] as number);
  }
  let baseline: Float64Array | null = null;

  if (settings.baseline.enabled) {
    const b = settings.baseline;
    if (x.length < 10) {
      note('baseline', 'warning', 'Too few points for a baseline, so nothing was subtracted.');
    } else {
      const whittaker = b.method === 'als' || b.method === 'arpls';
      baseline =
        b.method === 'rubber-band'
          ? rubberBandBaseline(x, a)
          : b.method === 'polynomial'
            ? polynomialBaseline(x, a, b.degree)
            : whittaker && stepSpread(x) > 0.01
              ? null
              : b.method === 'arpls'
                ? arplsBaseline(a, 10 ** b.logLambda)
                : alsBaseline(a, 10 ** b.logLambda, b.p);
      if (baseline === null) {
        note(
          'baseline',
          'warning',
          'The wavenumber spacing is not even, so the least squares baseline (arPLS or ALS) was skipped. Choose the rubber band or the polynomial instead.',
        );
      } else {
        const base = baseline;
        const before = a;
        a = a.map((v, i) => v - (base[i] as number));
        const cut = cutIntoData(before, a);
        if (cut > 0.02) {
          note(
            'baseline',
            'warning',
            `The baseline lies above the spectrum (by more than 3 times the noise) at ${(cut * 100).toFixed(0)} % of the points, so it cuts into real bands. Lower the polynomial degree or raise the smoothness, and check the dashed curve by eye.`,
          );
        }
      }
    }
  }

  if (settings.smoothing.enabled) {
    const { window, order } = settings.smoothing;
    if (x.length < window) {
      note(
        'smoothing',
        'warning',
        `Only ${x.length} points are left, fewer than the window of ${window}, so nothing was smoothed.`,
      );
    } else if (stepSpread(x) > 0.01) {
      note(
        'smoothing',
        'warning',
        'The wavenumber spacing is not even, so smoothing was skipped. Savitzky–Golay smoothing needs evenly spaced points.',
      );
    } else {
      a = savitzkyGolay(a, window, order);
      const step = ((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1);
      note(
        'smoothing',
        'info',
        `Smoothed with a ${window}-point window (about ${formatNumber((window - 1) * step, 2)} cm⁻¹ wide), polynomial order ${order}. A window wider than your narrowest band flattens it.`,
      );
    }
  }

  if (settings.normalise.enabled) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of a) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (settings.normalise.method === 'max') {
      if (hi > 0) a = a.map((v) => v / hi);
      else
        note(
          'normalise',
          'warning',
          'The highest absorbance is not above zero, so nothing was normalised.',
        );
    } else if (hi > lo) {
      a = a.map((v) => (v - lo) / (hi - lo));
    } else {
      note('normalise', 'warning', 'Every value is the same, so nothing was normalised.');
    }
  }

  if (keep.length < spectrum.values.length) {
    note(
      'baseline',
      'warning',
      `${spectrum.values.length - keep.length} point${spectrum.values.length - keep.length === 1 ? ' was' : 's were'} removed because the absorbance could not be calculated (transmittance zero or negative).`,
    );
  }
  return { wavenumber: x, absorbance: a, baseline, messages };
}
