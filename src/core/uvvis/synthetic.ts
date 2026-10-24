import { seededRandom } from '../xrd/synthetic';
import { energyFromWavelength } from './conversions';

/*
 * Synthetic UV-Vis spectra for the example data and for tests. They are generated, not measured,
 * and do not represent any real material. The band gap is chosen here, so tests can check that
 * later analysis recovers it.
 */

/** Band gap used by the example spectra, eV. A made-up value, not a material property. */
export const EXAMPLE_BAND_GAP_EV = 3.2;

export interface SyntheticSpectrumOptions {
  /** First and last wavelength and step, nm. */
  startNm: number;
  endNm: number;
  stepNm: number;
  /** True band gap, eV. */
  bandGapEv: number;
  /** Seed for the random noise; omitted means no noise. */
  noiseSeed?: number;
  /** Standard deviation of the noise, in the units of the spectrum. */
  noiseSd?: number;
}

function wavelengthGrid({ startNm, endNm, stepNm }: SyntheticSpectrumOptions): Float64Array {
  const n = Math.floor((endNm - startNm) / stepNm + 1e-9) + 1;
  return Float64Array.from({ length: n }, (_, i) => startNm + i * stepNm);
}

/** Seeded normal noise with standard deviation sd (Box–Muller from a seeded uniform generator). */
export function seededNoise(seed: number, sd: number): () => number {
  const random = seededRandom(seed);
  return () => sd * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function noiseSource(options: SyntheticSpectrumOptions): () => number {
  if (options.noiseSeed === undefined || !options.noiseSd) return () => 0;
  return seededNoise(options.noiseSeed, options.noiseSd);
}

/**
 * Shape of the absorption edge for a transition with Tauc exponent n (1/2 direct allowed,
 * 2 indirect allowed, 3/2 direct forbidden, 3 indirect forbidden): c · (E − Eg)^n / E for
 * E > Eg, else 0. E = hc/λ in eV. Because (shape · E)^(1/n) = c^(1/n) · (E − Eg), the Tauc
 * quantity is exactly linear above the gap and its line meets zero at Eg. c is in eV^(n−1).
 */
export function edgeShape(energyEv: number, bandGapEv: number, n: number, c: number): number {
  return (c * Math.max(energyEv - bandGapEv, 0) ** n) / energyEv;
}

export type EdgeOptions = SyntheticSpectrumOptions & {
  /** Tauc exponent n; default 1/2 (direct allowed). */
  n?: number;
  /** Strength c of the edge; default 8 for n = 1/2 and 1.5 otherwise. */
  strength?: number;
};

const defaultStrength = (n: number) => (n === 0.5 ? 8 : 1.5);

/**
 * Absorbance with an absorption edge of the chosen transition type plus a constant baseline
 * (see edgeShape for the shape). Baseline is unitless.
 */
export function bandEdgeAbsorbance(options: EdgeOptions & { baseline?: number }): {
  wavelengthNm: Float64Array;
  values: Float64Array;
} {
  const { bandGapEv, n = 0.5, baseline = 0 } = options;
  const c = options.strength ?? defaultStrength(n);
  const wavelengthNm = wavelengthGrid(options);
  const noise = noiseSource(options);
  const values = wavelengthNm.map(
    (w) => edgeShape(energyFromWavelength(w), bandGapEv, n, c) + baseline + noise(),
  );
  return { wavelengthNm, values };
}

/** Direct allowed edge (n = 1/2) with a small default baseline, used by the example data. */
export function directGapAbsorbance(
  options: SyntheticSpectrumOptions & { slope?: number; baseline?: number },
): { wavelengthNm: Float64Array; values: Float64Array } {
  const { slope = 8, baseline = 0.02, ...rest } = options;
  return bandEdgeAbsorbance({ ...rest, n: 0.5, strength: slope, baseline });
}

/**
 * Percent diffuse reflectance whose Kubelka–Munk function is F(R) = floor + edgeShape(E).
 * Inverting F(R) = (1 − R)² / (2R) gives R = 1 + F − √(F² + 2F), as a fraction; the result is
 * multiplied by 100.
 */
export function bandEdgeReflectance(options: EdgeOptions & { floor?: number }): {
  wavelengthNm: Float64Array;
  values: Float64Array;
} {
  const { bandGapEv, n = 0.5, floor = 0.01 } = options;
  const c = options.strength ?? defaultStrength(n);
  const wavelengthNm = wavelengthGrid(options);
  const noise = noiseSource(options);
  const values = wavelengthNm.map((w) => {
    const f = floor + edgeShape(energyFromWavelength(w), bandGapEv, n, c);
    return 100 * (1 + f - Math.sqrt(f * f + 2 * f)) + noise();
  });
  return { wavelengthNm, values };
}

/** Direct allowed diffuse reflectance, used by the example data. */
export function directGapReflectance(
  options: SyntheticSpectrumOptions & { slope?: number; floor?: number },
): { wavelengthNm: Float64Array; values: Float64Array } {
  const { slope = 8, ...rest } = options;
  return bandEdgeReflectance({ ...rest, n: 0.5, strength: slope });
}

/** A smooth absorbance baseline such as a solvent blank: a + b·(800 − λ), λ in nm. */
export function blankAbsorbance(
  options: Pick<SyntheticSpectrumOptions, 'startNm' | 'endNm' | 'stepNm'> & {
    offset: number;
    slopePerNm: number;
  },
): { wavelengthNm: Float64Array; values: Float64Array } {
  const wavelengthNm = wavelengthGrid({ ...options, bandGapEv: 0 });
  return {
    wavelengthNm,
    values: wavelengthNm.map((w) => options.offset + options.slopePerNm * (800 - w)),
  };
}
