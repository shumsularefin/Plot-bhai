import { linearFit } from '../math/linearFit';
import type { DataMessage } from '../xrd/types';
import { KELVIN_OFFSET } from './import';
import { temperatureAtMass } from './steps';

/*
 * Apparent activation energies from runs of the same sample at several heating rates β.
 * Temperatures arrive in °C and are converted to kelvin (T = T°C + 273.15) before any formula.
 * β is in K/min; only the offset of ln β changes with the unit, not the slope, so Ea does not depend
 * on it. Energies are returned in kJ/mol.
 */

/**
 * Molar gas constant R, J/(mol K): 8.314 462 618… (CODATA 2022, exact by the 2019 SI definition),
 * https://physics.nist.gov/cgi-bin/cuu/Value?r (read on 2026-10-25). Flagged for your verification.
 */
export const GAS_CONSTANT = 8.314462618;

/**
 * Coefficient of the Doyle approximation used by Flynn–Wall–Ozawa: ln β = const − 1.052 Ea / (R T)
 * at fixed conversion. C. D. Doyle, J. Appl. Polym. Sci. 6 (1962) 639–642, eq. (12): for
 * x = E / (R T) > 20, log₁₀ p(x) ≈ −2.315 − 0.4567 x; in natural logarithms the slope is
 * 0.4567 · ln 10 = 1.0516, rounded to 1.052. Checked against the paper.
 */
export const DOYLE_COEFFICIENT = 1.052;

export type PeakDirection = 'max' | 'min';

/**
 * Peak temperature of a signal inside [fromC, toC]. A straight line joins the signal at the two ends
 * of the window; the peak is where the signal is furthest above it ('max') or below it ('min'),
 * refined by a parabola through the highest point and its two neighbours. `atEdge` is true when the
 * highest point is the first or last of the window, which means the window cuts the peak.
 */
export function peakTemperature(
  temperatureC: Float64Array,
  signal: Float64Array,
  fromC: number,
  toC: number,
  direction: PeakDirection,
): { tpC: number; atEdge: boolean } | null {
  const idx: number[] = [];
  for (let i = 0; i < temperatureC.length; i++) {
    const t = temperatureC[i] as number;
    if (t >= fromC && t <= toC) idx.push(i);
  }
  if (idx.length < 5) return null;
  const first = idx[0] as number;
  const last = idx[idx.length - 1] as number;
  const t0 = temperatureC[first] as number;
  const t1 = temperatureC[last] as number;
  const s0 = signal[first] as number;
  const s1 = signal[last] as number;
  const sign = direction === 'max' ? 1 : -1;
  const height = (i: number) => {
    const line = s0 + ((s1 - s0) * ((temperatureC[i] as number) - t0)) / (t1 - t0);
    return sign * ((signal[i] as number) - line);
  };
  let best = 0;
  for (let k = 1; k < idx.length; k++) {
    if (height(idx[k] as number) > height(idx[best] as number)) best = k;
  }
  if (!(height(idx[best] as number) > 0)) return null;
  const atEdge = best === 0 || best === idx.length - 1;
  if (atEdge) return { tpC: temperatureC[idx[best] as number] as number, atEdge };
  const [a, b, c] = [idx[best - 1], idx[best], idx[best + 1]] as [number, number, number];
  const [ta, tb, tc] = [temperatureC[a], temperatureC[b], temperatureC[c]] as [
    number,
    number,
    number,
  ];
  const [ha, hb, hc] = [height(a), height(b), height(c)];
  // Vertex of the parabola through three points (Lagrange form).
  const den = (ta - tb) * (ta - tc) * (tb - tc);
  const A = (tc * (hb - ha) + tb * (ha - hc) + ta * (hc - hb)) / den;
  const B = (tc * tc * (ha - hb) + tb * tb * (hc - ha) + ta * ta * (hb - hc)) / den;
  const vertex = A < 0 ? -B / (2 * A) : tb;
  return { tpC: vertex > ta && vertex < tc ? vertex : tb, atEdge };
}

