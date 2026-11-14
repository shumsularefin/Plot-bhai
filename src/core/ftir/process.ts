import {
  absorbanceFromPercentT,
  kubelkaMunk,
  mapValues,
  percentTFromAbsorbance,
} from '../uvvis/conversions';
import { bandArea, interpolate } from './bands';
import { formatNumber } from '../xrd/parsers/numbers';
import { cutIntoData } from '../xrd/process/background';
import { localNoise } from '../xrd/peaks/noise';
import { lowerBoundIndex } from '../xrd/peaks/search';
import { savitzkyGolay } from '../xrd/process/savitzkyGolay';
import type { DataMessage } from '../xrd/types';
import { alsBaseline, arplsBaseline } from '../math/whittaker';
import { atrCorrect, penetrationDepthUm } from './atr';
import { polynomialBaseline, rubberBandBaseline } from './baseline';
import type { FtirKind, FtirSpectrum, ValueScale } from './types';

export type BaselineMethod = 'arpls' | 'rubber-band' | 'polynomial' | 'als';
export type NormaliseMethod = 'max' | 'minmax' | 'band';
/**
 * Absorbance-like quantity of a diffuse reflectance spectrum: the Kubelka–Munk function
 * F(R) = (1 − R)² / (2R), or the apparent absorbance log₁₀(1/R) = −log₁₀ R.
 */
export type ReflectanceTransform = 'kubelka-munk' | 'log-inverse';

export interface FtirProcessing {
  /** How a reflectance spectrum becomes the absorbance-like quantity; unused for other kinds. */
  reflectance: ReflectanceTransform;
  /**
   * Replace the atmospheric CO₂ stretching region [fromCm, toCm] (cm⁻¹) by the straight line
   * between the spectrum's values at its two ends.
   */
  co2: { enabled: boolean; fromCm: number; toCm: number };
  /** ATR correction A·ν̃/ν̃_ref; the indices and angle only set the penetration depth shown. */
  atr: {
    enabled: boolean;
    /** Reference wavenumber, cm⁻¹. */
    referenceCm: number;
    /** Refractive index of the crystal (n₁). */
    crystalIndex: number;
    /** Refractive index of the sample (n₂). */
    sampleIndex: number;
    /** Angle of incidence, degrees. */
    angleDeg: number;
  };
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
  normalise: {
    enabled: boolean;
    method: NormaliseMethod;
    /** The band of 'band': its range (cm⁻¹, either order) and whether its height or area divides. */
    band: { fromCm: number | null; toCm: number | null; measure: 'height' | 'area' };
  };
}

/**
 * Default CO₂ region, cm⁻¹: around the 2349 cm⁻¹ asymmetric stretch of atmospheric CO₂
 * (data/ftir/atmosphere.json), which in a spectrum is a doublet of rotation–vibration branches
 * either side of that centre. The width is my own choice, adjustable on screen.
 */
export const DEFAULT_CO2_RANGE = { fromCm: 2280, toCm: 2400 } as const;

/**
 * Defaults of my own choosing, adjustable on screen; not published constants. The ATR crystal
 * index 2.4 is the value usually quoted for diamond and ZnSe in the mid-infrared, and n₂ = 1.5 a
 * typical organic sample (TODO, verify against the accessory's manual). arPLS with
 * λ = 10⁶ is the default baseline because it gave the smallest error on the synthetic spectra
 * with known baselines in tests/baseline-validation.test.ts.
 */
export const DEFAULT_FTIR_PROCESSING: FtirProcessing = {
  reflectance: 'kubelka-munk',
  co2: { enabled: false, ...DEFAULT_CO2_RANGE },
  atr: { enabled: false, referenceCm: 1000, crystalIndex: 2.4, sampleIndex: 1.5, angleDeg: 45 },
  baseline: { enabled: false, method: 'arpls', degree: 3, logLambda: 6, p: 0.01 },
  smoothing: { enabled: false, window: 11, order: 3 },
  normalise: {
    enabled: false,
    method: 'max',
    band: { fromCm: null, toCm: null, measure: 'height' },
  },
};

/** The processing steps with their own on/off switch and messages. */
export type FtirStep = Exclude<keyof FtirProcessing, 'reflectance'>;

