/*
 * Synthetic diffraction patterns for the example data and for tests. These are generated, not
 * measured, and do not represent any real material: the peak positions are arbitrary.
 */

/**
 * Pseudo-Voigt peak shape with height 1 at the centre:
 *
 *   pV(x) = η · L(x) + (1 − η) · G(x)
 *   L(x)  = 1 / (1 + 4 (x − x0)² / H²)              (Lorentzian)
 *   G(x)  = exp(−4 ln 2 · (x − x0)² / H²)           (Gaussian)
 *
 * x, x0 (centre) and H (full width at half maximum) share one unit, here degrees 2θ.
 * η (0 to 1) is the Lorentzian fraction. Both parts equal 1/2 at x = x0 ± H/2, so H is the
 * FWHM of the sum for any η.
 */
export function pseudoVoigt(x: number, x0: number, fwhm: number, eta: number): number {
  const u = (4 * (x - x0) ** 2) / (fwhm * fwhm);
  return eta / (1 + u) + (1 - eta) * Math.exp(-Math.LN2 * u);
}

export interface SyntheticPeak {
  /** Centre, degrees 2θ. */
  center: number;
  /** Full width at half maximum, degrees 2θ. */
  fwhm: number;
  /** Peak height above background, counts. */
  height: number;
  /** Lorentzian fraction η, 0 to 1. */
  eta: number;
}

export interface SyntheticOptions {
  /** First and last 2θ (degrees) and step (degrees). */
  start: number;
  end: number;
  step: number;
  peaks: readonly SyntheticPeak[];
  /** Background, counts: constant + amplitude · exp(−2θ / decay), with decay in degrees. */
  background: { constant: number; amplitude: number; decay: number };
  /** Adds counting noise (normal approximation to Poisson, σ = √counts) when given. */
  noiseSeed?: number;
}

/** Small seeded pseudo-random generator (mulberry32) so examples and tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a pattern in counts: background plus peaks, optionally with noise, rounded to whole counts. */
export function generatePattern(options: SyntheticOptions): {
  twoTheta: Float64Array;
  intensity: Float64Array;
} {
  const { start, end, step, peaks, background, noiseSeed } = options;
  const n = Math.floor((end - start) / step + 1e-9) + 1;
  const twoTheta = new Float64Array(n);
  const intensity = new Float64Array(n);
  const random = noiseSeed === undefined ? undefined : seededRandom(noiseSeed);
  for (let i = 0; i < n; i++) {
    // Rounded to 6 decimals so the axis reads cleanly, as instrument exports do.
    const x = Math.round((start + i * step) * 1e6) / 1e6;
    let y = background.constant + background.amplitude * Math.exp(-x / background.decay);
    for (const p of peaks) y += p.height * pseudoVoigt(x, p.center, p.fwhm, p.eta);
    if (random) {
      // Box-Muller transform: a standard normal value from two uniform values.
      const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      y += Math.sqrt(y) * normal;
    }
    twoTheta[i] = x;
    intensity[i] = Math.max(0, Math.round(y));
  }
  return { twoTheta, intensity };
}

const EXAMPLE_POSITIONS = [21.4, 30.2, 35.6, 43.3, 53.7, 57.2, 62.8, 74.3];
const EXAMPLE_HEIGHTS = [900, 3200, 8000, 1800, 1100, 2600, 3900, 900];

/**
 * The "Try with example data" patterns: two synthetic scans with the same arbitrary peak
 * positions, one with narrow and one with broad peaks. Not a real material.
 */
export function examplePatterns(): {
  name: string;
  twoTheta: Float64Array;
  intensity: Float64Array;
}[] {
  const make = (fwhm: number, seed: number) =>
    generatePattern({
      start: 10,
      end: 80,
      step: 0.02,
      peaks: EXAMPLE_POSITIONS.map((center, i) => ({
        center,
        fwhm: fwhm * (1 + center / 100),
        height: EXAMPLE_HEIGHTS[i] as number,
        eta: 0.5,
      })),
      background: { constant: 150, amplitude: 900, decay: 12 },
      noiseSeed: seed,
    });
  return [
    { name: 'Synthetic example A (narrow peaks)', ...make(0.12, 1) },
    { name: 'Synthetic example B (broad peaks)', ...make(0.45, 2) },
  ];
}
