import { dtg } from './smooth';
import { massAtTemperature, temperatureAtMass } from './steps';

/** Key numbers of one cleaned TGA curve, for comparing samples side by side. */
export interface RunSummary {
  /** Temperatures (°C) where 5, 10 and 50 % of the mass is lost; null when never reached. */
  t5: number | null;
  t10: number | null;
  t50: number | null;
  /** Mass (%) at `residueAtC`, null when outside the measured range or not asked for. */
  residuePct: number | null;
  /** Temperature (°C) of the fastest mass loss: the highest point of the DTG curve. */
  dtgPeakC: number | null;
  /** DTG at that point, %/°C. */
  dtgPeak: number | null;
  /** Total mass lost over the curve, % points (first value minus last). */
  totalLossPct: number;
}

/**
 * Summary of a cleaned TGA curve (temperature °C, mass % of the reference mass):
 * T5, T10 and T50 (temperatures at 95, 90 and 50 % mass, see temperatureAtMass), the residue
 * at a chosen temperature, and the fastest mass loss, the maximum of the DTG curve
 * DTG = −dm/dT (%/°C, local quadratic over `dtgWindowC`, see dtg).
 */
export function summariseRun(
  temperatureC: Float64Array,
  massPct: Float64Array,
  dtgWindowC: number,
  residueAtC: number | null,
): RunSummary {
  const slope = dtg(temperatureC, massPct, dtgWindowC);
  let peak = -1;
  for (let i = 0; i < slope.length; i++) {
    if (peak < 0 || (slope[i] as number) > (slope[peak] as number)) peak = i;
  }
  // Below 10⁻⁶ %/°C the curve is flat within rounding: there is no mass loss to point at.
  const rising = peak >= 0 && (slope[peak] as number) > 1e-6;
  return {
    t5: temperatureAtMass(temperatureC, massPct, 95),
    t10: temperatureAtMass(temperatureC, massPct, 90),
    t50: temperatureAtMass(temperatureC, massPct, 50),
    residuePct: residueAtC === null ? null : massAtTemperature(temperatureC, massPct, residueAtC),
    dtgPeakC: rising ? (temperatureC[peak] as number) : null,
    dtgPeak: rising ? (slope[peak] as number) : null,
    totalLossPct: (massPct[0] as number) - (massPct[massPct.length - 1] as number),
  };
}
