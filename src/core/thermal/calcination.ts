import { massAtTemperature, type StepResult } from './steps';

export interface CalcinationSettings {
  /** Steps that lose less than this (% of the reference mass) are not "significant". */
  thresholdPct: number;
  /** Safety margin added to the endset of the last significant step, in °C. */
  marginC: number;
}

export const DEFAULT_CALCINATION: CalcinationSettings = { thresholdPct: 1, marginC: 50 };

/** Spacing of the three temperatures proposed for testing, °C. A convention of this site. */
export const CANDIDATE_SPACING_C = 50;
/** Mass changes smaller than this (percentage points) above the minimum count as a flat plateau. */
const FLAT_PCT = 0.5;
/** An endset this close to the end of the run (°C) may belong to a step that is not finished. */
const UNFINISHED_C = 20;

export interface Plateau {
  fromC: number;
  /** Highest temperature of the run. */
  toC: number;
  /** Lowest and highest mass on the plateau, %. */
  minPct: number;
  maxPct: number;
  /** True when the mass changes by less than 0.5 percentage points over the plateau. */
  flat: boolean;
}

export interface CalcinationSuggestion {
  /** The last step whose loss reaches the threshold, or null when there is none. */
  lastStep: StepResult | null;
  /** Endset of that step plus the margin, °C. */
  minimumC: number | null;
  /** Three temperatures to test, from the minimum upwards, °C. */
  candidatesC: number[];
  /** Mass above the minimum up to the end of the run; null when the run ends before it. */
  plateau: Plateau | null;
  /** Plain-language warnings about this suggestion. */
  warnings: string[];
}

/** Always shown with a suggestion. */
export const CALCINATION_WARNING =
  'This is a starting point, not an optimal temperature. In a dynamic TGA run the temperatures depend on the heating rate, the sample mass and the atmosphere, and the hold time during calcination matters too: a step that ends at one temperature in a ramp can finish at a lower temperature given hours. Confirm by XRD of samples calcined at the temperatures below.';

/**
 * Suggests a minimum calcination temperature: T_min = T_endset(last significant step) + margin,
 * all in °C. The last significant step is the one at the highest temperature whose mass loss is
 * at least `thresholdPct`. Three temperatures T_min, T_min + 50 and T_min + 100 °C are proposed
 * for testing. The plateau is the mass curve from T_min to the end of the run.
 */
export function suggestCalcination(
  steps: readonly StepResult[],
  temperatureC: Float64Array,
  massPct: Float64Array,
  settings: CalcinationSettings,
): CalcinationSuggestion {
  const significant = steps.filter((s) => s.lossPct >= settings.thresholdPct);
  const lastStep = significant.reduce<StepResult | null>(
    (best, s) => (best === null || s.endsetC > best.endsetC ? s : best),
    null,
  );
  const warnings: string[] = [];
  if (!lastStep) {
    warnings.push(
      steps.length === 0
        ? 'No mass loss step was found, so there is nothing to base a temperature on. Check the step detection in step 3.'
        : `No step loses ${settings.thresholdPct} % or more. Lower the threshold to include smaller steps.`,
    );
    return { lastStep: null, minimumC: null, candidatesC: [], plateau: null, warnings };
  }
  const end = temperatureC[temperatureC.length - 1] as number;
  const minimumC = lastStep.endsetC + settings.marginC;
  const candidatesC = [0, 1, 2].map((i) => Math.round(minimumC + i * CANDIDATE_SPACING_C));
  if (end - lastStep.endsetC < UNFINISHED_C) {
    warnings.push(
      `The last step ends at ${lastStep.endsetC.toFixed(0)} °C, almost at the end of the run (${end.toFixed(0)} °C). It may not be finished, so the suggestion is probably too low. Run to a higher temperature if you can.`,
    );
  }
  let plateau: Plateau | null = null;
  if (minimumC >= end) {
    warnings.push(
      `The run ends at ${end.toFixed(0)} °C, below the suggested minimum, so no plateau above it was measured.`,
    );
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    temperatureC.forEach((t, i) => {
      if (t < minimumC) return;
      const m = massPct[i] as number;
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    });
    const atMinimum = massAtTemperature(temperatureC, massPct, minimumC);
    if (atMinimum !== null) {
      lo = Math.min(lo, atMinimum);
      hi = Math.max(hi, atMinimum);
    }
    plateau = { fromC: minimumC, toC: end, minPct: lo, maxPct: hi, flat: hi - lo < FLAT_PCT };
    if (!plateau.flat) {
      warnings.push(
        `The mass is not flat above ${minimumC.toFixed(0)} °C (it changes by ${(hi - lo).toFixed(1)} percentage points). Another step may follow, or the sample may be gaining mass; check the curve.`,
      );
    }
  }
  return { lastStep, minimumC, candidatesC, plateau, warnings };
}
