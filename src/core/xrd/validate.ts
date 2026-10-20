import { formatNumber } from './parsers/numbers';
import { stepStats } from './summary';
import type { DataMessage, IntensityUnit, Pattern, RawScan } from './types';

/** Fewer points than this cannot be a diffraction pattern. */
const MIN_POINTS = 10;
/** Below this, warn that the pattern is unusually short. */
const FEW_POINTS = 200;
/** Steps larger than this (degrees) are coarse for powder XRD. */
const COARSE_STEP = 0.1;

export interface ValidatedScan {
  twoTheta: Float64Array;
  intensity: Float64Array;
  sigma?: Float64Array;
  intensityUnit: IntensityUnit;
  unitOrigin: 'file' | 'guess';
  /** Notes from reading the file plus any change made here (such as reversing). */
  notes: DataMessage[];
}

export type ValidationResult = { ok: true; scan: ValidatedScan } | { ok: false; error: string };

const deg = (value: number) => `${formatNumber(value)}°`;

/**
 * Checks a raw scan for problems that make it unusable and converts it to the stored form.
 * A scan recorded from high to low 2θ is reversed. Expects 2θ in degrees, but values that look
 * like radians are accepted here and reported by checkPattern so the user can convert them.
 */
export function validateScan(raw: RawScan): ValidationResult {
  const n = raw.twoTheta.length;
  if (n < MIN_POINTS) {
    return {
      ok: false,
      error: `Only ${n} data point${n === 1 ? ' was' : 's were'} found. A diffraction pattern normally has hundreds or thousands.`,
    };
  }

  const notes: DataMessage[] = [...raw.notes];
  let twoTheta = Float64Array.from(raw.twoTheta);
  let intensity = Float64Array.from(raw.intensity);
  let sigma = raw.sigma ? Float64Array.from(raw.sigma) : undefined;

  if ((twoTheta[n - 1] as number) < (twoTheta[0] as number) && isStrictlyDecreasing(twoTheta)) {
    twoTheta = twoTheta.reverse();
    intensity = intensity.reverse();
    sigma = sigma?.reverse();
    notes.push({ level: 'info', text: '2θ ran from high to low, so the data were reversed.' });
  }
  for (let i = 1; i < n; i++) {
    const previous = twoTheta[i - 1] as number;
    const current = twoTheta[i] as number;
    if (current <= previous) {
      return {
        ok: false,
        error:
          current === previous
            ? `2θ = ${deg(current)} appears twice in a row (points ${i} and ${i + 1}). 2θ must increase from point to point.`
            : `2θ goes backwards at point ${i + 1} (from ${deg(previous)} to ${deg(current)}). 2θ must increase; the file may contain more than one scan joined together.`,
      };
    }
  }

  const max2Theta = twoTheta[n - 1] as number;
  if (max2Theta > 180) {
    return {
      ok: false,
      error: `The first column goes up to ${formatNumber(max2Theta)}, but 2θ in degrees cannot be above 180°. Check that the first column is 2θ (not, for example, a point number).`,
    };
  }

  const { low, high, allWhole } = intensityStats(intensity);
  if (low === high) {
    return {
      ok: false,
      error: `Every intensity value is ${formatNumber(low)}, so there is no pattern to analyse.`,
    };
  }

  const intensityUnit = raw.unitFromFile ?? (allWhole ? 'counts' : 'cps');
  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(sigma && { sigma }),
      intensityUnit,
      unitOrigin: raw.unitFromFile ? 'file' : 'guess',
      notes,
    },
  };
}

export interface PatternCheck {
  messages: DataMessage[];
  /** True when 2θ looks like it is in radians; the UI offers a conversion. */
  looksLikeRadians: boolean;
}

/**
 * Plain-language checks on a stored pattern, re-run whenever the data or the chosen unit
 * changes. twoTheta in degrees (or radians, which is what the radians check looks for).
 */
export function checkPattern(pattern: {
  twoTheta: Float64Array;
  intensity: Float64Array;
  intensityUnit: IntensityUnit;
  unitOrigin: Pattern['unitOrigin'];
}): PatternCheck {
  const { twoTheta, intensity } = pattern;
  const n = twoTheta.length;
  const messages: DataMessage[] = [];
  const min2Theta = twoTheta[0] as number;
  const max2Theta = twoTheta[n - 1] as number;

  const looksLikeRadians = max2Theta <= Math.PI && max2Theta - min2Theta >= 0.05;
  if (looksLikeRadians) {
    messages.push({
      level: 'warning',
      text: `2θ only runs from ${formatNumber(min2Theta)} to ${formatNumber(max2Theta)}. This looks like radians rather than degrees. If it is a low-angle scan measured in degrees, ignore this.`,
    });
  } else {
    messages.push(...stepMessages(twoTheta));
  }
  if (min2Theta < 0) {
    messages.push({
      level: 'warning',
      text: 'Some 2θ values are negative. Check the first column is 2θ.',
    });
  }
  if (n < FEW_POINTS) {
    messages.push({
      level: 'warning',
      text: `Only ${n} data points. Most powder scans have many more.`,
    });
  }

  const { low, high, allWhole } = intensityStats(intensity);
  if (low < 0) {
    messages.push({
      level: 'warning',
      text: 'Some intensities are negative. Raw detector counts cannot be negative, so the data may already have a background removed.',
    });
  }
  if (pattern.unitOrigin === 'guess') {
    messages.push({
      level: 'info',
      text: allWhole
        ? 'All intensities are whole numbers, so they look like raw counts. Change the unit below if they are counts per second.'
        : 'Intensities have decimals, so they look like counts per second (or already scaled). Change the unit below if they are raw counts.',
    });
  }
  if (pattern.intensityUnit === 'counts' && !allWhole) {
    messages.push({
      level: 'warning',
      text: 'The unit is set to counts, but some intensities have decimals. Raw counts are whole numbers.',
    });
  }
  if (!allWhole && (high === 1 || high === 100)) {
    messages.push({
      level: 'info',
      text: `The highest intensity is exactly ${high}, so the data may already be normalised.`,
    });
  }
  return { messages, looksLikeRadians };
}

function intensityStats(intensity: Float64Array) {
  let low = Infinity;
  let high = -Infinity;
  let allWhole = true;
  for (const value of intensity) {
    if (value < low) low = value;
    if (value > high) high = value;
    if (allWhole && !Number.isInteger(value)) allWhole = false;
  }
  return { low, high, allWhole };
}

function isStrictlyDecreasing(values: Float64Array): boolean {
  for (let i = 1; i < values.length; i++) {
    if ((values[i] as number) >= (values[i - 1] as number)) return false;
  }
  return true;
}

function stepMessages(twoTheta: Float64Array): DataMessage[] {
  const step = stepStats(twoTheta);
  const messages: DataMessage[] = [];
  if (step.max > 1.5 * step.min) {
    messages.push({
      level: 'warning',
      text: `The step size changes from ${deg(step.min)} to ${deg(step.max)}. A normal scan has a constant step, so check this is one continuous scan.`,
    });
  }
  if (step.median > COARSE_STEP) {
    messages.push({
      level: 'warning',
      text: `The step size is ${deg(step.median)}, which is coarse for powder XRD. Narrow peaks may be described by only a few points.`,
    });
  }
  return messages;
}

/**
 * Converts angles from radians to degrees: degrees = radians × 180 / π.
 */
export function radiansToDegrees(values: Float64Array): Float64Array {
  return values.map((v) => (v * 180) / Math.PI);
}
