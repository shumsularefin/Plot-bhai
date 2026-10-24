import { pickPeaks } from '../ftir/peaks';
import { formatNumber } from '../xrd/parsers/numbers';
import { interpolate } from './process';

/** The temperature limits of one mass loss step, in °C. Numbers for a step follow from these. */
export interface StepLimit {
  id: number;
  fromC: number;
  toC: number;
}

export interface DetectOptions {
  /** Smallest DTG peak height above its surroundings, in % of the tallest DTG peak. */
  prominencePercent: number;
  /** Peaks closer than this (°C) are merged: the taller one is kept. */
  minSeparationC: number;
}

export const DEFAULT_DETECT: DetectOptions = { prominencePercent: 5, minSeparationC: 20 };

/** Default step limits end where the DTG falls to this share of the peak height. */
const LIMIT_FRACTION = 0.02;
/** Two steps are one overlapping region when the DTG between them stays above this share of the smaller peak. */
const OVERLAP_FRACTION = 0.1;

/** Steps of a TGA curve, as numbers (all temperatures in °C, mass in % of the reference mass). */
export interface StepResult extends StepLimit {
  /** Temperature of the fastest mass loss (DTG maximum). */
  peakC: number;
  /** Height of the DTG peak in %/°C. */
  peakDtg: number;
  /** Extrapolated onset: baseline before the step meets the tangent at the steepest point. */
  onsetC: number;
  /** Extrapolated endset: the same tangent meets the baseline after the step. */
  endsetC: number;
  /** Mass at the start and end limits, in %. */
  massBeforePct: number;
  massAfterPct: number;
  /** Mass lost in the step, % of the reference mass. */
  lossPct: number;
  /** Mass lost in mg, null if the reference mass is unknown. */
  lossMg: number | null;
  /** Mass left after the step, % (and mg when known). */
  residualPct: number;
  residualMg: number | null;
}

export interface OverlapRegion {
  /** ids of the steps that overlap. */
  ids: number[];
  fromC: number;
  toC: number;
  lossPct: number;
  lossMg: number | null;
  note: string;
}

export interface StepAnalysis {
  steps: StepResult[];
  regions: OverlapRegion[];
}

/**
 * Finds the DTG peaks and gives each a start and end. Peaks are local maxima of the DTG whose
 * prominence is at least `prominencePercent` of the tallest peak; of two peaks closer than
 * `minSeparationC` only the taller is kept. A step starts and ends where the DTG has fallen to
 * 2 % of its peak height, or at the valley towards the next peak, or at the end of the data.
 */
export function detectSteps(
  temperatureC: Float64Array,
  dtg: Float64Array,
  options: DetectOptions,
): StepLimit[] {
  const n = dtg.length;
  let top = 0;
  for (const v of dtg) top = Math.max(top, v);
  if (!(top > 0) || n < 3) return [];
  const found = pickPeaks(temperatureC, dtg, {
    minProminence: (options.prominencePercent / 100) * top,
  });
  const byHeight = [...found].sort((a, b) => b.height - a.height);
  const kept: typeof found = [];
  for (const peak of byHeight) {
    if (kept.every((k) => Math.abs(k.wavenumber - peak.wavenumber) >= options.minSeparationC)) {
      kept.push(peak);
    }
  }
  kept.sort((a, b) => a.wavenumber - b.wavenumber);
  const indexOf = (t: number) => {
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs((temperatureC[i] as number) - t) < Math.abs((temperatureC[best] as number) - t))
        best = i;
    }
    return best;
  };
  const centres = kept.map((p) => indexOf(p.wavenumber));
  return centres.map((c, k) => {
    const level = LIMIT_FRACTION * (dtg[c] as number);
    const leftBound = k > 0 ? valleyBetween(dtg, centres[k - 1] as number, c) : 0;
    const rightBound =
      k < centres.length - 1 ? valleyBetween(dtg, c, centres[k + 1] as number) : n - 1;
    let left = c;
    while (left > leftBound && (dtg[left - 1] as number) > level) left--;
    let right = c;
    while (right < rightBound && (dtg[right + 1] as number) > level) right++;
    return {
      id: k + 1,
      fromC: temperatureC[left] as number,
      toC: temperatureC[right] as number,
    };
  });
}

/** Index of the lowest DTG value strictly between two indices (the valley between two peaks). */
function valleyBetween(dtg: Float64Array, a: number, b: number): number {
  let lowest = a;
  for (let i = a; i <= b; i++) if ((dtg[i] as number) < (dtg[lowest] as number)) lowest = i;
  return lowest;
}

/**
 * Numbers for one step between its limits.
 * Peak: the DTG maximum between the limits. With s = DTG at the peak (%/°C, the steepest slope
 * of the mass curve) and m(T) the mass in %:
 *   onset  T_on  = T_p − (m_before − m(T_p)) / s
 *   endset T_end = T_p + (m(T_p) − m_after) / s
 * where m_before and m_after are the masses at the two limits (the baselines). This is the
 * usual extrapolated onset: the tangent at the steepest point meets the horizontal baseline.
 * Mass lost = m_before − m_after (% of the reference mass; mg = % · reference mass / 100).
 */