export interface FtirProcessed {
  wavenumber: Float64Array;
  /** Absorbance after the enabled steps (peaks point up). */
  absorbance: Float64Array;
  /** The baseline that was subtracted, in absorbance, or null when none was. */
  baseline: Float64Array | null;
  /** The range replaced by a straight line (the CO₂ region), cm⁻¹, increasing; null when none was. */
  edited: { fromCm: number; toCm: number } | null;
  messages: Partial<Record<FtirStep, DataMessage[]>>;
}

/**
 * Absorbance, or the absorbance-like quantity, of a spectrum:
 *   absorbance     the values themselves;
 *   transmittance  A = 2 − log₁₀(%T) = −log₁₀(T);
 *   reflectance    F(R) = (1 − R)² / (2R) (Kubelka–Munk, the default) or log₁₀(1/R) = −log₁₀ R,
 *                  R the reflectance as a fraction.
 * All are unitless. NaN where T or R is zero or negative.
 */
export function toAbsorbance(
  values: Float64Array,
  kind: FtirKind,
  scale: ValueScale,
  transform: ReflectanceTransform = 'kubelka-munk',
): Float64Array {
  if (kind === 'absorbance') return values;
  const percent = (v: number) => (scale === 'percent' ? v : v * 100);
  if (kind === 'reflectance' && transform === 'kubelka-munk')
    return mapValues(values, (v) => kubelkaMunk(percent(v) / 100));
  return mapValues(values, (v) => absorbanceFromPercentT(percent(v)));
}

/**
 * Replaces the points with fromCm ≤ ν̃ ≤ toCm by the straight line joining the spectrum at the
 * two ends (linear interpolation of the data at fromCm and toCm). x increasing. Returns null when
 * the range does not lie inside the data with at least one point in it.
 */
export function straightenRange(
  x: Float64Array,
  y: Float64Array,
  fromCm: number,
  toCm: number,
): Float64Array | null {
  const lo = Math.min(fromCm, toCm);
  const hi = Math.max(fromCm, toCm);
  const n = x.length;
  if (n < 2 || !(hi > lo) || lo < (x[0] as number) || hi > (x[n - 1] as number)) return null;
  const yLo = interpolate(x, y, lo);
  const yHi = interpolate(x, y, hi);
  const out = Float64Array.from(y);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] as number;
    if (xi < lo || xi > hi) continue;
    out[i] = yLo + ((yHi - yLo) * (xi - lo)) / (hi - lo);
    inside++;
  }
  return inside > 0 ? out : null;
}

/** Transmittance in percent from absorbance: %T = 100 · 10^(−A). */
export function toPercentTransmittance(absorbance: Float64Array): Float64Array {
  return mapValues(absorbance, percentTFromAbsorbance);
}

/** (largest step − smallest step) / median step; 0 for evenly spaced points. */
export function stepSpread(x: Float64Array): number {
  const steps: number[] = [];
  for (let i = 1; i < x.length; i++) steps.push((x[i] as number) - (x[i - 1] as number));
  steps.sort((a, b) => a - b);
  return (
    ((steps[steps.length - 1] as number) - (steps[0] as number)) /
    (steps[Math.floor(steps.length / 2)] as number)
  );
}