/** One run's heating rate and the peak temperature found for the chosen event. */
export interface PeakPoint {
  /** Heating rate β, K/min. */
  betaKPerMin: number;
  /** Peak temperature, °C. */
  tpC: number;
}

export interface KineticPoint {
  /** 1/T in K⁻¹. */
  x: number;
  y: number;
}

export interface KissingerResult {
  /** Apparent activation energy, kJ/mol, with its standard uncertainty from the straight-line fit. */
  eaKJ: number;
  eaSigmaKJ: number;
  rSquared: number;
  /** Plotted points: x = 1/Tp (K⁻¹), y = ln(β / Tp²) with β in K/min and Tp in K. */
  points: KineticPoint[];
  line: { slope: number; intercept: number };
}

/**
 * Kissinger method. At the peak of the event the rate is highest, which gives
 *   ln(β / Tp²) = const − Ea / (R Tp),
 * so a straight line through (1/Tp, ln(β/Tp²)) has slope −Ea/R. Tp is in kelvin, β in K/min,
 * R = GAS_CONSTANT. Ea = −slope · R / 1000 in kJ/mol. Null with fewer than three runs.
 */
export function kissinger(peaks: readonly PeakPoint[]): KissingerResult | null {
  if (peaks.length < 3) return null;
  const points = peaks.map((p) => {
    const tp = p.tpC + KELVIN_OFFSET;
    return { x: 1 / tp, y: Math.log(p.betaKPerMin / (tp * tp)) };
  });
  const fit = linearFit(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  if (!fit || !(fit.slope < 0)) return null;
  return {
    eaKJ: (-fit.slope * GAS_CONSTANT) / 1000,
    eaSigmaKJ: (fit.slopeSigma * GAS_CONSTANT) / 1000,
    rSquared: fit.rSquared,
    points,
    line: { slope: fit.slope, intercept: fit.intercept },
  };
}

/** A TGA run's mass curve (°C, strictly increasing, % of the reference mass) and heating rate. */
export interface MassRun {
  betaKPerMin: number;
  temperatureC: Float64Array;
  massPct: Float64Array;
}

/**
 * Temperatures (°C) at which the conversion α = (m0 − m) / (m0 − mf) reaches each of `alphas`, for
 * the window [fromC, toC]. m0 and mf are the masses at the two ends of the window. The mass is first
 * made non-increasing (running minimum) so noise cannot make α fall back. A level is null if it is
 * never reached. Returns null when the window loses no mass.
 */
export function temperaturesAtConversion(
  run: MassRun,
  fromC: number,
  toC: number,
  alphas: readonly number[],
): (number | null)[] | null {
  const idx: number[] = [];
  for (let i = 0; i < run.temperatureC.length; i++) {
    const t = run.temperatureC[i] as number;
    if (t >= fromC && t <= toC) idx.push(i);
  }
  if (idx.length < 5) return null;
  const T = Float64Array.from(idx, (i) => run.temperatureC[i] as number);
  const m = Float64Array.from(idx, (i) => run.massPct[i] as number);
  for (let i = 1; i < m.length; i++) m[i] = Math.min(m[i] as number, m[i - 1] as number);
  const m0 = m[0] as number;
  const mf = m[m.length - 1] as number;
  if (!(m0 - mf > 0)) return null;
  return alphas.map((a) => temperatureAtMass(T, m, m0 - a * (m0 - mf)));
}

export type IsoMethod = 'fwo' | 'kas';

export interface IsoPoint {
  alpha: number;
  eaKJ: number;
  eaSigmaKJ: number;
  rSquared: number;
  /** The plotted points, one per run: x = 1/T (K⁻¹) at this conversion. */
  points: KineticPoint[];
}

/**
 * Isoconversional methods: at each fixed conversion α, take the temperature T each run reaches it.
 *   Flynn–Wall–Ozawa (Doyle approximation): ln β = const − 1.052 Ea / (R T)
 *     straight line of ln β against 1/T, Ea = −slope · R / 1.052.
 *   Kissinger–Akahira–Sunose:               ln(β / T²) = const − Ea / (R T)
 *     straight line of ln(β/T²) against 1/T, Ea = −slope · R.
 * T in kelvin, β in K/min, Ea in kJ/mol. Levels reached by fewer than three runs are left out.
 */
export function isoconversional(
  runs: readonly MassRun[],
  fromC: number,
  toC: number,
  alphas: readonly number[],
  method: IsoMethod,
): IsoPoint[] {
  const perRun = runs.map((r) => temperaturesAtConversion(r, fromC, toC, alphas));
  const out: IsoPoint[] = [];
  alphas.forEach((alpha, k) => {
    const points: KineticPoint[] = [];
    perRun.forEach((temps, r) => {
      const t = temps?.[k];
      if (t === null || t === undefined) return;
      const tK = t + KELVIN_OFFSET;
      const beta = (runs[r] as MassRun).betaKPerMin;
      points.push({ x: 1 / tK, y: method === 'fwo' ? Math.log(beta) : Math.log(beta / (tK * tK)) });
    });
    if (points.length < 3) return;
    const fit = linearFit(
      points.map((p) => p.x),
      points.map((p) => p.y),
    );
    if (!fit || !(fit.slope < 0)) return;
    const factor = method === 'fwo' ? DOYLE_COEFFICIENT : 1;
    out.push({
      alpha,
      eaKJ: (-fit.slope * GAS_CONSTANT) / factor / 1000,
      eaSigmaKJ: (fit.slopeSigma * GAS_CONSTANT) / factor / 1000,
      rSquared: fit.rSquared,
      points,
    });
  });
  return out;
}

/** Fewer than this many heating rates is not enough for a trustworthy slope. */
export const RECOMMENDED_RATES = 5;
/** Spread of Ea over α, as a fraction of the mean, above which one number is misleading. */
export const EA_VARIATION_LIMIT = 0.2;

/** Plain-language warnings about the heating rates used (shown on the step that sets them). */
export function rateWarnings(rates: readonly number[]): DataMessage[] {
  const notes: DataMessage[] = [];
  const distinct = new Set(rates.map((r) => r.toPrecision(6))).size;
  if (rates.length < 3 || distinct < rates.length) {
    notes.push({
      level: 'warning',
      text: 'Three or more runs with different heating rates are needed. Runs with the same rate add no information about the slope.',
    });
    return notes;
  }
  if (rates.length < RECOMMENDED_RATES) {
    notes.push({
      level: 'info',
      text: `You have ${rates.length} heating rates. Five or more give a more trustworthy slope and uncertainty.`,
    });
  }
  const ratio = Math.max(...rates) / Math.min(...rates);
  if (ratio < 4) {
    notes.push({
      level: 'warning',
      text: `The fastest rate is only ${ratio.toFixed(1)} times the slowest. A wider range (for example 2 to 20 K/min) makes the activation energy much less sensitive to noise.`,
    });
  }
  return notes;
}

/** Warnings about the result of Kissinger, FWO or KAS. */
export function resultWarnings(
  eaValues: readonly number[],
  rSquared: readonly number[],
): DataMessage[] {
  const notes: DataMessage[] = [
    {
      level: 'info',
      text: 'This is an apparent activation energy for the whole process. It describes how the rate changes with heating rate and is not the barrier of one proven reaction step.',
    },
  ];
  if (rSquared.some((r) => r < 0.95)) {
    notes.push({
      level: 'warning',
      text: 'Some straight-line fits have R² below 0.95, so the points do not follow a line well. Check the heating rates and the temperature window.',
    });
  }
  if (eaValues.length >= 2) {
    const mean = eaValues.reduce((s, v) => s + v, 0) / eaValues.length;
    const spread = Math.max(...eaValues) - Math.min(...eaValues);
    if (mean > 0 && spread / mean > EA_VARIATION_LIMIT) {
      notes.push({
        level: 'warning',
        text: 'The activation energy changes a lot with conversion. That usually means several steps overlap or the mechanism changes, so a single number would be misleading.',
      });
    }
  }
  return notes;
}
