import { formatNumber } from '../xrd/parsers/numbers';
import { savitzkyGolay } from '../xrd/process/savitzkyGolay';
import type { DataMessage } from '../xrd/types';
import { absorbanceFromPercentT, kubelkaMunk, mapValues } from './conversions';
import type { Spectrum, SpectrumKind, ValueScale } from './types';

export interface CleaningSettings {
  blank: { enabled: boolean; blankId: string | null };
  /** Baseline offset: the mean over a wavelength window where the sample should not absorb is removed. */
  offset: { enabled: boolean; fromNm: number; toNm: number };
  smoothing: { enabled: boolean; window: number; order: number };
}

export const DEFAULT_CLEANING: CleaningSettings = {
  blank: { enabled: false, blankId: null },
  offset: { enabled: false, fromNm: 800, toNm: 900 },
  smoothing: { enabled: false, window: 11, order: 3 },
};

export type CleaningStep = keyof CleaningSettings;

export interface Cleaned {
  wavelengthNm: Float64Array;
  /** Cleaned values in the same kind and scale as the input spectrum. */
  values: Float64Array;
  /** Messages by step, shown where the step is. */
  messages: Partial<Record<CleaningStep, DataMessage[]>>;
}

/** The two values of a spectrum that decide how a conversion is done. */
type Meaning = { kind: SpectrumKind; scale: ValueScale };

const fractionOf = (value: number, { scale }: Meaning) =>
  scale === 'percent' ? value / 100 : value;

/**
 * "Absorbance-like" quantity a = −log₁₀(value), unitless. For absorbance it is the value itself;
 * for transmittance it is the absorbance A = −log₁₀ T; for reflectance it is the apparent
 * absorbance −log₁₀ R. NaN where the value is zero or negative.
 */
function toLog(values: Float64Array, meaning: Meaning): Float64Array {
  if (meaning.kind === 'absorbance') return values;
  return mapValues(values, (v) => {
    const fraction = fractionOf(v, meaning);
    return fraction > 0 ? -Math.log10(fraction) : NaN;
  });
}

/** Inverse of toLog: value = 10^(−a) as a fraction, written in the original scale. */
function fromLog(a: Float64Array, meaning: Meaning): Float64Array {
  if (meaning.kind === 'absorbance') return a;
  const full = meaning.scale === 'percent' ? 100 : 1;
  return mapValues(a, (v) => full * 10 ** -v);
}

/** Linear interpolation of (x, y) at xi; NaN outside the range of x. x increasing. */
function interpolate(x: Float64Array, y: Float64Array, xi: number): number {
  const n = x.length;
  if (xi < (x[0] as number) || xi > (x[n - 1] as number)) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((x[mid] as number) <= xi) lo = mid;
    else hi = mid;
  }
  const x0 = x[lo] as number;
  const x1 = x[hi] as number;
  const t = (xi - x0) / (x1 - x0);
  return (y[lo] as number) * (1 - t) + (y[hi] as number) * t;
}

/** Relative spread of the wavelength step; smoothing assumes evenly spaced points. */
function stepSpread(x: Float64Array): number {
  const steps: number[] = [];
  for (let i = 1; i < x.length; i++) steps.push((x[i] as number) - (x[i - 1] as number));
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)] as number;
  return ((steps[steps.length - 1] as number) - (steps[0] as number)) / median;
}

/**
 * Applies the enabled cleaning steps in this order: blank, baseline offset, smoothing.
 *
 * Blank and offset work on a = −log₁₀(value) (see toLog): the blank's a is subtracted point by
 * point (the blank is interpolated onto this spectrum's wavelengths), and the mean a over the
 * offset window is subtracted. For absorbance this is a plain subtraction. For transmittance it
 * is the same as dividing by the blank transmittance, T_sample / T_blank. For reflectance it
 * divides by the blank (reference) reflectance in the same way. Points where the logarithm
 * cannot be taken, or where the blank does not reach, are removed and counted in a message.
 * Smoothing is Savitzky–Golay (window in points, polynomial order) and needs evenly spaced
 * wavelengths. The input spectrum is never changed.
 */
