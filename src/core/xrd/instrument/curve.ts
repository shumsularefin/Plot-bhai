import { invert } from '../../math/linear';
import type { DataMessage } from '../types';

const DEG = Math.PI / 180;

/**
 * The instrument's peak width (FWHM, degrees 2θ) as a function of 2θ (degrees).
 *
 * - constant: FWHM = b at every angle.
 * - caglioti: FWHM² = U tan²θ + V tanθ + W, with θ = 2θ / 2 and U, V, W in degrees² (2θ).
 *   Caglioti, Paoletti & Ricci, Nucl. Instrum. 3 (1958) 223–228.
 *   TODO(verify): citation written from memory; the paper could not be reached.
 * - polynomial: FWHM = Σ a_k (2θ − pivot)^k, k = 0…degree, a_k in degrees^(1−k).
 *
 * `covariance` (row-major, from a fit to a standard) gives the uncertainty of the curve;
 * null means the values were typed in and are taken as exact.
 */
export type InstrumentCurve =
  | { kind: 'constant'; fwhm: number }
  | { kind: 'caglioti'; u: number; v: number; w: number; covariance: number[] | null }
  | { kind: 'polynomial'; coefficients: number[]; pivot: number; covariance: number[] | null };

export type CurveKind = 'caglioti' | 'linear' | 'quadratic';

/**
 * Converts GSAS-II style U, V, W (Gaussian variance σ² = U tan²θ + V tanθ + W, in
 * centidegrees²) to Caglioti FWHM² parameters in degrees²: FWHM = √(8 ln 2) σ, and
 * 1 centidegree = 0.01°, so each parameter is multiplied by 8 ln 2 / 10⁴.
 * (From GSAS-II GSASIIpwd.py, getFWHM: FWHM = 2.35482 σ / 100.)
 */
export function gsasToCaglioti(
  u: number,
  v: number,
  w: number,
): { u: number; v: number; w: number } {
  const k = (8 * Math.LN2) / 1e4;
  return { u: u * k, v: v * k, w: w * k };
}

/** Basis functions of the fitted quantity (FWHM² for Caglioti, FWHM otherwise) at 2θ. */
function basis(curve: Exclude<InstrumentCurve, { kind: 'constant' }>, twoTheta: number): number[] {
  if (curve.kind === 'caglioti') {
    const t = Math.tan((twoTheta / 2) * DEG);
    return [t * t, t, 1];
  }
  const dx = twoTheta - curve.pivot;
  return curve.coefficients.map((_, k) => dx ** k);
}

function quadraticForm(g: readonly number[], covariance: readonly number[]): number {
  let v = 0;
  for (let a = 0; a < g.length; a++) {
    for (let b = 0; b < g.length; b++)
      v += (g[a] as number) * (g[b] as number) * (covariance[a * g.length + b] as number);
  }
  return Math.max(0, v);
}

/**
 * Instrument FWHM at 2θ (degrees) with its standard uncertainty from the curve covariance
 * (0 for typed values). fwhm is NaN where a Caglioti curve gives FWHM² ≤ 0 or a polynomial
 * gives FWHM ≤ 0: there the curve has no physical meaning.
 */
export function instrumentWidth(
  curve: InstrumentCurve,
  twoTheta: number,
): { fwhm: number; sigma: number } {
  if (curve.kind === 'constant') return { fwhm: curve.fwhm > 0 ? curve.fwhm : NaN, sigma: 0 };
  const g = basis(curve, twoTheta);
  const coefficients = curve.kind === 'caglioti' ? [curve.u, curve.v, curve.w] : curve.coefficients;
  const value = g.reduce((s, gk, k) => s + gk * (coefficients[k] as number), 0);
  const spread = curve.covariance ? Math.sqrt(quadraticForm(g, curve.covariance)) : 0;
  if (curve.kind === 'caglioti') {
    if (!(value > 0)) return { fwhm: NaN, sigma: NaN };
    const fwhm = Math.sqrt(value);
    // σ(FWHM) = σ(FWHM²) / (2 FWHM)
    return { fwhm, sigma: spread / (2 * fwhm) };
  }
  return value > 0 ? { fwhm: value, sigma: spread } : { fwhm: NaN, sigma: NaN };
}

