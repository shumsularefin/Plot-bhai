/**
 * Penetration depth of the evanescent wave in ATR (Harrick, Internal Reflection Spectroscopy,
 * 1967):
 *
 *   dp = λ / (2π n₁ √(sin²θ − (n₂/n₁)²))
 *
 * λ is the vacuum wavelength (λ = 10⁴ / ν̃ µm for ν̃ in cm⁻¹), n₁ the refractive index of the
 * crystal, n₂ that of the sample and θ the angle of incidence. Returns dp in µm, or null when there
 * is no total internal reflection (sin θ ≤ n₂/n₁) or an input is not positive.
 */
export function penetrationDepthUm(
  wavenumberCm: number,
  crystalIndex: number,
  sampleIndex: number,
  angleDeg: number,
): number | null {
  if (!(wavenumberCm > 0 && crystalIndex > 0 && sampleIndex > 0)) return null;
  const sin = Math.sin((angleDeg * Math.PI) / 180);
  const under = sin * sin - (sampleIndex / crystalIndex) ** 2;
  if (!(under > 0) || sin <= 0) return null;
  return 1e4 / wavenumberCm / (2 * Math.PI * crystalIndex * Math.sqrt(under));
}

/**
 * Simple ATR correction for the wavelength dependence of the penetration depth. Because dp ∝ λ ∝
 * 1/ν̃ (refractive indices taken as constant), the absorbance is scaled to the depth at a reference
 * wavenumber: A_corr(ν̃) = A(ν̃) · ν̃ / ν̃_ref (A dimensionless, ν̃ and ν̃_ref in cm⁻¹). It does not
 * correct the band shifts and shape changes caused by the dispersion of n₂ near strong bands.
 */
export function atrCorrect(
  wavenumber: Float64Array,
  absorbance: Float64Array,
  referenceCm: number,
): Float64Array {
  return absorbance.map((a, i) => (a * (wavenumber[i] as number)) / referenceCm);
}
