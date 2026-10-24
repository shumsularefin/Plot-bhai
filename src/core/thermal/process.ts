import type { DataMessage } from '../xrd/types';
import { formatNumber } from '../xrd/parsers/numbers';
import { smooth } from './smooth';
import type { RunInfo, TgaCurve, ThermalRun } from './types';

export interface CleanSettings {
  /** Keep only the heating ramp between these temperatures (°C); null means the whole ramp. */
  fromC: number | null;
  toC: number | null;
  /** Smoothing window for the mass in °C; 0 means no smoothing. */
  smoothWindowC: number;
  /** Set 100 % to the mass at this temperature (°C); null means the mass at the start. */
  normaliseAtC: number | null;
  /** Subtract the blank curve (needs a blank run in the same mass unit). */
  useBlank: boolean;
}

export const DEFAULT_CLEAN: CleanSettings = {
  fromC: null,
  toC: null,
  smoothWindowC: 0,
  normaliseAtC: null,
  useBlank: false,
};

/** Linear interpolation of y at x0 on increasing x; the end values are held outside the range. */
export function interpolate(x: ArrayLike<number>, y: ArrayLike<number>, x0: number): number {
  const n = x.length;
  if (x0 <= (x[0] as number)) return y[0] as number;
  if (x0 >= (x[n - 1] as number)) return y[n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((x[mid] as number) <= x0) lo = mid;
    else hi = mid;
  }
  const t = (x0 - (x[lo] as number)) / ((x[hi] as number) - (x[lo] as number));
  return (y[lo] as number) + t * ((y[hi] as number) - (y[lo] as number));
}

/**
 * Indices of the heating ramp: from the first point to the first point of highest temperature,
 * keeping only points hotter than every point before them. This drops isothermal holds and the
 * cooling part, and makes temperature strictly increasing. Optionally cut to [fromC, toC].
 */
export function rampIndices(
  temperatureC: Float64Array,
  fromC: number | null = null,
  toC: number | null = null,
): number[] {
  let peak = 0;
  for (let i = 1; i < temperatureC.length; i++) {
    if ((temperatureC[i] as number) > (temperatureC[peak] as number)) peak = i;
  }
  const kept: number[] = [];
  let last = -Infinity;
  for (let i = 0; i <= peak; i++) {
    const t = temperatureC[i] as number;
    if (!(t > last)) continue;
    last = t;
    if ((fromC !== null && t < fromC) || (toC !== null && t > toC)) continue;
    kept.push(i);
  }
  return kept;
}

/**
 * Average heating rate in K/min from the time and temperature columns, as the slope of a
 * straight line through the heating ramp (least squares). Null when there is no time column or
 * the ramp is too short.
 */
export function estimateHeatingRate(run: ThermalRun): number | null {
  if (!run.timeMin) return null;
  const idx = rampIndices(run.temperatureC);
  if (idx.length < 3) return null;
  const t = idx.map((i) => run.timeMin?.[i] as number);
  const T = idx.map((i) => run.temperatureC[i] as number);
  const mean = (v: number[]) => v.reduce((s, a) => s + a, 0) / v.length;
  const tm = mean(t);
  const Tm = mean(T);
  let num = 0;
  let den = 0;
  for (let i = 0; i < t.length; i++) {
    num += ((t[i] as number) - tm) * ((T[i] as number) - Tm);
    den += ((t[i] as number) - tm) ** 2;
  }
  return den > 0 && num / den > 0 ? num / den : null;
}

export type CleanResult = { ok: true; curve: TgaCurve } | { ok: false; error: string };

/**
 * Turns a run into the TGA curve used by the later steps, in this order:
 * 1. keep the heating ramp (optionally between two temperatures),
 * 2. subtract the blank curve (same mass unit, interpolated to the sample temperatures),
 * 3. convert to % of the reference mass (the initial mass you entered, else the first value;
 *    mass already in % is used as it is),
 * 4. smooth,
 * 5. set 100 % to the mass at the chosen temperature.
 * mg values are m(%) · reference mass / 100 and exist only when the reference mass is known.
 */
