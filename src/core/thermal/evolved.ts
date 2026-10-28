import { KELVIN_OFFSET } from './import';
import { interpolate } from './process';

/** How the first column of an evolved-gas file is measured. */
export type EvolvedAxis = 'C' | 'K' | 'min' | 's';

/**
 * Temperatures (°C) of an evolved-gas file's x column. Temperature columns are converted from K if
 * needed. Time columns are mapped onto the TGA run's own time and temperature columns by linear
 * interpolation, so both instruments must share the same time zero; null when the TGA run has no
 * time column.
 */
export function evolvedTemperatures(
  x: Float64Array,
  axis: EvolvedAxis,
  tga: { timeMin: Float64Array | null; temperatureC: Float64Array },
): Float64Array | null {
  if (axis === 'C') return x;
  if (axis === 'K') return x.map((v) => v - KELVIN_OFFSET);
  if (!tga.timeMin) return null;
  const minutes = axis === 's' ? x.map((v) => v / 60) : x;
  return minutes.map((t) => interpolate(tga.timeMin as Float64Array, tga.temperatureC, t));
}

export interface SignalPeak {
  /** Temperature of the largest value, °C. */
  peakC: number;
  /** Index of the mass loss step whose limits contain the peak, or null. */
  step: number | null;
}

/** Where a signal is largest, and which step (by its temperature limits, °C) contains that point. */
export function signalPeak(
  temperatureC: Float64Array,
  signal: Float64Array,
  steps: readonly { fromC: number; toC: number }[],
): SignalPeak | null {
  let best = -1;
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i] as number;
    if (Number.isFinite(v) && (best < 0 || v > (signal[best] as number))) best = i;
  }
  if (best < 0) return null;
  const peakC = temperatureC[best] as number;
  const index = steps.findIndex((s) => peakC >= s.fromC && peakC <= s.toC);
  return { peakC, step: index < 0 ? null : index };
}