export function stepResult(
  temperatureC: Float64Array,
  massPct: Float64Array,
  dtg: Float64Array,
  limit: StepLimit,
  referenceMg: number | null,
): StepResult {
  const from = Math.min(limit.fromC, limit.toC);
  const to = Math.max(limit.fromC, limit.toC);
  let peak = -1;
  for (let i = 0; i < temperatureC.length; i++) {
    const t = temperatureC[i] as number;
    if (t < from || t > to) continue;
    if (peak === -1 || (dtg[i] as number) > (dtg[peak] as number)) peak = i;
  }
  if (peak === -1) {
    peak = temperatureC.findIndex((t) => t >= from);
    if (peak === -1) peak = temperatureC.length - 1;
  }
  const peakC = temperatureC[peak] as number;
  const peakDtg = dtg[peak] as number;
  const before = interpolate(temperatureC, massPct, from);
  const after = interpolate(temperatureC, massPct, to);
  const atPeak = interpolate(temperatureC, massPct, peakC);
  const valid = peakDtg > 0;
  const loss = before - after;
  const toMg = (pct: number) => (referenceMg === null ? null : (pct * referenceMg) / 100);
  return {
    id: limit.id,
    fromC: from,
    toC: to,
    peakC,
    peakDtg,
    onsetC: valid ? peakC - (before - atPeak) / peakDtg : NaN,
    endsetC: valid ? peakC + (atPeak - after) / peakDtg : NaN,
    massBeforePct: before,
    massAfterPct: after,
    lossPct: loss,
    lossMg: toMg(loss),
    residualPct: after,
    residualMg: toMg(after),
  };
}

/** Results for all limits (sorted by temperature) and the regions where steps overlap. */
export function analyseSteps(
  temperatureC: Float64Array,
  massPct: Float64Array,
  dtg: Float64Array,
  limits: readonly StepLimit[],
  referenceMg: number | null,
): StepAnalysis {
  const steps = limits
    .map((l) => stepResult(temperatureC, massPct, dtg, l, referenceMg))
    .sort((a, b) => a.peakC - b.peakC);
  const regions: OverlapRegion[] = [];
  let group: StepResult[] = [];
  const flush = () => {
    if (group.length > 1) {
      const first = group[0] as StepResult;
      const last = group[group.length - 1] as StepResult;
      const lossPct = first.massBeforePct - last.massAfterPct;
      regions.push({
        ids: group.map((s) => s.id),
        fromC: first.fromC,
        toC: last.toC,
        lossPct,
        lossMg: referenceMg === null ? null : (lossPct * referenceMg) / 100,
        note: `Steps ${group.map((s) => s.id).join(' and ')} overlap: the DTG curve between their peaks stays high, so the mass loss cannot be split between them exactly. Together they lose ${formatNumber(lossPct, 2)} % between ${formatNumber(first.fromC, 0)} and ${formatNumber(last.toC, 0)} °C; the individual values are approximate.`,
      });
    }
    group = [];
  };
  for (const step of steps) {
    const previous = group[group.length - 1];
    if (previous && overlaps(temperatureC, dtg, previous, step)) group.push(step);
    else {
      flush();
      group = [step];
    }
  }
  flush();
  return { steps, regions };
}

function overlaps(
  temperatureC: Float64Array,
  dtg: Float64Array,
  a: StepResult,
  b: StepResult,
): boolean {
  let valley = Infinity;
  for (let i = 0; i < temperatureC.length; i++) {
    const t = temperatureC[i] as number;
    if (t >= a.peakC && t <= b.peakC) valley = Math.min(valley, dtg[i] as number);
  }
  return valley > OVERLAP_FRACTION * Math.min(a.peakDtg, b.peakDtg);
}

/**
 * Temperature at which the mass first falls to `levelPct` % (a downward crossing, linearly
 * interpolated). T5 %, T10 % and T50 % are the temperatures where 5, 10 and 50 % of the mass
 * is lost, so the level is 95, 90 and 50. Null if the curve never gets that low.
 */
export function temperatureAtMass(
  temperatureC: Float64Array,
  massPct: Float64Array,
  levelPct: number,
): number | null {
  if (!((massPct[0] as number) > levelPct)) return null;
  for (let i = 1; i < massPct.length; i++) {
    const m1 = massPct[i] as number;
    if (m1 <= levelPct) {
      const m0 = massPct[i - 1] as number;
      const t0 = temperatureC[i - 1] as number;
      return t0 + ((m0 - levelPct) / (m0 - m1)) * ((temperatureC[i] as number) - t0);
    }
  }
  return null;
}

/** Mass in % at a temperature (linear interpolation), or null outside the measured range. */
export function massAtTemperature(
  temperatureC: Float64Array,
  massPct: Float64Array,
  atC: number,
): number | null {
  const n = temperatureC.length;
  if (atC < (temperatureC[0] as number) || atC > (temperatureC[n - 1] as number)) return null;
  return interpolate(temperatureC, massPct, atC);
}
