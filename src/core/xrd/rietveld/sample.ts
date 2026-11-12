/*
 * Instrument and sample corrections of the Rietveld model (model.ts), each written to match the
 * definitions in GSAS-II (github.com/AdvancedPhotonSource/GSAS-II, GSASIIpwd.py and
 * GSASIIstrMath.py, commit 2c62562) so a refinement can be continued there with the same numbers.
 * Angles: θ in radians (the Bragg angle, half of 2θ); widths in degrees 2θ.
 */

const DEG = 180 / Math.PI;

/**
 * Polarisation factor of a laboratory X-ray beam, as in GSAS-II's Polarization() with azimuth 0:
 *   p(2θ) = P + (1 − P) cos²2θ
 * P is GSAS-II's "Polariz." coefficient: 0.5 for an unpolarised beam (no monochromator), so that
 * 2p = 1 + cos²2θ, the classical factor. Returned as 2p so that P = 0.5 gives exactly 1 + cos²2θ.
 */
export function polarisation(fraction: number, theta: number): number {
  const c = Math.cos(2 * theta);
  return 2 * (fraction + (1 - fraction) * c * c);
}

/**
 * The P that describes a crystal monochromator at the Bragg angle 2θ_m (degrees), for a beam
 * polarised by it and by the sample in the same plane:
 *   p(2θ) ∝ (1 + K cos²2θ) / (1 + K),  so  P = 1 / (1 + K),
 * with K = cos²2θ_m for a mosaic (ideally imperfect) crystal such as pyrolytic graphite and
 * K = |cos 2θ_m| for a perfect crystal such as germanium or silicon (the dynamical limit).
 */
export function monochromatorFraction(twoThetaM: number, perfect: boolean): number {
  const c = Math.cos(twoThetaM / DEG);
  const k = perfect ? Math.abs(c) : c * c;
  return 1 / (1 + k);
}

/** Bragg angle 2θ (degrees) of a monochromator reflection of spacing d (Å) for wavelength λ (Å). */
export function braggTwoTheta(lambda: number, d: number): number {
  return 2 * Math.asin(lambda / (2 * d)) * DEG;
}

/**
 * Suortti surface-roughness correction (P. Suortti, J. Appl. Cryst. 5 (1972) 325–331), in the form
 * of GSAS-II's SurfaceRough(), normalised to 1 at 2θ = 180°:
 *   SR(θ) = [A + (1 − A) exp(−B / sin θ)] / [A + (1 − A) exp(−B)]
 * A and B are dimensionless; A = 1 or B = 0 is a smooth surface (SR = 1). Roughness lowers the
 * intensity at low angle, which otherwise drives the displacement parameters negative.
 */
export function surfaceRoughness(a: number, b: number, theta: number): number {
  return (a + (1 - a) * Math.exp(-b / Math.sin(theta))) / (a + (1 - a) * Math.exp(-b));
}

/**
 * Intensity factor of an automatic (variable) divergence slit that keeps the irradiated length
 * constant. The slit opening, and so the incident flux, grows as sin θ, while a fixed slit gives a
 * constant irradiated volume for a thick sample; the measured intensity is therefore ∝ sin θ
 * relative to the fixed-slit pattern that the model calculates.
 */
export function variableSlitFactor(theta: number): number {
  return Math.sin(theta);
}

/**
 * Peak shift (degrees 2θ) from the penetration of the beam into a weakly absorbing thick sample,
 * GSAS-II's transparency term for Bragg–Brentano geometry: Δ2θ = T · sin 2θ, with T in degrees.
 * (GSAS-II writes −(9/π)·trans·sin 2θ / R with trans = 1/μ_eff in cm and R the goniometer radius
 * in mm; this site refines T directly. A positive 1/μ gives a negative T: peaks move to low angle.)
 */
export function transparencyShift(t: number, theta: number): number {
  return t * Math.sin(2 * theta);
}

/**
 * Sample broadening from crystallite size and microstrain, isotropic, as in GSAS-II's
 * GetSampleSigGam() for constant-wavelength data, converted from centidegrees to degrees:
 *   size:   H_S = (180/π) λ / (D cos θ)        D the crystallite size in Å (a Scherrer constant of 1
 *                                              on the full width at half maximum)
 *   strain: H_M = (180/π) 10⁻⁶ μ tan θ         μ the microstrain in GSAS-II's units (10⁻⁶)
 * Each width is split between the Lorentzian and Gaussian parts by its mixing coefficient m (1 is
 * all Lorentzian, GSAS-II's default):
 *   H_L = m_S H_S + m_M H_M,    H_G² = [(1 − m_S) H_S]² + [(1 − m_M) H_M]²
 * They add to the instrument's Lorentzian width and Gaussian variance before the TCH combination.
 * `inverseSize` is 1/D in nm⁻¹ (0 is no size broadening); λ in Å.
 */
export function sampleWidths(
  inverseSize: number,
  microstrain: number,
  sizeMix: number,
  strainMix: number,
  lambda: number,
  theta: number,
): { gaussian2: number; lorentzian: number } {
  const hs = (DEG * lambda * inverseSize) / (10 * Math.cos(theta));
  const hm = DEG * 1e-6 * microstrain * Math.tan(theta);
  return {
    lorentzian: sizeMix * hs + strainMix * hm,
    gaussian2: ((1 - sizeMix) * hs) ** 2 + ((1 - strainMix) * hm) ** 2,
  };
}

/**
 * Common laboratory monochromator reflections. Spacings flagged for the owner's verification:
 * graphite (002) d = c/2 with c = 6.708 Å; germanium (111) d = a/√3 with a = 5.6579 Å.
 * Pyrolytic graphite is a mosaic crystal; a Johansson germanium crystal is treated as perfect.
 */
export const MONOCHROMATORS = {
  graphite: { d: 6.708 / 2, perfect: false },
  germanium: { d: 5.6579 / Math.sqrt(3), perfect: true },
} as const;
