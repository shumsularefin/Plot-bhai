/*
 * Statistics and derived quantities of a Rietveld refinement (refine.ts).
 */

/**
 * Durbin–Watson statistic of the weighted residuals r_i = √w_i (y_obs,i − y_calc,i), in pattern
 * order (J. Durbin and G. S. Watson, Biometrika 37 (1950) 409–428; used for Rietveld refinement by
 * R. J. Hill and H. D. Flack, J. Appl. Cryst. 20 (1987) 356–361):
 *   d = Σ_{i=2..N} (r_i − r_{i−1})² / Σ_{i=1..N} r_i²
 * d ≈ 2 when neighbouring residuals are independent; d well below 2 means they are positively
 * correlated (the profile is systematically misfitted), and the least-squares standard
 * uncertainties are then too small.
 */
export function durbinWatson(residuals: ArrayLike<number>): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < residuals.length; i++) {
    const r = residuals[i] as number;
    den += r * r;
    if (i > 0) num += (r - (residuals[i - 1] as number)) ** 2;
  }
  return den > 0 ? num / den : NaN;
}

export interface Correlation {
  a: string;
  b: string;
  /** Correlation coefficient r_ab = C_ab / √(C_aa C_bb), −1 to 1. */
  r: number;
}

/**
 * Pairs of refined parameters whose correlation |r| reaches `threshold`, strongest first.
 * `covariance` is row-major m × m; `use[j]` says whether parameter j is reported; `skip(a, b)` can
 * leave out pairs that are expected to be correlated (for example two background terms).
 */
export function strongCorrelations(
  covariance: ArrayLike<number>,
  labels: readonly string[],
  use: readonly boolean[],
  threshold: number,
  skip: (a: number, b: number) => boolean = () => false,
): Correlation[] {
  const m = labels.length;
  const out: Correlation[] = [];
  for (let a = 0; a < m; a++) {
    const caa = covariance[a * m + a] as number;
    if (!use[a] || !(caa > 0)) continue;
    for (let b = a + 1; b < m; b++) {
      const cbb = covariance[b * m + b] as number;
      if (!use[b] || !(cbb > 0) || skip(a, b)) continue;
      const r = (covariance[a * m + b] as number) / Math.sqrt(caa * cbb);
      if (Math.abs(r) >= threshold)
        out.push({
          a: labels[a] as string,
          b: labels[b] as string,
          r: Math.max(-1, Math.min(1, r)),
        });
    }
  }
  return out.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
}

export interface StandardResult {
  /** Amorphous and unidentified fraction of the original sample (0 to 1). */
  amorphous: { value: number; esd: number };
  /** Weight fraction of each phase in the original sample (the standard's own entry is null). */
  phases: ({ value: number; esd: number } | null)[];
}

/**
 * Amorphous content by the internal-standard method. A crystalline standard s is weighed into the
 * sample at weight fraction W_s of the mixture. The refinement gives each phase's fraction of the
 * crystalline part, R_p = S_p a_p / Σ_i S_i a_i (Hill–Howard, a = ZMV). The crystalline part is
 * W_s / R_s of the mixture and the original sample is (1 − W_s) of it, so
 *   W_p (original sample) = R_p W_s / (R_s (1 − W_s)) = c S_p a_p / (S_s a_s),  c = W_s / (1 − W_s)
 *   A = 1 − Σ_{p≠s} W_p = (1 − W_s/R_s) / (1 − W_s)
 * A is the part of the sample not seen as the crystalline phases refined: amorphous material and
 * any phase left out. Standard uncertainties come from the covariance of the scale factors
 * (row-major k × k); the uncertainty of the weighing is not included. A negative A within its
 * uncertainty means no amorphous content was detected.
 */
export function internalStandard(
  scales: readonly number[],
  massVolume: readonly number[],
  covariance: readonly number[],
  standard: number,
  ws: number,
): StandardResult {
  const k = scales.length;
  const c = ws / (1 - ws);
  const ss = scales[standard] as number;
  const as = massVolume[standard] as number;
  const ref = ss * as;
  const variance = (grad: readonly number[]) => {
    let v = 0;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++)
        v += (grad[i] as number) * (covariance[i * k + j] as number) * (grad[j] as number);
    return Math.sqrt(Math.max(0, v));
  };
  let total = 0;
  const phases = scales.map((sp, p) => {
    if (p === standard) return null;
    const ap = massVolume[p] as number;
    const value = (c * sp * ap) / ref;
    total += sp * ap;
    const grad = scales.map((_, q) =>
      q === p ? (c * ap) / ref : q === standard ? (-c * sp * ap) / (ss * ref) : 0,
    );
    return { value, esd: variance(grad) };
  });
  const amorphousGrad = scales.map((_, q) =>
    q === standard ? (c * total) / (ss * ref) : (-c * (massVolume[q] as number)) / ref,
  );
  return {
    amorphous: { value: 1 - (c * total) / ref, esd: variance(amorphousGrad) },
    phases,
  };
}