/**
 * Runs the enabled steps in the order CO₂ line, ATR correction, baseline, smoothing,
 * normalisation, always on absorbance (transmittance and reflectance are converted first, so
 * peaks point up). CO₂ line: see straightenRange. Normalisation 'band' divides by the height or
 * the area of a band above the straight line between the ends of its range (bandArea). Points where the absorbance cannot be
 * calculated are removed first and counted in a message. ATR: see atrCorrect. Baseline: the chosen curve is subtracted.
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
  let a = toAbsorbance(spectrum.values, spectrum.kind, spectrum.scale, settings.reflectance);
  const keep: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) keep.push(i);
  if (keep.length < a.length) {
    x = Float64Array.from(keep, (i) => x[i] as number);
    a = Float64Array.from(keep, (i) => a[i] as number);
  }
  let baseline: Float64Array | null = null;
  let edited: FtirProcessed['edited'] = null;

  if (settings.co2.enabled) {
    const lo = Math.min(settings.co2.fromCm, settings.co2.toCm);
    const hi = Math.max(settings.co2.fromCm, settings.co2.toCm);
    const line = straightenRange(x, a, lo, hi);
    if (line) {
      a = line;
      edited = { fromCm: lo, toCm: hi };
      note(
        'co2',
        'info',
        `${formatNumber(lo, 4)}–${formatNumber(hi, 4)} cm⁻¹ was replaced by a straight line between its ends, and no peaks are picked there. Anything the sample absorbs in this range is lost too.`,
      );
    } else {
      note(
        'co2',
        'warning',
        `The range ${formatNumber(lo, 4)}–${formatNumber(hi, 4)} cm⁻¹ does not lie inside the spectrum (${formatNumber(x[0] as number, 4)} to ${formatNumber(x[x.length - 1] as number, 4)} cm⁻¹), so nothing was replaced.`,
      );
    }
  }

  if (settings.atr.enabled) {
    const { referenceCm, crystalIndex, sampleIndex, angleDeg } = settings.atr;
    a = atrCorrect(x, a, referenceCm);
    const dp = penetrationDepthUm(referenceCm, crystalIndex, sampleIndex, angleDeg);
    note(
      'atr',
      dp === null ? 'warning' : 'info',
      dp === null
        ? `With n₁ = ${crystalIndex}, n₂ = ${sampleIndex} and ${angleDeg}° there is no total internal reflection (sin θ must exceed n₂/n₁), so check the indices and angle. The absorbance was still scaled by ν̃/${referenceCm}.`
        : `Absorbance scaled by ν̃/${referenceCm} cm⁻¹. The penetration depth at ${referenceCm} cm⁻¹ is about ${formatNumber(dp, 2)} µm (n₁ = ${crystalIndex}, n₂ = ${sampleIndex}, ${angleDeg}°); it is about ${formatNumber(dp * (referenceCm / 3000), 2)} µm at 3000 cm⁻¹.`,
    );
  }

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
    if (settings.normalise.method === 'band') {
      const { fromCm, toCm, measure } = settings.normalise.band;
      const band = fromCm !== null && toCm !== null ? bandArea(x, a, fromCm, toCm) : null;
      const value = band ? (measure === 'height' ? band.height : band.area) : NaN;
      const inside = band !== null && band.peakCm > band.fromCm && band.peakCm < band.toCm;
      // A band must rise more than 3 noise levels above the line (the usual 3σ detection rule,
      // as in the baseline check); the tiny floor stops rounding error counting as a band.
      let floor = 0;
      if (band) {
        const noise = localNoise(a);
        let top = 0;
        for (const v of a) top = Math.max(top, Math.abs(v));
        const at = Math.min(x.length - 1, lowerBoundIndex(x, band.peakCm));
        floor = Math.max(3 * (noise[at] as number), 1e-9 * top);
      }
      const present = band !== null && band.height > floor;
      if (fromCm === null || toCm === null) {
        note('normalise', 'warning', 'Type the range of the band to normalise to.');
      } else if (!band) {
        note(
          'normalise',
          'warning',
          `The range ${formatNumber(fromCm, 4)}–${formatNumber(toCm, 4)} cm⁻¹ is not inside the spectrum, so nothing was normalised.`,
        );
      } else if (!inside || !present || !(value > 0)) {
        note(
          'normalise',
          'warning',
          `No band rises above the straight line between ${formatNumber(band.fromCm, 4)} and ${formatNumber(band.toCm, 4)} cm⁻¹ (its height is ${formatNumber(band.height, 3)}${present ? '' : ', not more than 3 times the noise'}${inside ? '' : ', and the highest point is at an end of the range'}), so the band is absent or negative here and nothing was normalised. Choose a range around a band that every spectrum has.`,
        );
      } else {
        a = a.map((v) => v / value);
        note(
          'normalise',
          'info',
          `Divided by the ${measure} of the band at ${formatNumber(band.peakCm, 5)} cm⁻¹, ${formatNumber(value, 4)}${measure === 'area' ? ' cm⁻¹' : ''}, measured above the straight line between ${formatNumber(band.fromCm, 4)} and ${formatNumber(band.toCm, 4)} cm⁻¹.`,
        );
      }
    } else if (settings.normalise.method === 'max') {
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
      `${spectrum.values.length - keep.length} point${spectrum.values.length - keep.length === 1 ? ' was' : 's were'} removed because the absorbance could not be calculated (${spectrum.kind === 'reflectance' ? 'reflectance' : 'transmittance'} zero or negative).`,
    );
  }
  return { wavenumber: x, absorbance: a, baseline, edited, messages };
}
