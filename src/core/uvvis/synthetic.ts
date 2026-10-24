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

/** Normal noise by the Box–Muller method from a seeded uniform generator. */
function noiseSource(options: SyntheticSpectrumOptions): () => number {
  if (options.noiseSeed === undefined || !options.noiseSd) return () => 0;
  const random = seededRandom(options.noiseSeed);
  const sd = options.noiseSd;
  return () => sd * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/**
 * Absorbance of a direct allowed transition: A = slope · √(E − Eg) / E for E > Eg, else 0, plus
 * a constant baseline. E = hc/λ in eV. Because A·E = slope · √(E − Eg), the Tauc quantity
 * (A·E)² = slope² · (E − Eg) is exactly linear above the gap, with its line meeting zero at Eg.
 * slope in eV^(1/2), baseline unitless.
 */
export function directGapAbsorbance(
  options: SyntheticSpectrumOptions & { slope?: number; baseline?: number },
): { wavelengthNm: Float64Array; values: Float64Array } {
  const { bandGapEv, slope = 8, baseline = 0.02 } = options;
  const wavelengthNm = wavelengthGrid(options);
  const noise = noiseSource(options);
  const values = wavelengthNm.map((w) => {
    const energy = energyFromWavelength(w);
    return (slope * Math.sqrt(Math.max(energy - bandGapEv, 0))) / energy + baseline + noise();
  });
  return { wavelengthNm, values };
}

/**
 * Percent diffuse reflectance whose Kubelka–Munk function is F(R) = floor + slope · √(E − Eg) / E
 * above the gap (floor alone below it). Inverting F(R) = (1 − R)² / (2R) gives
 * R = 1 + F − √(F² + 2F), as a fraction; the result is multiplied by 100.
 */
export function directGapReflectance(
  options: SyntheticSpectrumOptions & { slope?: number; floor?: number },
): { wavelengthNm: Float64Array; values: Float64Array } {
  const { bandGapEv, slope = 8, floor = 0.01 } = options;
  const wavelengthNm = wavelengthGrid(options);
  const noise = noiseSource(options);
  const values = wavelengthNm.map((w) => {
    const energy = energyFromWavelength(w);
    const f = floor + (slope * Math.sqrt(Math.max(energy - bandGapEv, 0))) / energy;
    return 100 * (1 + f - Math.sqrt(f * f + 2 * f)) + noise();
  });
  return { wavelengthNm, values };
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
