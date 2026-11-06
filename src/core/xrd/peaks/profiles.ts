import { lnGamma } from '../../math/gamma';

/*
 * Peak shapes used for fitting. The basic shapes are written as a pseudo-Voigt with parameters
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
 *
 * Two more shapes (XRD Fit peaks only) carry their own parameters in `shape`:
 *
 * Pearson VII, shape m > ½ (m = 1 is a Lorentzian, m → ∞ a Gaussian):
 *   f(x) = A · [1 + 4 (2^(1/m) − 1) (x − x0)² / w²]^(−m)          FWHM w
 *   area = A · w · √π · Γ(m − ½) / [2 √(2^(1/m) − 1) · Γ(m)]
 * ("The approximation of symmetric X-ray peaks by Pearson type VII distributions", Hall et al.,
 * J. Appl. Cryst. 1977; written here with the FWHM w, as Fityk's Pearson7 is with hwhm = w/2.)
 *
 * Split pseudo-Voigt: a pseudo-Voigt of FWHM wL left of x0 and wR right of it, one η, height A
 * at x0 on both sides (as Fityk's SplitPseudoVoigt with the two shapes tied):
 *   FWHM = (wL + wR) / 2,   area = A · (wL + wR)/2 · [η π/2 + (1 − η) ½ √(π / ln 2)]
 *
 * For these two shapes `fwhm` is the true FWHM of the profile and `eta` is the η of the
 * pseudo-Voigt with the same FWHM and integral breadth (exact for the split pseudo-Voigt), so the
 * size, strain and instrument steps can use every shape alike.
 */

export type ProfileKind = 'gaussian' | 'lorentzian' | 'pseudo-voigt';

/** Shapes the XRD peak fit offers: the basic three plus Pearson VII and split pseudo-Voigt. */
export type FitProfileKind = ProfileKind | 'pearson-vii' | 'split-pseudo-voigt';

/** Parameters of the shapes that are not a plain pseudo-Voigt. Widths in degrees 2θ. */
export type PeakShape =
  | { kind: 'pearson-vii'; m: number }
  | { kind: 'split-pseudo-voigt'; fwhmLeft: number; fwhmRight: number };

export interface PeakParameters {
  height: number;
  center: number;
  fwhm: number;
  eta: number;
  /** Absent for a pseudo-Voigt (and so for Gaussian and Lorentzian). */
  shape?: PeakShape;
}

/** Pseudo-Voigt of height a, centre c, FWHM w and Lorentzian fraction η at x. */
function pseudoVoigtAt(x: number, a: number, c: number, w: number, eta: number): number {
  const u = (4 * (x - c) ** 2) / (w * w);
  return a * (eta / (1 + u) + (1 - eta) * Math.exp(-Math.LN2 * u));
}

/** Pearson VII of height a, centre c, FWHM w and shape m at x. */
export function pearsonVII(x: number, a: number, c: number, w: number, m: number): number {
  const k = 4 * (2 ** (1 / m) - 1);
  return a * (1 + (k * (x - c) ** 2) / (w * w)) ** -m;
}

/** Profile value at x (same units as the parameters). */
export function profile(x: number, p: PeakParameters): number {
  const shape = p.shape;
  if (shape?.kind === 'pearson-vii') return pearsonVII(x, p.height, p.center, p.fwhm, shape.m);
  if (shape?.kind === 'split-pseudo-voigt') {
    const w = x < p.center ? shape.fwhmLeft : shape.fwhmRight;
    return pseudoVoigtAt(x, p.height, p.center, w, p.eta);
  }
  return pseudoVoigtAt(x, p.height, p.center, p.fwhm, p.eta);
}

/** Area of a Pearson VII per unit height and FWHM: √π Γ(m − ½) / [2 √(2^(1/m) − 1) Γ(m)]. */
export function pearsonVIIAreaFactor(m: number): number {
  return (
    (Math.sqrt(Math.PI) * Math.exp(lnGamma(m - 0.5) - lnGamma(m))) /
    (2 * Math.sqrt(2 ** (1 / m) - 1))
  );
}

/** Area of the Gaussian part per unit height and width: ∫G dx = w · ½ √(π / ln 2). */
const GAUSS_AREA = 0.5 * Math.sqrt(Math.PI / Math.LN2);
/** Area of the Lorentzian part per unit height and width: ∫L dx = w · π / 2. */
const LORENTZ_AREA = Math.PI / 2;

