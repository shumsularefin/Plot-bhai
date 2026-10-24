/*
 * Texture coefficient (preferred orientation) of a powder pattern.
 */

/** Intensity of one reflection (or of several overlapping ones) in the sample and in the reference. */
export interface TextureInput {
  /** Observed intensity: a peak height or area, in any one unit (it cancels out). Zero if absent. */
  observed: number;
  /** Reference intensity I0 of the same reflection(s), in any one unit (for example percent). */
  reference: number;
}

export type TextureOutcome = { ok: true; tc: number[] } | { ok: false; reason: string };

/**
 * Harris texture coefficient of each of N reflections:
 *
 *   TC_i = (I_i / I0_i) / ( (1/N) · Σ_j I_j / I0_j )
 *
 * I_i is the observed intensity and I0_i the reference (random-powder) intensity of reflection i.
 * Both may be in any unit as long as it is the same for all reflections. TC is dimensionless;
 * TC = 1 for every reflection means the intensities follow the random powder, and the TC always
 * average to 1. A reflection that is absent counts as I = 0 (TC = 0) and still counts in N.
 *
 * Refuses (with a plain reason) when fewer than two reflections are given, a reference
 * intensity is not positive, an observed intensity is negative, or nothing was observed.
 */
export function textureCoefficients(rows: readonly TextureInput[]): TextureOutcome {
  if (rows.length < 2)
    return { ok: false, reason: 'At least two reflections are needed to compare intensities.' };
  if (rows.some((r) => !(r.reference > 0)))
    return { ok: false, reason: 'A reference intensity is zero, so its ratio cannot be formed.' };
  if (rows.some((r) => r.observed < 0 || !Number.isFinite(r.observed)))
    return { ok: false, reason: 'An observed intensity is negative or not a number.' };
  const ratios = rows.map((r) => r.observed / r.reference);
  const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  if (!(mean > 0)) return { ok: false, reason: 'No reflection has any observed intensity.' };
  return { ok: true, tc: ratios.map((v) => v / mean) };
}
