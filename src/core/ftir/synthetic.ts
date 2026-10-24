import { seededNoise } from '../uvvis/synthetic';
import { percentTFromAbsorbance } from '../uvvis/conversions';

/*
 * Synthetic FTIR spectra for the example data and for tests. They are generated, not measured,
 * and do not represent any real material: the band positions are arbitrary round numbers chosen
 * here, not assignments.
 */

export interface SyntheticBand {
  /** Centre, cm⁻¹. */
  centre: number;
  /** Full width at half maximum, cm⁻¹. */
  fwhm: number;
  /** Peak absorbance above the baseline. */
  height: number;
}

/** Band positions of the example spectrum. Arbitrary; used by the tests to check peak picking. */
export const EXAMPLE_BANDS: readonly SyntheticBand[] = [
  { centre: 3400, fwhm: 300, height: 0.5 },
  { centre: 2920, fwhm: 30, height: 0.3 },
  { centre: 1720, fwhm: 25, height: 0.45 },
  { centre: 1450, fwhm: 40, height: 0.25 },
  { centre: 1100, fwhm: 60, height: 0.55 },
  { centre: 560, fwhm: 50, height: 0.4 },
];

export interface SyntheticFtirOptions {
  startCm: number;
  endCm: number;
  stepCm: number;
  bands: readonly SyntheticBand[];
  /** Baseline absorbance: offset + slope · (4000 − ν) + curvature · ((4000 − ν) / 1000)². */
  baseline?: { offset: number; slope: number; curvature: number };
  noiseSeed?: number;
  noiseSd?: number;
}

/**
 * Absorbance: a sum of Lorentzian bands, A(ν) = Σ h · (Γ/2)² / ((ν − ν0)² + (Γ/2)²) with
 * height h, centre ν0 and FWHM Γ in cm⁻¹, plus a smooth baseline and optional noise.
 */
export function generateFtir(options: SyntheticFtirOptions): {
  wavenumber: Float64Array;
  absorbance: Float64Array;
} {
  const { startCm, endCm, stepCm, bands, baseline, noiseSeed, noiseSd } = options;
  const n = Math.floor((endCm - startCm) / stepCm + 1e-9) + 1;
  const wavenumber = Float64Array.from({ length: n }, (_, i) => startCm + i * stepCm);
  const noise = noiseSeed !== undefined && noiseSd ? seededNoise(noiseSeed, noiseSd) : () => 0;
  const absorbance = wavenumber.map((v) => {
    let a = 0;
    for (const b of bands) {
      const half = b.fwhm / 2;
      a += (b.height * half * half) / ((v - b.centre) ** 2 + half * half);
    }
    if (baseline) {
      const t = 4000 - v;
      a += baseline.offset + baseline.slope * t + baseline.curvature * (t / 1000) ** 2;
    }
    return a + noise();
  });
  return { wavenumber, absorbance };
}

/** Percent transmittance of an absorbance spectrum: %T = 100 · 10^(−A). */
export const transmittanceOf = (absorbance: Float64Array): Float64Array =>
  absorbance.map(percentTFromAbsorbance);
