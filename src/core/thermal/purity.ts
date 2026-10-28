import { linearFit } from '../math/linearFit';
import { GAS_CONSTANT } from './kinetics';
import { KELVIN_OFFSET } from './import';

export interface PurityInput {
  /** Temperature in °C, increasing (one heating ramp). */
  temperatureC: Float64Array;
  /** Heat flow into the sample (endothermic positive), W/g. */
  endo: Float64Array;
  /** Limits of the melting peak, °C; the baseline is the straight line between the curve values there. */
  fromC: number;
  toC: number;
  /** Heating rate, K/min. */
  rateKPerMin: number;
  /** Molar mass of the main component, g/mol. */
  molarMass: number;
  /** Range of fraction melted used in the fit (for example 0.1 to 0.5). */
  fMin: number;
  fMax: number;
}

export interface PurityResult {
  /** Melting point of the pure substance from the intercept, °C. */
  t0C: number;
  /** Mole fraction of impurity, and the purity 100·(1 − x₂) in mol %. */
  x2: number;
  x2Sigma: number;
  purityMolPct: number;
  /** Heat of fusion from the whole peak, J/g and kJ/mol. */
  fusionJPerG: number;
  fusionKJPerMol: number;
  rSquared: number;
  /** Temperatures of the first and last point inside the peak limits, °C. */
  fromC: number;
  toC: number;
  /** The fitted points: 1/F and the sample temperature in °C. */
  points: { inverseF: number; temperatureC: number }[];
  /** Fitted line Ts(°C) = intercept + slope · (1/F). */
  intercept: number;
  slope: number;
  notes: string[];
}

export type PurityOutcome = { ok: true; result: PurityResult } | { ok: false; error: string };

/**
 * Purity from the shape of a melting peak with the van 't Hoff equation (as in ASTM E928):
 *
 *   T_s = T₀ − (R T₀² x₂ / ΔH_f) · (1/F)
 *
 * T_s is the sample temperature (K), T₀ the melting point of the pure substance (K), x₂ the mole
 * fraction of impurity, ΔH_f the molar heat of fusion (J/mol), R = 8.314462618 J/(mol·K) and F the
 * fraction melted at T_s, taken as the partial area of the peak up to T_s over the whole area. The
 * area above a straight baseline is integrated over time (dt = dT/β), giving J/g; ΔH_f = that × M.
 * T_s is fitted against 1/F (least squares) over F from fMin to fMax: the intercept is T₀ and
 * x₂ = −slope · ΔH_f / (R T₀²).
 *
 * The equation assumes an impurity that dissolves in the melt but not in the solid (a eutectic
 * system) and a nearly pure sample. Neither the curvature ("linearisation") correction nor a
 * correction for thermal lag is applied, so the result is an estimate.
 */
export function vantHoffPurity(input: PurityInput): PurityOutcome {
  const { temperatureC: T, endo, rateKPerMin, molarMass } = input;
  const lo = Math.min(input.fromC, input.toC);
  const hi = Math.max(input.fromC, input.toC);
  const idx: number[] = [];
  for (let i = 0; i < T.length; i++) {
    const t = T[i] as number;
    if (t >= lo && t <= hi) idx.push(i);
  }
  if (idx.length < 10) {
    return { ok: false, error: 'The peak limits hold fewer than 10 points. Widen them.' };
  }
  if (!(rateKPerMin > 0) || !(molarMass > 0) || !(input.fMax > input.fMin) || input.fMin <= 0) {
    return {
      ok: false,
      error: 'Give the heating rate, the molar mass and a fraction range above zero.',
    };
  }
  const i0 = idx[0] as number;
  const i1 = idx[idx.length - 1] as number;
  const t0 = T[i0] as number;
  const t1 = T[i1] as number;
  const e0 = endo[i0] as number;
  const e1 = endo[i1] as number;
  const above = (i: number) =>
    (endo[i] as number) - (e0 + ((e1 - e0) * ((T[i] as number) - t0)) / (t1 - t0));
  // Cumulative area in W/g·K, by the trapezoid rule; divide by β (K/s) to get J/g.
  const cumulative = [0];
  for (let k = 1; k < idx.length; k++) {
    const a = idx[k - 1] as number;
    const b = idx[k] as number;
    const step = ((above(a) + above(b)) / 2) * ((T[b] as number) - (T[a] as number));
    cumulative.push((cumulative[k - 1] as number) + step);
  }
  const total = cumulative[cumulative.length - 1] as number;
  if (!(total > 0)) {
    return {
      ok: false,
      error:
        'No endothermic peak above the baseline between the limits. Check the limits and the sign convention.',
    };
  }
  const beta = rateKPerMin / 60;
  const fusionJPerG = total / beta;
  const fusionJPerMol = fusionJPerG * molarMass;
  const points: PurityResult['points'] = [];
  for (let k = 1; k < idx.length; k++) {
    const f = (cumulative[k] as number) / total;
    if (f >= input.fMin && f <= input.fMax) {
      points.push({ inverseF: 1 / f, temperatureC: T[idx[k] as number] as number });
    }
  }
  if (points.length < 3) {
    return {
      ok: false,
      error:
        'Fewer than 3 points have a fraction melted in the chosen range. Widen the range or use a file with more points across the peak.',
    };
  }
  const fit = linearFit(
    points.map((p) => p.inverseF),
    points.map((p) => p.temperatureC),
  );
  if (!fit) return { ok: false, error: 'The straight line could not be fitted.' };
  const t0K = fit.intercept + KELVIN_OFFSET;
  const scale = fusionJPerMol / (GAS_CONSTANT * t0K * t0K);
  const x2 = -fit.slope * scale;
  const notes: string[] = [
    'Estimate: no linearisation (curvature) correction and no thermal-lag correction were applied.',
  ];
  if (fit.slope > 0) {
    notes.push(
      'The temperature falls as more of the sample melts, which the van ’t Hoff equation does not allow. Check the peak limits and the sign convention.',
    );
  }
  if (x2 > 0.025) {
    notes.push(
      `The impurity of ${(100 * x2).toFixed(1)} mol % is high for this method, which is only meant for nearly pure substances (see ASTM E928 for its limits). Treat the value as a rough indication.`,
    );
  }
  if (fit.rSquared < 0.98) {
    notes.push(
      `The points are not on a straight line (R² = ${fit.rSquared.toFixed(3)}). A curved plot is common; a narrower fraction range, or a slower heating rate, often helps.`,
    );
  }
  return {
    ok: true,
    result: {
      t0C: fit.intercept,
      x2,
      x2Sigma: Math.abs(fit.slopeSigma * scale),
      purityMolPct: 100 * (1 - x2),
      fusionJPerG,
      fusionKJPerMol: fusionJPerMol / 1000,
      rSquared: fit.rSquared,
      fromC: t0,
      toC: t1,
      points,
      intercept: fit.intercept,
      slope: fit.slope,
      notes,
    },
  };
}
