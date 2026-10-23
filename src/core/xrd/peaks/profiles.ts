/*
 * Peak shapes used for fitting. Every shape is written as a pseudo-Voigt with parameters
 *   A  height above the background (intensity units)
 *   x0 centre (degrees 2θ)
 *   w  full width at half maximum, FWHM (degrees 2θ)
 *   η  Lorentzian fraction (0 = Gaussian, 1 = Lorentzian, dimensionless)
 *
 *   u(x) = 4 (x − x0)² / w²
 *   G(x) = exp(−ln 2 · u)                 Gaussian, height 1, FWHM w
 *   L(x) = 1 / (1 + u)                    Lorentzian, height 1, FWHM w
 *   f(x) = A · [η · L(x) + (1 − η) · G(x)]
 *
 * A Gaussian fit is f with η fixed at 0, a Lorentzian fit is f with η fixed at 1.
 */

export type ProfileKind = 'gaussian' | 'lorentzian' | 'pseudo-voigt';

export interface PeakParameters {
  height: number;
  center: number;
  fwhm: number;
  eta: number;
}

/** Profile value at x (same units as the parameters). */
export function profile(x: number, p: PeakParameters): number {
  const u = (4 * (x - p.center) ** 2) / (p.fwhm * p.fwhm);
  return p.height * (p.eta / (1 + u) + (1 - p.eta) * Math.exp(-Math.LN2 * u));
}

/**
 * Value and partial derivatives at x, with respect to [A, x0, w, η], for the fitter:
 *   ∂f/∂A  = η L + (1 − η) G
 *   ∂f/∂η  = A (L − G)
 *   ∂f/∂u  = −A [η L² + (1 − η) ln 2 · G]
 *   ∂u/∂x0 = −8 (x − x0) / w²,   ∂u/∂w = −2u / w
 */
export function profileWithGradient(x: number, p: PeakParameters, gradient: Float64Array): number {
  const d = x - p.center;
  const u = (4 * d * d) / (p.fwhm * p.fwhm);
  const g = Math.exp(-Math.LN2 * u);
  const l = 1 / (1 + u);
  const shape = p.eta * l + (1 - p.eta) * g;
  const dfdu = -p.height * (p.eta * l * l + (1 - p.eta) * Math.LN2 * g);
  gradient[0] = shape;
  gradient[1] = dfdu * ((-8 * d) / (p.fwhm * p.fwhm));
  gradient[2] = dfdu * ((-2 * u) / p.fwhm);
  gradient[3] = p.height * (l - g);
  return p.height * shape;
}

/** Area of the Gaussian part per unit height and width: ∫G dx = w · ½ √(π / ln 2). */
const GAUSS_AREA = 0.5 * Math.sqrt(Math.PI / Math.LN2);
/** Area of the Lorentzian part per unit height and width: ∫L dx = w · π / 2. */
const LORENTZ_AREA = Math.PI / 2;

/**
 * Integrated area under the peak (intensity × degrees):
 *   area = A · w · [η · π/2 + (1 − η) · ½ √(π / ln 2)].
 */
export function peakArea(p: PeakParameters): number {
  return p.height * p.fwhm * (p.eta * LORENTZ_AREA + (1 - p.eta) * GAUSS_AREA);
}

/** Gradient of the area with respect to [A, x0, w, η], for propagating uncertainties. */
export function peakAreaGradient(p: PeakParameters): [number, number, number, number] {
  const c = p.eta * LORENTZ_AREA + (1 - p.eta) * GAUSS_AREA;
  return [p.fwhm * c, 0, p.height * c, p.height * p.fwhm * (LORENTZ_AREA - GAUSS_AREA)];
}

/**
 * Integral breadth β = area / height (degrees): the width of a rectangle with the same height
 * and area. β = w · [η · π/2 + (1 − η) · ½ √(π / ln 2)].
 */
export function integralBreadth(p: PeakParameters): number {
  return p.fwhm * (p.eta * LORENTZ_AREA + (1 - p.eta) * GAUSS_AREA);
}

/** Gradient of β with respect to [A, x0, w, η]. */
export function integralBreadthGradient(p: PeakParameters): [number, number, number, number] {
  return [
    0,
    0,
    p.eta * LORENTZ_AREA + (1 - p.eta) * GAUSS_AREA,
    p.fwhm * (LORENTZ_AREA - GAUSS_AREA),
  ];
}
