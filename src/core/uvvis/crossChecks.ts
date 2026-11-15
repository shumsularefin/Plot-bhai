import { levenbergMarquardt } from '../math/levenbergMarquardt';
import { fitBandGap, suggestRegion, type BandGapFit, type RegionRule } from './tauc';

/*
 * Two cross-checks of the Tauc band gap, both from A. R. Zanatta, "Revisiting the optical bandgap
 * of semiconductors and the proposal of a unified methodology to its determination", Sci. Rep. 9
 * (2019) 11225, doi:10.1038/s41598-019-47670-y, CC BY 4.0 (read on PMC, PMC6677798, 2026-11-14).
 * Energies E are photon energies in eV; S is the absorption quantity (α in cm⁻¹, or A or F(R),
 * which are proportional to it). Both are estimates shown next to the Tauc value, never in its place.
 */

/**
 * Cody plot: "the extrapolation of the linear least squares fit of (α/E)^1/2 to zero", which
 * assumes a constant dipole transition matrix element (Zanatta 2019, citing G. D. Cody et al.,
 * ref. 62 there), against the Tauc form (α·E)^1/2. Both are used for amorphous semiconductors:
 * M. E. Sánchez-Vergara et al., Molecules 17 (2012) 10000, doi:10.3390/molecules170910000 (CC BY,
 * read 2026-11-14) state that Cody "suggests, instead, that the dipole matrix element is actually
 * independent of the photon energy" and that Cody plots curve less than Tauc plots. Kasikov and
 * Aarik (Bulg. J. Phys. 51 (2024) 311) note that the strict variable is αn/E, with the refractive
 * index n; as in most papers, n is taken as constant here and left out.
 * Returns (S/E)^(1/2), in (unit of S / eV)^(1/2); NaN where S < 0.
 */
export function codyValues(energyEv: Float64Array, signal: Float64Array): Float64Array {
  return signal.map((s, i) => {
    const q = s / (energyEv[i] as number);
    return q >= 0 ? Math.sqrt(q) : NaN;
  });
}

export interface CodyGap {
  /** Straight-line fit of (S/E)^(1/2) and the energy where it meets zero. */
  fit: BandGapFit | null;
  region: [number, number] | null;
  suggested: boolean;
  /** The Cody curve, for the plot. */
  cody: Float64Array;
}

/**
 * Cody gap: (S/E)^(1/2) = B·(E − Eg) is fitted by least squares over the region (the user's, or
 * the suggestion of `suggestRegion` with the given rule) and Eg read where the line meets zero, with the
 * uncertainty of `fitBandGap`. No sub-gap correction is applied: like the Tauc axis intercept, it
 * assumes the curve falls to zero below the edge.
 */
export function codyGap(
  energyEv: Float64Array,
  signal: Float64Array,
  region: [number, number] | null,
  rule: RegionRule = 'steepest',
): CodyGap {
  const cody = codyValues(energyEv, signal);
  const used = region ?? suggestRegion(energyEv, cody, rule);
  return {
    fit: used ? fitBandGap(energyEv, cody, used[0], used[1]) : null,
    region: used,
    suggested: region === null,
    cody,
  };
}

/** The transition types of Zanatta's Eq. 9, with the constant n_type of each. */
export type SigmoidType = 'direct' | 'indirect' | 'amorphous';

/**
 * n_type of Eq. 9: "n_dir^Boltz = 0.3", "n_ind^Boltz = 4.3" (crystalline semiconductors) and
 * "n_amorp^Boltz = 3.6" (amorphous films), found by Zanatta from Ge, Si and GaAs wafers, powders and
 * sputtered films. Empirical constants of that paper, flagged for your verification.
 */
export const SIGMOID_N: Record<SigmoidType, number> = {
  direct: 0.3,
  indirect: 4.3,
  amorphous: 3.6,
};

export const SIGMOID_LABELS: Record<SigmoidType, string> = {
  direct: 'Direct (crystalline)',
  indirect: 'Indirect (crystalline)',
  amorphous: 'Amorphous',
};

/** Width of the default fit range, eV: Zanatta fitted "a ~500 meV energy range". */
export const SIGMOID_RANGE_EV = 0.5;

export interface SigmoidFit {
  /** S_min, S_max (unit of S), E0 (eV) and δE (eV) of Eq. 8, with standard errors. */
  sMin: number;
  sMax: number;
  e0Ev: number;
  e0Sigma: number;
  deltaEv: number;
  deltaSigma: number;
  /** Eg = E0 − n_type · δE (Eq. 9) and its standard uncertainty, eV. */
  egEv: number;
  egSigma: number;
  type: SigmoidType;
  rSquared: number;
  n: number;
  fromEv: number;
  toEv: number;
  /** True when the fit range is the default one. */
  suggested: boolean;
  /** Model values on the fitted points, for the plot. */
  energyEv: Float64Array;
  model: Float64Array;
}

/**
 * Sigmoid (Boltzmann) function of Zanatta's Eq. 8,
 *   S(E) = S_max + (S_min − S_max) / (1 + exp((E − E0)/δE)),
 * S_min and S_max the lowest and highest absorption, E0 the energy halfway between them and δE
 * (eV) the width of the rise.
 */
