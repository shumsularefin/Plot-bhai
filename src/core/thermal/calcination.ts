import { formatNumber } from '../xrd/parsers/numbers';
import { interpolate } from './process';
import type { StepResult } from './steps';

export interface CalcinationOptions {
  /** A step counts as significant when it loses at least this much, % of the reference mass. */
  minLossPct: number;
  /** Added to the endset of the last significant step, °C. */
  marginC: number;
  /** Distance between the three candidate temperatures, °C. */
  spacingC: number;
}

export const DEFAULT_CALCINATION: CalcinationOptions = {
  minLossPct: 1,
  marginC: 50,
  spacingC: 100,
};

export type CalcinationSuggestion =
  | {
      ok: true;
      /** The last significant step. */
      step: StepResult;
      /** Endset of that step plus the margin: the lowest temperature to try, °C. */
      minimumC: number;
      /** Up to three temperatures to test, rising, all inside the measured range. */
      candidatesC: number[];
      /** Highest temperature measured, °C. */
      dataEndC: number;
      /** Mass change between the minimum and the end of the data, % of the reference mass (end − start). */
      plateauChangePct: number | null;
      /** Plain-language reasons and cautions, shown next to the numbers. */
      notes: string[];
    }
  | { ok: false; error: string };

/**
 * Starting-point temperatures for calcination from a TGA curve (an estimate, not an optimum):
 *   minimum = T_endset(last significant step) + margin
 * and candidates at minimum, minimum + spacing and minimum + 2·spacing that are still inside
 * the measured range. The plateau is the mass above the minimum; its change is reported so
 * the user can see whether the curve is flat there. The candidates are to be confirmed
 * experimentally, for example by XRD of samples calcined at each.
 */
export function suggestCalcination(
  temperatureC: Float64Array,
  massPct: Float64Array,
  steps: readonly StepResult[],
  options: CalcinationOptions,
): CalcinationSuggestion {
  const significant = steps.filter((s) => s.lossPct >= options.minLossPct);
  const last = significant[significant.length - 1];
  if (!last) {
    return {
      ok: false,
      error: `No step loses at least ${formatNumber(options.minLossPct, 1)} % of the mass, so there is no mass loss to calcine past. Lower the threshold or check the steps.`,
    };
  }
  if (!Number.isFinite(last.endsetC)) {
    return { ok: false, error: `The endset of step ${last.id} could not be worked out.` };
  }
  const end = temperatureC[temperatureC.length - 1] as number;
  const minimumC = last.endsetC + options.marginC;
  const candidatesC = [0, 1, 2].map((k) => minimumC + k * options.spacingC).filter((t) => t <= end);
  const notes: string[] = [
    `The last significant mass loss is step ${last.id}, which ends (extrapolated endset) at ${formatNumber(last.endsetC, 0)} °C. Adding a margin of ${formatNumber(options.marginC, 0)} °C gives ${formatNumber(minimumC, 0)} °C as the lowest temperature worth trying.`,
  ];
  let plateauChangePct: number | null = null;
  if (minimumC > end) {
    notes.push(
      `The curve ends at ${formatNumber(end, 0)} °C, below this minimum, so no flat mass plateau was measured above it. Run the TGA to a higher temperature before relying on this.`,
    );
  } else {
    plateauChangePct =
      (massPct[massPct.length - 1] as number) - interpolate(temperatureC, massPct, minimumC);
    notes.push(
      `Between ${formatNumber(minimumC, 0)} and ${formatNumber(end, 0)} °C the mass changes by ${formatNumber(plateauChangePct, 2)} % of the reference mass${Math.abs(plateauChangePct) < options.minLossPct ? ', so the curve is flat there' : ', so the curve is not flat there: check for another step'}.`,
    );
  }
  return {
    ok: true,
    step: last,
    minimumC,
    candidatesC,
    dataEndC: end,
    plateauChangePct,
    notes,
  };
}

export const CALCINATION_WARNING =
  'This is a starting point, not an optimal temperature. Temperatures from a dynamic TGA run depend on the heating rate, sample mass and atmosphere, and the hold time during calcination matters (a long hold can finish a reaction at a lower temperature). Confirm experimentally, for example by XRD of samples calcined at each candidate temperature.';
