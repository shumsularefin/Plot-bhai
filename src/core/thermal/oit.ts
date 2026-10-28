import { linearFit } from '../math/linearFit';

export interface OitInput {
  /** Time in minutes, increasing. */
  timeMin: Float64Array;
  /** Heat flow with exothermic positive (any unit). */
  exo: Float64Array;
  /** Time of the switch from inert gas to oxygen or air, min. */
  switchMin: number;
  /** Window after the switch where the flat baseline is fitted, min. Null: from the switch to halfway to the steepest point. */
  baselineFromMin: number | null;
  baselineToMin: number | null;
}

export interface OitResult {
  /** Oxidation induction time: onset minus switch time, min. */
  oitMin: number;
  onsetMin: number;
  /** Time of the steepest rise and of the exothermic maximum, min. */
  steepestMin: number;
  peakMin: number;
  baseline: { intercept: number; slope: number; fromMin: number; toMin: number };
  tangent: { intercept: number; slope: number };
  notes: string[];
}

export type OitOutcome = { ok: true; result: OitResult } | { ok: false; error: string };

/** Points on each side for the local slope at the steepest point. */
const HALF_WINDOW = 5;

/**
 * Oxidation induction time from an isothermal DSC run (as in ASTM D3895 and ISO 11357-6):
 * the time from the switch to oxygen to the extrapolated onset of the oxidation exotherm. The onset
 * is where the tangent at the steepest point of the rising exotherm meets the baseline, a straight
 * line fitted to the flat part after the switch. The steepest point is the largest local slope (a
 * least-squares line through 2·5 + 1 points) between the switch and the exothermic maximum.
 * OIT = t_onset − t_switch, in minutes.
 */
export function oxidationInductionTime(input: OitInput): OitOutcome {
  const { timeMin: t, exo, switchMin } = input;
  const n = t.length;
  const start = t.findIndex((v) => v >= switchMin);
  if (start < 0 || n - start < 4 * HALF_WINDOW) {
    return { ok: false, error: 'Too few points after the gas switch. Check the switch time.' };
  }
  let peak = start;
  for (let i = start; i < n; i++) if ((exo[i] as number) > (exo[peak] as number)) peak = i;
  const slopeAt = (i: number) => {
    const x: number[] = [];
    const y: number[] = [];
    for (let k = Math.max(0, i - HALF_WINDOW); k <= Math.min(n - 1, i + HALF_WINDOW); k++) {
      x.push(t[k] as number);
      y.push(exo[k] as number);
    }
    return linearFit(x, y);
  };
  let steepest = -1;
  let best = -Infinity;
  for (let i = start + HALF_WINDOW; i <= peak; i++) {
    const fit = slopeAt(i);
    if (fit && fit.slope > best) {
      best = fit.slope;
      steepest = i;
    }
  }
  if (steepest < 0 || !(best > 0)) {
    return {
      ok: false,
      error:
        'No rising exotherm was found after the switch. Check the sign convention and that the run lasted long enough for oxidation to start.',
    };
  }
  const tSteep = t[steepest] as number;
  const fromMin = input.baselineFromMin ?? switchMin;
  const toMin = input.baselineToMin ?? switchMin + (tSteep - switchMin) / 2;
  const bx: number[] = [];
  const by: number[] = [];
  for (let i = start; i < n; i++) {
    const v = t[i] as number;
    if (v >= Math.min(fromMin, toMin) && v <= Math.max(fromMin, toMin)) {
      bx.push(v);
      by.push(exo[i] as number);
    }
  }
  const base = bx.length >= 3 ? linearFit(bx, by) : null;
  const tangentFit = slopeAt(steepest);
  if (!base || !tangentFit) {
    return {
      ok: false,
      error: 'The baseline window holds fewer than 3 points. Widen it.',
    };
  }
  const tangent = {
    slope: tangentFit.slope,
    intercept: (exo[steepest] as number) - tangentFit.slope * tSteep,
  };
  if (!(tangent.slope > base.slope)) {
    return { ok: false, error: 'The tangent does not rise above the baseline.' };
  }
  const onsetMin = (base.intercept - tangent.intercept) / (tangent.slope - base.slope);
  const notes: string[] = [];
  if (onsetMin < switchMin) {
    notes.push(
      'The onset lies before the gas switch: oxidation may have started straight away, or the switch time is wrong.',
    );
  }
  if (Math.max(fromMin, toMin) > onsetMin) {
    notes.push('The baseline window reaches past the onset. Move it to the flat part before.');
  }
  if (peak === n - 1) {
    notes.push(
      'The heat flow is still rising at the end of the file, so the exotherm may not be complete; the steepest point may be too early.',
    );
  }
  return {
    ok: true,
    result: {
      oitMin: onsetMin - switchMin,
      onsetMin,
      steepestMin: tSteep,
      peakMin: t[peak] as number,
      baseline: { intercept: base.intercept, slope: base.slope, fromMin, toMin },
      tangent,
      notes,
    },
  };
}