export function cleanSpectrum(
  spectrum: Pick<Spectrum, 'wavelengthNm' | 'values' | 'kind' | 'scale'>,
  settings: CleaningSettings,
  blank?: Pick<Spectrum, 'wavelengthNm' | 'values' | 'kind' | 'scale'>,
): Cleaned {
  const messages: Cleaned['messages'] = {};
  const note = (step: CleaningStep, level: DataMessage['level'], text: string) => {
    (messages[step] ??= []).push({ level, text });
  };
  let x = spectrum.wavelengthNm;
  let values = spectrum.values;
  const meaning: Meaning = spectrum;

  const useBlank = settings.blank.enabled && blank !== undefined;
  const useOffset = settings.offset.enabled;
  if (settings.blank.enabled && !blank) {
    note('blank', 'warning', 'No blank is chosen, so nothing was subtracted.');
  }

  if (useBlank || useOffset) {
    let a = Float64Array.from(toLog(values, meaning));
    if (useBlank && blank) {
      if (blank.kind !== spectrum.kind) {
        note(
          'blank',
          'warning',
          'The blank is a different data type from this spectrum, so it was not used.',
        );
      } else {
        const aBlank = toLog(blank.values, blank);
        for (let i = 0; i < a.length; i++) {
          a[i] = (a[i] as number) - interpolate(blank.wavelengthNm, aBlank, x[i] as number);
        }
      }
    }
    if (useOffset) {
      const { fromNm, toNm } = settings.offset;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < a.length; i++) {
        const w = x[i] as number;
        const v = a[i] as number;
        if (w >= fromNm && w <= toNm && Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      if (count === 0) {
        note(
          'offset',
          'warning',
          `No data points lie between ${formatNumber(fromNm)} and ${formatNumber(toNm)} nm, so nothing was removed.`,
        );
      } else {
        const mean = sum / count;
        a = a.map((v) => v - mean);
        note(
          'offset',
          'info',
          `Removed a baseline of ${formatNumber(mean, 4)} (mean over ${count} points between ${formatNumber(fromNm)} and ${formatNumber(toNm)} nm).`,
        );
      }
    }
    // Drop points where the calculation was impossible.
    const keep: number[] = [];
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) keep.push(i);
    const dropped = a.length - keep.length;
    if (dropped > 0) {
      const step: CleaningStep = useBlank ? 'blank' : 'offset';
      note(
        step,
        'warning',
        `${dropped} point${dropped === 1 ? ' was' : 's were'} removed because the logarithm could not be taken (zero or negative value) or the blank does not cover that wavelength.`,
      );
      x = Float64Array.from(keep, (i) => x[i] as number);
      a = Float64Array.from(keep, (i) => a[i] as number);
    }
    values = fromLog(a, meaning);
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
        'The wavelength spacing is not even, so smoothing was skipped. Savitzky–Golay smoothing needs evenly spaced points.',
      );
    } else {
      values = savitzkyGolay(values, window, order);
      note(
        'smoothing',
        'info',
        `Smoothed with a ${window}-point window (about ${formatNumber((window - 1) * (((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1)), 2)} nm wide), polynomial order ${order}.`,
      );
    }
  }
  return { wavelengthNm: x, values, messages };
}

/** What a spectrum can be shown as. */
export type DisplayQuantity = 'absorbance' | 'transmittance' | 'reflectance' | 'kubelka-munk';

export const DISPLAY_LABELS: Record<DisplayQuantity, string> = {
  absorbance: 'Absorbance',
  transmittance: 'Transmittance (%)',
  reflectance: 'Reflectance (%)',
  'kubelka-munk': 'Kubelka–Munk F(R)',
};

/** Quantities a spectrum of this kind can be converted to. The first is the measured one. */
export function availableQuantities(kind: SpectrumKind): DisplayQuantity[] {
  switch (kind) {
    case 'absorbance':
      return ['absorbance', 'transmittance'];
    case 'transmittance':
      return ['transmittance', 'absorbance'];
    case 'reflectance':
      return ['reflectance', 'kubelka-munk'];
  }
}

/**
 * Converts values to the quantity to show. Transmittance and reflectance are shown in percent.
 * Absorbance from transmittance: A = −log₁₀ T. Kubelka–Munk: F(R) = (1 − R)² / (2R). Points where
 * the conversion is undefined become NaN. Returns null when the spectrum cannot be shown that way.
 */
export function toQuantity(
  values: Float64Array,
  meaning: Meaning,
  quantity: DisplayQuantity,
): Float64Array | null {
  if (!availableQuantities(meaning.kind).includes(quantity)) return null;
  const percent = (v: number) => (meaning.scale === 'percent' ? v : v * 100);
  switch (quantity) {
    case 'absorbance':
      return meaning.kind === 'absorbance'
        ? values
        : mapValues(values, (v) => absorbanceFromPercentT(percent(v)));
    case 'transmittance':
      return meaning.kind === 'transmittance'
        ? mapValues(values, percent)
        : mapValues(values, (v) => 100 * 10 ** -v);
    case 'reflectance':
      return mapValues(values, percent);
    case 'kubelka-munk':
      return mapValues(values, (v) => kubelkaMunk(fractionOf(v, meaning)));
  }
}

export interface LambdaMax {
  wavelengthNm: number;
  /** The absorbance-like value at the maximum: A, or F(R) for reflectance. */
  value: number;
  quantity: 'absorbance' | 'kubelka-munk';
}

/**
 * Wavelength of the highest data point of the absorbance (or, for reflectance, the Kubelka–Munk
 * function F(R)) between fromNm and toNm. Transmittance is converted to absorbance first. The
 * resolution is the wavelength step: no curve is fitted. Returns null when no point qualifies.
 */
export function lambdaMax(
  wavelengthNm: Float64Array,
  values: Float64Array,
  meaning: Meaning,
  fromNm = -Infinity,
  toNm = Infinity,
): LambdaMax | null {
  const quantity = meaning.kind === 'reflectance' ? 'kubelka-munk' : 'absorbance';
  const y = toQuantity(values, meaning, quantity);
  if (!y) return null;
  let best: LambdaMax | null = null;
  for (let i = 0; i < y.length; i++) {
    const w = wavelengthNm[i] as number;
    const v = y[i] as number;
    if (w < fromNm || w > toNm || !Number.isFinite(v)) continue;
    if (best === null || v > best.value) best = { wavelengthNm: w, value: v, quantity };
  }
  return best;
}