export function cleanRun(
  run: ThermalRun,
  blank: ThermalRun | null,
  info: Pick<RunInfo, 'initialMassMg'>,
  settings: CleanSettings,
): CleanResult {
  const mass = run.mass;
  if (!mass) return { ok: false, error: 'This run has no mass column, so there is no TGA curve.' };
  const notes: DataMessage[] = [];
  const idx = rampIndices(run.temperatureC, settings.fromC, settings.toC);
  if (idx.length < 10) {
    return { ok: false, error: 'Fewer than 10 points are left in the chosen temperature range.' };
  }
  const dropped = run.temperatureC.length - idx.length;
  if (settings.fromC === null && settings.toC === null && dropped > 0) {
    notes.push({
      level: 'info',
      text: `${dropped} points were left out: they repeat a temperature already passed (isothermal hold) or come after the highest temperature (cooling).`,
    });
  }
  const T = Float64Array.from(idx, (i) => run.temperatureC[i] as number);
  let m: Float64Array = Float64Array.from(idx, (i) => mass[i] as number);

  if (settings.useBlank && blank?.mass) {
    if (blank.massUnit !== run.massUnit) {
      return {
        ok: false,
        error: 'The blank and the sample must have mass in the same unit (both mg or both %).',
      };
    }
    const bi = rampIndices(blank.temperatureC);
    const bT = Float64Array.from(bi, (i) => blank.temperatureC[i] as number);
    const bm = Float64Array.from(bi, (i) => blank.mass?.[i] as number);
    if (bT.length < 2) return { ok: false, error: 'The blank run has too few points.' };
    if (
      (T[0] as number) < (bT[0] as number) ||
      (T[T.length - 1] as number) > (bT[bT.length - 1] as number)
    ) {
      notes.push({
        level: 'warning',
        text: `The blank only covers ${formatNumber(bT[0] as number, 0)} to ${formatNumber(bT[bT.length - 1] as number, 0)} °C. Outside that range its end value is held constant, so the correction there is a guess.`,
      });
    }
    m = m.map((v, i) => v - interpolate(bT, bm, T[i] as number));
    notes.push({ level: 'info', text: 'The blank curve was subtracted from the sample mass.' });
  }

  let referenceMg: number | null = null;
  if (run.massUnit === 'mg') {
    const reference = info.initialMassMg ?? (m[0] as number);
    if (!(reference > 0)) return { ok: false, error: 'The starting mass is zero or negative.' };
    if (info.initialMassMg === null) {
      notes.push({
        level: 'info',
        text: `No initial mass was entered, so the first mass value (${formatNumber(reference, 3)} mg) is used as 100 %.`,
      });
    }
    referenceMg = reference;
    m = m.map((v) => (100 * v) / reference);
  } else {
    referenceMg = info.initialMassMg;
  }

  if (settings.smoothWindowC > 0) m = smooth(T, m, settings.smoothWindowC);

  if (settings.normaliseAtC !== null) {
    const at = interpolate(T, m, settings.normaliseAtC);
    if (!(at > 0))
      return { ok: false, error: 'The mass at the normalisation temperature is zero or negative.' };
    const factor = 100 / at;
    m = m.map((v) => v * factor);
    // 100 % now stands for the mass at that temperature, which is `at` % of the first reference.
    if (referenceMg !== null) referenceMg = (referenceMg * at) / 100;
    notes.push({
      level: 'info',
      text: `Mass is set to 100 % at ${formatNumber(settings.normaliseAtC, 1)} °C.`,
    });
  }

  const massMg = referenceMg === null ? null : m.map((v) => (v * (referenceMg as number)) / 100);
  return { ok: true, curve: { temperatureC: T, massPct: m, massMg, referenceMg, notes } };
}
