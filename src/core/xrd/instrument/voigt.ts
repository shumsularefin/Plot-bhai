/*
 * Splitting a pseudo-Voigt peak into its Gaussian and Lorentzian widths, and joining them again.
 *
 * Thompson, Cox & Hastings (TCH), J. Appl. Cryst. 20 (1987) 79–83, approximate a Voigt profile
 * (a Gaussian of FWHM Γ_G convolved with a Lorentzian of FWHM Γ_L) by a pseudo-Voigt with
 *   Γ = (Γ_G⁵ + 2.69269 Γ_G⁴ Γ_L + 2.42843 Γ_G³ Γ_L² + 4.47163 Γ_G² Γ_L³ + 0.07842 Γ_G Γ_L⁴ + Γ_L⁵)^(1/5)
 *   η = 1.36603 ρ − 0.47719 ρ² + 0.11116 ρ³,   ρ = Γ_L / Γ
 * where Γ is the total FWHM and η the Lorentzian fraction (all widths in the same unit, here
 * degrees 2θ).
 *
 * Checked against the paper: η is eq. (2) and Γ is eq. (3), where Γ is the FWHM of a
 * pseudo-Voigt whose Lorentzian and Gaussian parts share that FWHM (eq. 1). The same
 * coefficients appear in GSAS-II (GSASIIpwd.py, getgamFW).
 */

/** Total FWHM of a Voigt with Gaussian FWHM g and Lorentzian FWHM l (TCH, same unit). */
export function tchFwhm(g: number, l: number): number {
  return (
    (g ** 5 +
      2.69269 * g ** 4 * l +
      2.42843 * g ** 3 * l ** 2 +
      4.47163 * g ** 2 * l ** 3 +
      0.07842 * g * l ** 4 +
      l ** 5) **
    0.2
  );
}

/** η from ρ = Γ_L / Γ (TCH). Increasing on [0, 1], with η(0) = 0 and η(1) = 1. */
export function tchEta(rho: number): number {
  return 1.36603 * rho - 0.47719 * rho ** 2 + 0.11116 * rho ** 3;
}

/** ρ = Γ_L / Γ for a given η, by bisection on the TCH cubic. η is clipped to [0, 1]. */
export function tchRho(eta: number): number {
  const target = Math.min(1, Math.max(0, eta));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tchEta(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Gaussian and Lorentzian FWHMs of a pseudo-Voigt with total FWHM `fwhm` and Lorentzian
 * fraction η: Γ_L = ρ Γ, then Γ_G solves tchFwhm(Γ_G, Γ_L) = Γ (by bisection; tchFwhm grows
 * with Γ_G, and Γ_G lies between 0 and Γ).
 */
export function splitVoigt(fwhm: number, eta: number): { gaussian: number; lorentzian: number } {
  const lorentzian = tchRho(eta) * fwhm;
  let lo = 0;
  let hi = fwhm;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tchFwhm(mid, lorentzian) < fwhm) lo = mid;
    else hi = mid;
  }
  return { gaussian: (lo + hi) / 2, lorentzian };
}
