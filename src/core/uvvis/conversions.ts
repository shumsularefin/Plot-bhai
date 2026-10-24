/*
 * UV-Vis conversions. Wavelengths are in nanometres (nm), energies in electronvolts (eV),
 * transmittance T and reflectance R as fractions (0 to 1) unless a function says percent.
 */

/**
 * Fundamental constants, 2022 CODATA recommended values, https://physics.nist.gov/cgi-bin/cuu/Value
 * (pages for h, c and e, read on 2026-10-24). All three are exact by the 2019 SI definition.
 * Flagged for your verification.
 */
/** Planck constant h, J s. */
const PLANCK_J_S = 6.62607015e-34;
/** Speed of light in vacuum c, m/s. */
const LIGHT_M_PER_S = 299792458;
/** Elementary charge e, C (also the joules per electronvolt). */
const ELEMENTARY_CHARGE_C = 1.602176634e-19;

/**
 * h·c in eV·nm: hc / e × 10⁹ nm/m. About 1239.84 eV·nm; the rounded value 1240 is common in
 * textbooks but is not used here.
 */
export const HC_EV_NM = ((PLANCK_J_S * LIGHT_M_PER_S) / ELEMENTARY_CHARGE_C) * 1e9;

/** Photon energy E = hc / λ. λ in nm, result in eV. */
export function energyFromWavelength(wavelengthNm: number): number {
  return HC_EV_NM / wavelengthNm;
}

/** Wavelength λ = hc / E. E in eV, result in nm. */
export function wavelengthFromEnergy(energyEv: number): number {
  return HC_EV_NM / energyEv;
}

/**
 * Absorbance from percent transmittance: A = 2 − log₁₀(%T) = −log₁₀(T).
 * A is unitless (base-10 absorbance). Returns NaN for %T ≤ 0, where A is undefined.
 */
export function absorbanceFromPercentT(percentT: number): number {
  return percentT > 0 ? 2 - Math.log10(percentT) : NaN;
}

/** Percent transmittance from absorbance: %T = 100 · 10^(−A). */
export function percentTFromAbsorbance(absorbance: number): number {
  return 100 * 10 ** -absorbance;
}

/**
 * Kubelka–Munk function F(R) = (1 − R)² / (2R), for diffuse reflectance of an optically
 * thick sample. R is the reflectance as a fraction (0 to 1, not percent); F(R) is unitless and
 * proportional to the absorption coefficient divided by the scattering coefficient.
 * Returns NaN for R ≤ 0.
 */
export function kubelkaMunk(reflectance: number): number {
  return reflectance > 0 ? (1 - reflectance) ** 2 / (2 * reflectance) : NaN;
}

/** Maps a function over a Float64Array, returning a new array. */
export function mapValues(values: Float64Array, fn: (value: number) => number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = fn(values[i] as number);
  return out;
}
