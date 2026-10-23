/** Step-size statistics for an increasing 2θ axis, in degrees. */
export interface StepStats {
  median: number;
  min: number;
  max: number;
  /** True when every step is within 1 % of the median. */
  uniform: boolean;
}

export function stepStats(twoTheta: ArrayLike<number>): StepStats {
  const n = twoTheta.length;
  const steps = new Float64Array(Math.max(n - 1, 0));
  for (let i = 1; i < n; i++) steps[i - 1] = (twoTheta[i] as number) - (twoTheta[i - 1] as number);
  steps.sort();
  const count = steps.length;
  if (count === 0) return { median: NaN, min: NaN, max: NaN, uniform: true };
  const mid = count >> 1;
  const median =
    count % 2 === 1
      ? (steps[mid] as number)
      : ((steps[mid - 1] as number) + (steps[mid] as number)) / 2;
  const min = steps[0] as number;
  const max = steps[count - 1] as number;
  return { median, min, max, uniform: max - min <= 0.01 * Math.abs(median) };
}

/** Facts shown on the data summary card. Angles in degrees; intensity in the pattern's own unit. */
export interface PatternSummary {
  twoThetaMin: number;
  twoThetaMax: number;
  step: StepStats;
  points: number;
  maxIntensity: number;
  /** 2θ (degrees) at the maximum intensity. */
  maxIntensityAt: number;
}

export function summarise(
  twoTheta: ArrayLike<number>,
  intensity: ArrayLike<number>,
): PatternSummary {
  let maxIndex = 0;
  for (let i = 1; i < intensity.length; i++) {
    if ((intensity[i] as number) > (intensity[maxIndex] as number)) maxIndex = i;
  }
  return {
    twoThetaMin: twoTheta[0] as number,
    twoThetaMax: twoTheta[twoTheta.length - 1] as number,
    step: stepStats(twoTheta),
    points: twoTheta.length,
    maxIntensity: intensity[maxIndex] as number,
    maxIntensityAt: twoTheta[maxIndex] as number,
  };
}