/** Pearson VII shape m allowed in the fit. The area is finite only for m > ½. */
export const PEARSON_M_MIN = 0.6;
export const PEARSON_M_MAX = 50;

/*
 * Fit parameter vectors, per peak (widths in degrees):
 *   Gaussian, Lorentzian, pseudo-Voigt   [A, x0, w, η]          (η held at 0 or 1 for G and L)
 *   Pearson VII                          [A, x0, w, m]
 *   split pseudo-Voigt                   [A, x0, wL, wR, η]
 */

/** Number of fit parameters of one peak of this shape. */
export function parameterCount(kind: FitProfileKind): number {
  return kind === 'split-pseudo-voigt' ? 5 : 4;
}

/** The peak described by the parameter vector v at offset o. */
export function peakFromVector(
  kind: FitProfileKind,
  v: ArrayLike<number>,
  o: number,
): PeakParameters {
  const height = v[o] as number;
  const center = v[o + 1] as number;
  if (kind === 'pearson-vii') {
    const m = v[o + 3] as number;
    return { height, center, fwhm: v[o + 2] as number, eta: equivalentEta(m), shape: { kind, m } };
  }
  if (kind === 'split-pseudo-voigt') {
    const fwhmLeft = v[o + 2] as number;
    const fwhmRight = v[o + 3] as number;
    return {
      height,
      center,
      fwhm: (fwhmLeft + fwhmRight) / 2,
      eta: v[o + 4] as number,
      shape: { kind, fwhmLeft, fwhmRight },
    };
  }
  return { height, center, fwhm: v[o + 2] as number, eta: v[o + 3] as number };
}

/**
 * η of the pseudo-Voigt with the same FWHM and integral breadth as a Pearson VII of shape m:
 *   β / w = F(m) = η π/2 + (1 − η) ½ √(π / ln 2)   ⇒   η = (F(m) − c_G) / (c_L − c_G),
 * with F the area factor (pearsonVIIAreaFactor). F(1) = π/2 gives η = 1; F → c_G as m → ∞
 * gives η → 0. Clamped to [0, 1] (m < 1 has longer tails than a Lorentzian). An approximation:
 * the two shapes agree in FWHM and breadth, not point by point.
 */
export function equivalentEta(m: number): number {
  const eta = (pearsonVIIAreaFactor(m) - GAUSS_AREA) / (LORENTZ_AREA - GAUSS_AREA);
  return Math.min(1, Math.max(0, eta));
}

/** dF/dm of the Pearson VII area factor, by a central difference (step 1e-5 · m). */
function pearsonVIIAreaFactorSlope(m: number): number {
  const h = 1e-5 * m;
  return (pearsonVIIAreaFactor(m + h) - pearsonVIIAreaFactor(m - h)) / (2 * h);
}

/**
 * Value at x and partial derivatives with respect to the peak's parameter vector (see
 * parameterCount), for the fitter. Pseudo-Voigt, with u = 4 (x − x0)² / w²:
 *   ∂f/∂A  = η L + (1 − η) G
 *   ∂f/∂η  = A (L − G)
 *   ∂f/∂u  = −A [η L² + (1 − η) ln 2 · G]
 *   ∂u/∂x0 = −8 (x − x0) / w²,   ∂u/∂w = −2u / w
 * Split pseudo-Voigt: the same, with w = wL for x < x0 (the wR derivative 0) and w = wR
 * otherwise. Pearson VII, with d = x − x0, k = 4 (2^(1/m) − 1), s = 1 + k d² / w²:
 *   ∂f/∂A  = s^(−m)
 *   ∂f/∂x0 = 2 A m k d s^(−m−1) / w²
 *   ∂f/∂w  = 2 A m k d² s^(−m−1) / w³
 *   ∂f/∂m  = f · [−ln s + 4 ln 2 · 2^(1/m) d² / (m w² s)]
 */