/** One instrument peak: position and FWHM in degrees 2θ. */
export interface WidthPoint {
  twoTheta: number;
  fwhm: number;
}

export interface CurveFit {
  curve: InstrumentCurve;
  /** Root-mean-square difference between the points and the curve, degrees 2θ. */
  rms: number;
  messages: DataMessage[];
}

const PARAMETER_COUNT: Record<CurveKind, number> = { caglioti: 3, linear: 2, quadratic: 3 };

/** Smallest number of points needed for each curve. */
export function pointsNeeded(kind: CurveKind): number {
  return PARAMETER_COUNT[kind];
}

/**
 * Fits a smooth instrument curve to (2θ, FWHM) points by ordinary (unweighted) linear least
 * squares. Caglioti is linear in U, V, W when fitted to FWHM²; the polynomials are fitted to
 * FWHM directly, about the mean 2θ for numerical stability.
 * Coefficient covariance C = s² (XᵀX)⁻¹ with s² = SSR / (n − m); with n = m points the curve
 * passes through them exactly and no uncertainty can be given (covariance null).
 * Returns null with fewer than m points or a singular design (for example repeated angles).
 */
export function fitInstrumentCurve(
  points: readonly WidthPoint[],
  kind: CurveKind,
): CurveFit | null {
  const m = PARAMETER_COUNT[kind];
  const n = points.length;
  if (n < m) return null;
  const pivot = points.reduce((s, p) => s + p.twoTheta, 0) / n;
  const template: Exclude<InstrumentCurve, { kind: 'constant' }> =
    kind === 'caglioti'
      ? { kind, u: 0, v: 0, w: 0, covariance: null }
      : { kind: 'polynomial', coefficients: new Array<number>(m).fill(0), pivot, covariance: null };
  const rows = points.map((p) => basis(template, p.twoTheta));
  const targets = points.map((p) => (kind === 'caglioti' ? p.fwhm ** 2 : p.fwhm));

  const xtx = Array.from({ length: m }, (_, a) =>
    Array.from({ length: m }, (_, b) =>
      rows.reduce((s, r) => s + (r[a] as number) * (r[b] as number), 0),
    ),
  );
  const xty = Array.from({ length: m }, (_, a) =>
    rows.reduce((s, r, i) => s + (r[a] as number) * (targets[i] as number), 0),
  );
  const inverse = invert(xtx);
  if (!inverse) return null;
  const beta = inverse.map((row) => row.reduce((s, v, b) => s + v * (xty[b] as number), 0));

  let ssr = 0;
  rows.forEach((r, i) => {
    const fitted = r.reduce((s, v, k) => s + v * (beta[k] as number), 0);
    ssr += ((targets[i] as number) - fitted) ** 2;
  });
  const covariance = n > m ? inverse.flatMap((row) => row.map((v) => (v * ssr) / (n - m))) : null;
  const curve: InstrumentCurve =
    kind === 'caglioti'
      ? {
          kind,
          u: beta[0] as number,
          v: beta[1] as number,
          w: beta[2] as number,
          covariance,
        }
      : { kind: 'polynomial', coefficients: beta, pivot, covariance };

  let sq = 0;
  let bad = false;
  for (const p of points) {
    const { fwhm } = instrumentWidth(curve, p.twoTheta);
    if (!Number.isFinite(fwhm)) bad = true;
    else sq += (p.fwhm - fwhm) ** 2;
  }
  const messages: DataMessage[] = [];
  if (bad) {
    messages.push({
      level: 'error',
      text: 'The curve gives a zero or negative width at some of the standard peaks. Try another curve type or exclude outlying points.',
    });
  }
  if (n === m) {
    messages.push({
      level: 'warning',
      text: `Only ${n} points for ${m} curve parameters: the curve passes through every point, so it cannot show how well it fits and no uncertainty is given. Use more standard peaks if you can.`,
    });
  }
  return { curve, rms: Math.sqrt(sq / n), messages };
}
