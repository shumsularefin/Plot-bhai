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
 * Source: S. L. Morelhão et al., arXiv:1911.00396 (supporting information of J. Phys. Chem. C 123
 * (2019) 24818), section S3: the π/σ ratio after one reflection is cos²2θ_m for kinematical
 * diffraction and at most cos 2θ_m for a thick perfect crystal (0.675 against cos 2θ_m = 0.703 for
 * Ge 220 and Cu Kα1 in their dynamical calculation), so K = |cos 2θ_m| is an upper limit there.
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
 * Common laboratory monochromator reflections, with cells from the Crystallography Open Database:
 * graphite (002), d = c/2 with c = 6.711 Å (COD 9011577, hexagonal graphite, Nature 258 (1975)
 * 136); germanium (111), d = a/√3 with a = 5.65754 Å (COD 9011050, "Precise lattice constants of
 * germanium …", Acta Cryst. 1962). Pyrolytic graphite is a mosaic crystal; a Johansson germanium
 * crystal is treated as perfect. A change of d by 0.005 Å moves P by less than 2 × 10⁻⁴ (tested).
 */
export const MONOCHROMATORS = {
  graphite: { d: 6.711 / 2, perfect: false },
  germanium: { d: 5.65754 / Math.sqrt(3), perfect: true },
} as const;

/**
 * Absorption factor of a cylindrical (capillary, Debye–Scherrer) sample fully bathed in the beam,
 * A(μR, θ), exactly as GSAS-II's Absorb('Cylinder') in GSASIIpwd.py (commit 2c62562), whose source
 * comment attributes the fit to Lobanov & Alte da Veiga (the original publication could not be
 * read here, so it is not cited further). The fit agrees within 1.1 % with the absorption integral
 * itself, the mean of exp(−μ(t_in + t_out)) over the circular cross-section, for μR from 0.1 to 8
 * and 2θ from 10° to 150° (tests/rietveld-dispersion.test.ts). μR is the linear absorption coefficient times the capillary
 * radius (dimensionless), θ the Bragg angle in radians, S = sin²θ:
 *   μR ≤ 3:  A = exp(−T0 μR − T1 μR² − T2 μR³ − T3 μR⁴)
 *            T0 = 16/(3π)
 *            T1 = (25.99978 − 0.01911 S^¼) exp(−0.024551 S) + 0.109561 √S − 26.04556
 *            T2 = −0.02489 − 0.39499 S + 1.219077 S^1.5 − 1.31268 S² + 0.871081 S^2.5 − 0.2327 S³
 *            T3 = 0.003045 + 0.018167 S − 0.03305 S²
 *   μR > 3:  A = [(T1 − T4) / (1 + T2 (μR − 3))^T3 + T4] / 100
 *            T1 = 1.433902 + 11.07504 S − 8.77629 S² + 10.02088 S³ − 3.36778 S⁴
 *            T2 = (0.013869 − 0.01249 S) exp(3.27094 S) + (0.337894 + 13.77317 S) / (1 + 11.53544 S)^1.555039
 *            T3 = 1.933433 / (1 + 23.12967 S)^1.686715 − 0.13576 √S + 1.163198
 *            T4 = 0.044365 − 0.04259 / (1 + 0.41051 S)^148.4202
 * A = 1 at μR = 0. The two branches do not meet exactly: A steps by up to 2.7 % at μR = 3 (tested),
 * as in GSAS-II. Absorption in a capillary lowers the low-angle intensity most (the beam
 * scattered forward crosses the most material), the opposite of a displacement factor B, so μR
 * and B are correlated and μR is best fixed from the sample's composition, packing and radius.
 */
export function cylinderAbsorption(muR: number, theta: number): number {
  const s = Math.sin(theta) ** 2;
  if (muR <= 3) {
    const t0 = 16 / (3 * Math.PI);
    const t1 =
      (25.99978 - 0.01911 * s ** 0.25) * Math.exp(-0.024551 * s) +
      0.109561 * Math.sqrt(s) -
      26.04556;
    const t2 =
      -0.02489 -
      0.39499 * s +
      1.219077 * s ** 1.5 -
      1.31268 * s ** 2 +
      0.871081 * s ** 2.5 -
      0.2327 * s ** 3;
    const t3 = 0.003045 + 0.018167 * s - 0.03305 * s ** 2;
    return Math.exp(-t0 * muR - t1 * muR ** 2 - t2 * muR ** 3 - t3 * muR ** 4);
  }
  const t1 = 1.433902 + 11.07504 * s - 8.77629 * s ** 2 + 10.02088 * s ** 3 - 3.36778 * s ** 4;
  const t2 =
    (0.013869 - 0.01249 * s) * Math.exp(3.27094 * s) +
    (0.337894 + 13.77317 * s) / (1 + 11.53544 * s) ** 1.555039;
  const t3 = 1.933433 / (1 + 23.12967 * s) ** 1.686715 - 0.13576 * Math.sqrt(s) + 1.163198;
  const t4 = 0.044365 - 0.04259 / (1 + 0.41051 * s) ** 148.4202;
  return ((t1 - t4) / (1 + t2 * (muR - 3)) ** t3 + t4) / 100;
}

/**
 * Peak shift (degrees 2θ) from a capillary off the goniometer axis, GSAS-II's Debye–Scherrer
 * terms: Δ2θ = Dx cos 2θ + Dy sin 2θ, Dx for a displacement perpendicular to the beam and Dy along
 * it. GSAS-II gives them in μm (DisplaceX, DisplaceY) with Δ2θ = −(180/π)·10⁻³·(X cos 2θ +
 * Y sin 2θ)/R, R the goniometer radius in mm; this site refines Dx and Dy in degrees.
 */
export function capillaryShift(dx: number, dy: number, theta: number): number {
  return dx * Math.cos(2 * theta) + dy * Math.sin(2 * theta);
}

/** Dx or Dy in degrees for a GSAS-II DisplaceX or DisplaceY in μm and a radius R in mm. */
export function capillaryDegrees(microns: number, radius: number): number {
  return -(DEG * 1e-3 * microns) / radius;
}
