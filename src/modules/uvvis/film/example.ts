import { energyFromWavelength } from '../../../core/uvvis/conversions';
import type { Spectrum } from '../../../core/uvvis/types';

/*
 * Made-up, noise-free spectra with known answers, for the example button and the tests. Neither is
 * a measurement of a real material.
 */

/** Plasmon example: one Lorentzian band at 2.38 eV (about 521 nm), FWHM 0.30 eV, on a sloped background. */
export const EXAMPLE_PLASMON = { centerEv: 2.38, fwhmEv: 0.3, height: 0.8 };

export function examplePlasmonSpectrum(): Spectrum {
  const wavelengthNm = Float64Array.from({ length: 501 }, (_, i) => 350 + i);
  const { centerEv, fwhmEv, height } = EXAMPLE_PLASMON;
  const values = wavelengthNm.map((l) => {
    const e = energyFromWavelength(l);
    return 0.05 + 0.04 * (e - 2) + height / (1 + (4 * (e - centerEv) ** 2) / (fwhmEv * fwhmEv));
  });
  return spectrum('Example plasmon band (synthetic)', wavelengthNm, values, 'absorbance');
}

/**
 * Thin-film example: a non-absorbing film, n(λ) = 2.0 + 3×10⁴ / λ² (λ in nm), 1000 nm thick, on a
 * substrate with s = 1.51, from the exact transmittance of a film on a thick substrate
 *   T = A / (B − C cos φ + D),  φ = 4π n d / λ,
 * A = 16 n² s, B = (n + 1)³ (n + s²), C = 2 (n² − 1)(n² − s²), D = (n − 1)³ (n − s²).
 */
export const EXAMPLE_FILM = {
  thicknessNm: 1000,
  substrate: 1.51,
  index: (l: number) => 2 + 3e4 / (l * l),
};

export function exampleFilmSpectrum(): Spectrum {
  const wavelengthNm = Float64Array.from({ length: 1101 }, (_, i) => 400 + i);
  const { thicknessNm: d, substrate: s, index } = EXAMPLE_FILM;
  const values = wavelengthNm.map((l) => {
    const n = index(l);
    const A = 16 * n * n * s;
    const B = (n + 1) ** 3 * (n + s * s);
    const C = 2 * (n * n - 1) * (n * n - s * s);
    const D = (n - 1) ** 3 * (n - s * s);
    return (100 * A) / (B - C * Math.cos((4 * Math.PI * n * d) / l) + D);
  });
  return spectrum('Example thin film (synthetic)', wavelengthNm, values, 'transmittance');
}

function spectrum(
  name: string,
  wavelengthNm: Float64Array,
  values: Float64Array,
  kind: Spectrum['kind'],
): Spectrum {
  return {
    id: name,
    name,
    source: 'synthetic',
    wavelengthNm,
    values,
    kind,
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
}