export function profileWithGradient(x: number, p: PeakParameters, gradient: Float64Array): number {
  const d = x - p.center;
  const shape = p.shape;
  if (shape?.kind === 'pearson-vii') {
    const m = shape.m;
    const w2 = p.fwhm * p.fwhm;
    const k = 4 * (2 ** (1 / m) - 1);
    const s = 1 + (k * d * d) / w2;
    const base = s ** -m;
    const f = p.height * base;
    const common = (2 * p.height * m * k * base) / (s * w2);
    gradient[0] = base;
    gradient[1] = common * d;
    gradient[2] = (common * d * d) / p.fwhm;
    gradient[3] = f * (-Math.log(s) + (4 * Math.LN2 * 2 ** (1 / m) * d * d) / (m * w2 * s));
    return f;
  }
  const split = shape?.kind === 'split-pseudo-voigt';
  const left = split && x < p.center;
  const w = split ? (left ? shape.fwhmLeft : shape.fwhmRight) : p.fwhm;
  const u = (4 * d * d) / (w * w);
  const g = Math.exp(-Math.LN2 * u);
  const l = 1 / (1 + u);
  const mix = p.eta * l + (1 - p.eta) * g;
  const dfdu = -p.height * (p.eta * l * l + (1 - p.eta) * Math.LN2 * g);
  const dfdw = dfdu * ((-2 * u) / w);
  gradient[0] = mix;
  gradient[1] = dfdu * ((-8 * d) / (w * w));
  if (split) {
    gradient[2] = left ? dfdw : 0;
    gradient[3] = left ? 0 : dfdw;
    gradient[4] = p.height * (l - g);
  } else {
    gradient[2] = dfdw;
    gradient[3] = p.height * (l - g);
  }
  return p.height * mix;
}

/** Integral breadth per unit FWHM, β / w. */
function breadthFactor(p: PeakParameters): number {
  if (p.shape?.kind === 'pearson-vii') return pearsonVIIAreaFactor(p.shape.m);
  return p.eta * LORENTZ_AREA + (1 - p.eta) * GAUSS_AREA;
}

/**
 * Integrated area under the peak (intensity × degrees), A · w · β/w:
 *   pseudo-Voigt (w = FWHM) and split pseudo-Voigt (w = (wL + wR)/2):
 *     area = A · w · [η · π/2 + (1 − η) · ½ √(π / ln 2)]
 *   Pearson VII: area = A · w · √π Γ(m − ½) / [2 √(2^(1/m) − 1) Γ(m)]
 */
export function peakArea(p: PeakParameters): number {
  return p.height * p.fwhm * breadthFactor(p);
}

/**
 * Integral breadth β = area / height (degrees): the width of a rectangle with the same height
 * and area. β = w · (the bracket of peakArea).
 */
export function integralBreadth(p: PeakParameters): number {
  return p.fwhm * breadthFactor(p);
}

/**
 * Gradients of the derived quantities with respect to the peak's parameter vector (see
 * parameterCount), for propagating the fit covariance to their uncertainties.
 */
export function derivedGradients(p: PeakParameters): {
  fwhm: number[];
  eta: number[];
  area: number[];
  breadth: number[];
} {
  const shape = p.shape;
  if (shape?.kind === 'pearson-vii') {
    const f = pearsonVIIAreaFactor(shape.m);
    const slope = pearsonVIIAreaFactorSlope(shape.m);
    const raw = (f - GAUSS_AREA) / (LORENTZ_AREA - GAUSS_AREA);
    return {
      fwhm: [0, 0, 1, 0],
      eta: [0, 0, 0, raw > 0 && raw < 1 ? slope / (LORENTZ_AREA - GAUSS_AREA) : 0],
      area: [p.fwhm * f, 0, p.height * f, p.height * p.fwhm * slope],
      breadth: [0, 0, f, p.fwhm * slope],
    };
  }
  const c = breadthFactor(p);
  const dc = LORENTZ_AREA - GAUSS_AREA;
  if (shape?.kind === 'split-pseudo-voigt') {
    return {
      fwhm: [0, 0, 0.5, 0.5, 0],
      eta: [0, 0, 0, 0, 1],
      area: [p.fwhm * c, 0, (p.height * c) / 2, (p.height * c) / 2, p.height * p.fwhm * dc],
      breadth: [0, 0, c / 2, c / 2, p.fwhm * dc],
    };
  }
  return {
    fwhm: [0, 0, 1, 0],
    eta: [0, 0, 0, 1],
    area: [p.fwhm * c, 0, p.height * c, p.height * p.fwhm * dc],
    breadth: [0, 0, c, p.fwhm * dc],
  };
}