export function sigmoid(e: number, sMin: number, sMax: number, e0: number, delta: number): number {
  return sMax + (sMin - sMax) / (1 + Math.exp((e - e0) / delta));
}

/**
 * The default fit range, my reading of "a ~500 meV energy range centered in between the min-max
 * α values": around the energy where S first rises above halfway between its lowest and highest
 * value within 0.5 eV of the Tauc gap, ±0.25 eV. Null when S does not rise there.
 */
export function suggestSigmoidRange(
  energyEv: Float64Array,
  signal: Float64Array,
  taucEgEv: number,
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    const s = signal[i] as number;
    if (Math.abs(e - taucEgEv) > SIGMOID_RANGE_EV || !Number.isFinite(s)) continue;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  if (!(hi > lo)) return null;
  const half = (lo + hi) / 2;
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    if (e < taucEgEv - SIGMOID_RANGE_EV || !((signal[i] as number) >= half)) continue;
    return [e - SIGMOID_RANGE_EV / 2, e + SIGMOID_RANGE_EV / 2];
  }
  return null;
}

/**
 * Least-squares fit of Eq. 8 over [fromEv, toEv] (Levenberg–Marquardt, unweighted) and the gap of
 * Eq. 9, Eg = E0 − n·δE, with σ²(Eg) = σ²(E0) + n²σ²(δE) − 2n·cov(E0, δE) from the fit covariance.
 * Scaling S by a constant changes only S_min and S_max, so A or F(R) give the same Eg as α. Null
 * with fewer than 8 points, a fit that does not rise (δE ≤ 0 or S_max ≤ S_min) or E0 outside the range.
 */
export function sigmoidGap(
  energyEv: Float64Array,
  signal: Float64Array,
  range: [number, number],
  type: SigmoidType,
  suggested: boolean,
): SigmoidFit | null {
  const [from, to] = range[0] <= range[1] ? range : [range[1], range[0]];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < energyEv.length; i++) {
    const e = energyEv[i] as number;
    const s = signal[i] as number;
    if (e >= from && e <= to && Number.isFinite(s)) {
      xs.push(e);
      ys.push(s);
    }
  }
  const n = xs.length;
  if (n < 8) return null;
  const first = ys.slice(0, Math.max(1, Math.floor(n / 10)));
  const last = ys.slice(-Math.max(1, Math.floor(n / 10)));
  const s0 = Math.min(...first);
  const s1 = Math.max(...last);
  if (!(s1 > s0)) return null;
  const half = (s0 + s1) / 2;
  const e0Start = xs[ys.findIndex((v) => v >= half)] ?? (from + to) / 2;
  const span = to - from;
  const scale = Math.max(Math.abs(s0), Math.abs(s1));
  const x = Float64Array.from(xs);
  const result = levenbergMarquardt({
    y: Float64Array.from(ys),
    initial: Float64Array.from([s0, s1, e0Start, span / 10]),
    lower: Float64Array.from([-10 * scale, -10 * scale, from - span, span / 1e4]),
    upper: Float64Array.from([10 * scale, 10 * scale, to + span, 10 * span]),
    free: [true, true, true, true],
    maxIterations: 500,
    evaluate(p, model, jacobian) {
      const [sMin, sMax, e0, d] = p as unknown as [number, number, number, number];
      for (let i = 0; i < n; i++) {
        const u = Math.exp(((x[i] as number) - e0) / d);
        const g = 1 / (1 + u);
        model[i] = sMax + (sMin - sMax) * g;
        if (jacobian) {
          // ∂g/∂e0 = g²·u/d, ∂g/∂d = g²·u·(E − e0)/d².
          const dg = g * g * u;
          jacobian[i * 4] = g;
          jacobian[i * 4 + 1] = 1 - g;
          jacobian[i * 4 + 2] = ((sMin - sMax) * dg) / d;
          jacobian[i * 4 + 3] = ((sMin - sMax) * dg * ((x[i] as number) - e0)) / (d * d);
        }
      }
    },
  });
  const [sMin, sMax, e0, delta] = result.parameters as unknown as [number, number, number, number];
  if (!(sMax > sMin) || !(delta > 0) || e0 < from || e0 > to) return null;
  const k = SIGMOID_N[type];
  const c = result.covariance;
  const varEg = (c[10] as number) + k * k * (c[15] as number) - 2 * k * (c[11] as number);
  const mean = ys.reduce((s, v) => s + v, 0) / n;
  const sst = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
  return {
    sMin,
    sMax,
    e0Ev: e0,
    e0Sigma: result.standardErrors[2] as number,
    deltaEv: delta,
    deltaSigma: result.standardErrors[3] as number,
    egEv: e0 - k * delta,
    egSigma: result.covarianceOk ? Math.sqrt(Math.max(varEg, 0)) : NaN,
    type,
    rSquared: sst > 0 ? 1 - result.ssr / sst : NaN,
    n,
    fromEv: xs[0] as number,
    toEv: xs[n - 1] as number,
    suggested,
    energyEv: x,
    model: result.model,
  };
}
