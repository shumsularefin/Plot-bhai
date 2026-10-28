import { linearFit, originFit, type LinearFit } from '../../math/linearFit';
import type { DataMessage } from '../types';

/*
 * Crystallite size and microstrain from peak widths.
 *
 * Symbols and units used throughout:
 *   β   sample FWHM after instrument correction, in RADIANS of 2θ
 *   θ   Bragg angle = 2θ / 2, radians
 *   λ   wavelength, nm (Kα1 of the selected anode)
 *   K   shape factor (Scherrer constant), dimensionless
 *   D   crystallite size (volume-weighted mean column length in the Scherrer sense), nm
 *   ε   microstrain, dimensionless, defined as in Williamson–Hall: strain broadening
 *       β_ε = 4 ε tan θ. Every method below reports ε in this one convention so the numbers
 *       can be compared. (Papers using the size–strain plot or Halder–Wagner with an
 *       "(ε/2)²" intercept report the apparent strain η = 4ε instead; see those functions.)
 *   d   interplanar spacing from Bragg's law, d = λ / (2 sin θ), nm
 *   E   Young's modulus, GPa (per peak direction E_hkl when given)
 *
 * Every citation below was checked against the paper itself.
 */

/** One selected peak. */
export interface SizePeak {
  /** Peak position, degrees 2θ. */
  twoTheta: number;
  /** Corrected FWHM β, radians 2θ. */
  beta: number;
  /** Standard uncertainty of β, radians. */
  betaSigma: number;
  /** Young's modulus for this peak's direction, GPa, or null to use the common value. */
  modulusGPa: number | null;
}

export interface SizeSettings {
  k: number;
  /** Wavelength, nm. */
  lambdaNm: number;
  /** Young's modulus used for peaks without their own value, GPa. */
  modulusGPa: number | null;
}

/** A value with its standard uncertainty. value is NaN when no physical value exists. */
export interface Estimate {
  value: number;
  sigma: number;
}

const DEG = Math.PI / 180;
const theta = (twoTheta: number) => (twoTheta / 2) * DEG;

/** Bragg spacing d = λ / (2 sin θ), nm (λ in nm, 2θ in degrees). */
export function spacingNm(twoTheta: number, lambdaNm: number): number {
  return lambdaNm / (2 * Math.sin(theta(twoTheta)));
}

// ---------------------------------------------------------------- Scherrer

export interface ScherrerRow {
  twoTheta: number;
  beta: number;
  size: Estimate;
}

export interface ScherrerResult {
  rows: ScherrerRow[];
  /** Mean and sample standard deviation of the per-peak sizes, nm. */
  mean: number;
  sd: number;
  messages: DataMessage[];
}

/**
 * Scherrer equation, one size per peak: D = K λ / (β cos θ).
 * P. Scherrer, Nachr. Ges. Wiss. Göttingen, Math.-Phys. Kl. (1918) 98–100, session of 26 July
 * 1918; checked against the paper. On p. 99 he gives the half-width h = 2 √(ln 2 / π) · (λ / Λ) ·
 * 1 / cos(θ / 2) for cubic crystallites of edge Λ, with θ the scattering angle (2θ today) and h
 * in radians: D = K λ / (β cos θ) with K = 2 √(ln 2 / π) ≈ 0.94 for that case. K is a setting
 * here because its value depends on the crystallite shape and on the breadth used (FWHM or
 * integral breadth). σ(D) = D σ(β) / β.
 * It attributes all broadening to size, so with strain present D is an underestimate.
 */
export function scherrer(peaks: readonly SizePeak[], settings: SizeSettings): ScherrerResult {
  const rows = peaks.map((p) => {
    const value = (settings.k * settings.lambdaNm) / (p.beta * Math.cos(theta(p.twoTheta)));
    return {
      twoTheta: p.twoTheta,
      beta: p.beta,
      size: { value, sigma: (value * p.betaSigma) / p.beta },
    };
  });
  const sizes = rows.map((r) => r.size.value);
  const n = sizes.length;
  const mean = n > 0 ? sizes.reduce((s, v) => s + v, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(sizes.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : NaN;
  const messages: DataMessage[] = [];
  if (n === 0) messages.push({ level: 'error', text: 'No peaks are selected.' });
  return { rows, mean, sd, messages };
}

// ---------------------------------------------------------------- straight-line methods

export type LineMethod =
  'monshi' | 'linear-scherrer' | 'sahadat' | 'wh-udm' | 'wh-usdm' | 'wh-udedm' | 'ssp' | 'hw';

export interface LinePoint {
  twoTheta: number;
  x: number;
  y: number;
}

export interface LineResult {
  method: LineMethod;
  points: LinePoint[];
  fit: LinearFit | null;
  size: Estimate | null;
  strain: Estimate | null;
  /** Uniform stress, GPa (USDM, UDEDM). */
  stress?: Estimate;
  /** Deformation energy density, kJ/m³ (UDEDM). */
  energyDensity?: Estimate;
  messages: DataMessage[];
  /** Why the method cannot run at all (for example, Young's modulus missing). */
  unavailable?: string;
}

const NOT_PHYSICAL: Estimate = { value: NaN, sigma: NaN };

/** D = K λ / q with σ(D) = D σ(q) / q, for a fitted quantity q > 0. */
const sizeFrom = (s: SizeSettings, q: number, qSigma: number): Estimate => {
  const value = (s.k * s.lambdaNm) / q;
  return { value, sigma: (value * qSigma) / q };
};

/** Size from an intercept c = K λ / D (Williamson–Hall family). */
function sizeFromIntercept(fit: LinearFit, s: SizeSettings, messages: DataMessage[]): Estimate {
  const c = fit.intercept;
  if (!(c > 0)) {
    messages.push({
      level: 'error',
      text: `The line meets the vertical axis at ${c.toPrecision(3)}, at or below zero. That would mean an infinite or negative crystallite size, which has no physical meaning, so no size is given. Common causes: crystallites larger than the instrument can resolve, strain that is not uniform, peaks that overlap, or too few peaks.`,
    });
    return NOT_PHYSICAL;
  }
  return sizeFrom(s, c, fit.interceptSigma);
}

function negativeSlope(fit: LinearFit, quantity: string, messages: DataMessage[]): boolean {
  if (fit.slope >= 0) return false;
  messages.push({
    level: 'error',
    text: `The fitted slope is negative (${fit.slope.toPrecision(3)}), which would mean a negative ${quantity}. Microstrain describes a spread of lattice spacings and cannot be negative, so no ${quantity} is given. This often means the width does not grow with angle as the model assumes: for example, the crystallites have different sizes in different directions, or some peaks overlap.`,
  });
  return true;
}

function commonChecks(fit: LinearFit, messages: DataMessage[]): void {
  if (fit.n === 2) {
    messages.push({
      level: 'warning',
      text: 'Only two peaks: the line passes through both exactly, so no uncertainty or R² can be given. Select more peaks.',
    });
  } else if (fit.rSquared < 0.5) {
    messages.push({
      level: 'warning',
      text: `The points scatter far from a straight line (R² = ${fit.rSquared.toFixed(2)}), so this model does not describe the sample well. Treat the numbers with caution.`,
    });
  }
}

function lineOf(
  peaks: readonly SizePeak[],
  point: (p: SizePeak, index: number) => [number, number],
  throughOrigin = false,
): { points: LinePoint[]; fit: LinearFit | null; messages: DataMessage[] } {
  const points = peaks.map((p, i) => {
    const [x, y] = point(p, i);
    return { twoTheta: p.twoTheta, x, y };
  });
  const fit = (throughOrigin ? originFit : linearFit)(
    points.map((p) => p.x),
    points.map((p) => p.y),
  );
  const messages: DataMessage[] = [];
  if (!fit) {
    messages.push({
      level: 'error',
      text: 'Select at least two peaks at different angles (four or more spread over a wide 2θ range is better).',
    });
  } else {
    commonChecks(fit, messages);
  }
  return { points, fit, messages };
}

/**
 * Monshi–Scherrer: ln β = ln(K λ / D) + ln(1 / cos θ). A least-squares line through
 * (ln(1/cos θ), ln β) gives D = K λ / e^intercept from all peaks at once.
 * Monshi, Foroughi & Monshi, World J. Nano Sci. Eng. 2 (2012) 154–160, eqs. (11)–(12): the
 * line's slope is left free ("the least squares method gives the best slope and most accurate
 * ln K/L") and only the intercept is used. σ(D) = D σ(intercept).
 * For pure size broadening the slope is 1. The paper's own fits have slopes far from 1 (some
 * negative), so the app only warns about it.
 */
export function monshi(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const { points, fit, messages } = lineOf(peaks, (p) => [
    Math.log(1 / Math.cos(theta(p.twoTheta))),
    Math.log(p.beta),
  ]);
  if (!fit) return { method: 'monshi', points, fit, size: null, strain: null, messages };
  const value = (s.k * s.lambdaNm) / Math.exp(fit.intercept);
  if (Math.abs(fit.slope - 1) > 0.5) {
    messages.push({
      level: 'warning',
      text: `The slope is ${fit.slope.toFixed(2)}, far from the value of 1 expected when only size broadens the peaks. Strain or uncorrected instrument broadening is probably present, so this size is less reliable; compare with Williamson–Hall.`,
    });
  }
  return {
    method: 'monshi',
    points,
    fit,
    size: { value, sigma: value * fit.interceptSigma },
    strain: null,
    messages,
  };
}

/** Size from the slope Kλ/D of a cos θ against 1/β line (the two methods below). */
function sizeFromSlope(fit: LinearFit, s: SizeSettings, messages: DataMessage[]): Estimate {
  if (!(fit.slope > 0)) {
    messages.push({
      level: 'error',
      text: `The slope is ${fit.slope.toPrecision(3)}, at or below zero, which would mean an infinite or negative crystallite size, so no size is given. The widths probably do not follow 1/cos θ: strain, overlapping peaks or too few peaks.`,
    });
    return NOT_PHYSICAL;
  }
  return sizeFrom(s, fit.slope, fit.slopeSigma);
}

/**
 * Linear straight-line method of the Scherrer equation. Rearranging D = K λ / (β cos θ) gives
 *   cos θ = (K λ / D) · (1 / β).
 * A least-squares line through (1/β, cos θ) with a free intercept gives D = K λ / slope; the
 * intercept is not used. Rabiei, Palevicius, Monshi, Nasiri, Vilkauskas & Janusas,
 * Nanomaterials 10 (2020) 1627, section 3.1.1, eq. (3) (doi:10.3390/nano10091627).
 * σ(D) = D σ(slope) / slope. That paper found this free line gave sizes of hundreds to
 * thousands of nm for ~60 nm crystals and turned to the line through the origin (below).
 */
export function linearScherrer(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const { points, fit, messages } = lineOf(peaks, (p) => [1 / p.beta, Math.cos(theta(p.twoTheta))]);
  if (!fit) return { method: 'linear-scherrer', points, fit, size: null, strain: null, messages };
  return {
    method: 'linear-scherrer',
    points,
    fit,
    size: sizeFromSlope(fit, s, messages),
    strain: null,
    messages,
  };
}

/**
 * Sahadat–Scherrer: the same axes as the linear straight-line method, cos θ against 1/β, with
 * the line forced through the origin (y = slope · x, see originFit), D = K λ / slope.
 * Hossain, Mahmud, Mobarak, Sultana, Shaikh & Ahmed, Chem. Pap. 76 (2022) 7245–7251
 * (doi:10.1007/s11696-022-02377-9), "Model 2", checked against the paper: cos θ is plotted
 * against 1 / FWHM (eq. 7), the intercept is set to zero and D = K λ / slope. The name
 * "Sahadat–Scherrer" is from later papers by the same group (Kawsar, Hossain, Bahadur & Ahmed,
 * Heliyon 10 (2024) e25347, eq. 30). Rabiei et al. (2020, section 3.1.2, eq. 4) used the same
 * line through the origin.
 * σ(D) = D σ(slope) / slope.
 */
export function sahadatScherrer(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const { points, fit, messages } = lineOf(
    peaks,
    (p) => [1 / p.beta, Math.cos(theta(p.twoTheta))],
    true,
  );
  if (!fit) return { method: 'sahadat', points, fit, size: null, strain: null, messages };
  return {
    method: 'sahadat',
    points,
    fit,
    size: sizeFromSlope(fit, s, messages),
    strain: null,
    messages,
  };
}

/**
 * Williamson–Hall, uniform deformation model (UDM):
 *   β cos θ = K λ / D + 4 ε sin θ.
 * Plot β cos θ against 4 sin θ: slope ε, intercept K λ / D. This is the form written by
 * Mote, Purushotham & Dole (eq. 5, see USDM below). Williamson & Hall, Acta Metall. 1 (1953)
 * 22–31, eq. (4), wrote β = 2ξ tan θ + λ / (t cos θ) with integral breadths, ξ the integral
 * breadth of the strain distribution (Stokes & Wilson) and K = 1; so ε here equals ξ / 2.
 */
export function williamsonHallUdm(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const { points, fit, messages } = lineOf(peaks, (p) => [
    4 * Math.sin(theta(p.twoTheta)),
    p.beta * Math.cos(theta(p.twoTheta)),
  ]);
  if (!fit) return { method: 'wh-udm', points, fit, size: null, strain: null, messages };
  const size = sizeFromIntercept(fit, s, messages);
  const strain = negativeSlope(fit, 'strain', messages)
    ? NOT_PHYSICAL
    : { value: fit.slope, sigma: fit.slopeSigma };
  return { method: 'wh-udm', points, fit, size, strain, messages };
}

function moduli(peaks: readonly SizePeak[], s: SizeSettings): number[] | null {
  const e = peaks.map((p) => p.modulusGPa ?? s.modulusGPa);
  return e.every((v): v is number => v !== null && v > 0) ? e : null;
}

const NEEDS_MODULUS =
  "Enter Young's modulus (GPa) for the material, or for every selected peak, to use this model.";

/**
 * Williamson–Hall, uniform stress deformation model (USDM; Mote et al. call it UDSM). Hooke's
 * law ε = σ / E_hkl gives
 *   β cos θ = K λ / D + 4 σ sin θ / E_hkl.
 * Plot β cos θ against 4 sin θ / E_hkl (GPa⁻¹): slope σ (GPa), intercept K λ / D.
 * Strain is reported as the mean of σ / E_hkl over the selected peaks.
 * Mote, Purushotham & Dole, J. Theor. Appl. Phys. 6 (2012) 6, eq. (6)
 * (doi:10.1186/2251-7235-6-6).
 */
export function williamsonHallUsdm(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const e = moduli(peaks, s);
  if (!e) return unavailable('wh-usdm', NEEDS_MODULUS);
  const { points, fit, messages } = lineOf(peaks, (p, i) => {
    return [
      (4 * Math.sin(theta(p.twoTheta))) / (e[i] as number),
      p.beta * Math.cos(theta(p.twoTheta)),
    ];
  });
  if (!fit) return { method: 'wh-usdm', points, fit, size: null, strain: null, messages };
  const size = sizeFromIntercept(fit, s, messages);
  if (negativeSlope(fit, 'stress', messages)) {
    return {
      method: 'wh-usdm',
      points,
      fit,
      size,
      strain: NOT_PHYSICAL,
      stress: NOT_PHYSICAL,
      messages,
    };
  }
  const meanInverse = e.reduce((sum, v) => sum + 1 / v, 0) / e.length;
  return {
    method: 'wh-usdm',
    points,
    fit,
    size,
    stress: { value: fit.slope, sigma: fit.slopeSigma },
    strain: { value: fit.slope * meanInverse, sigma: fit.slopeSigma * meanInverse },
    messages,
  };
}

/**
 * Williamson–Hall, uniform deformation energy density model (UDEDM). With energy density
 * u = ε² E_hkl / 2, ε = √(2u / E_hkl) and
 *   β cos θ = K λ / D + 4 sin θ √(2u / E_hkl).
 * Plot β cos θ against 4 sin θ √(2 / E_hkl) (GPa^−½): slope √u (GPa^½), intercept K λ / D.
 * u is reported in kJ/m³ (1 GPa = 10⁶ kJ/m³); strain as the mean of √(2u / E_hkl) and stress
 * as the mean of √(2u E_hkl) (GPa) over the selected peaks. Mote et al., eq. (8).
 */
export function williamsonHallUdedm(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  const e = moduli(peaks, s);
  if (!e) return unavailable('wh-udedm', NEEDS_MODULUS);
  const { points, fit, messages } = lineOf(peaks, (p, i) => {
    return [
      4 * Math.sin(theta(p.twoTheta)) * Math.sqrt(2 / (e[i] as number)),
      p.beta * Math.cos(theta(p.twoTheta)),
    ];
  });
  if (!fit) return { method: 'wh-udedm', points, fit, size: null, strain: null, messages };
  const size = sizeFromIntercept(fit, s, messages);
  if (negativeSlope(fit, 'energy density', messages)) {
    return {
      method: 'wh-udedm',
      points,
      fit,
      size,
      strain: NOT_PHYSICAL,
      stress: NOT_PHYSICAL,
      energyDensity: NOT_PHYSICAL,
      messages,
    };
  }
  const root = fit.slope; // √u, GPa^½
  const u = root * root; // GPa
  const relative = root > 0 ? fit.slopeSigma / root : NaN; // σ(√u)/√u; σ(u)/u is twice this
  const strain = e.reduce((sum, v) => sum + Math.sqrt((2 * u) / v), 0) / e.length;
  const stress = e.reduce((sum, v) => sum + Math.sqrt(2 * u * v), 0) / e.length;
  return {
    method: 'wh-udedm',
    points,
    fit,
    size,
    energyDensity: { value: u * 1e6, sigma: u * 1e6 * 2 * relative },
    strain: { value: strain, sigma: strain * relative },
    stress: { value: stress, sigma: stress * relative },
    messages,
  };
}

/**
 * Both the size–strain plot and Halder–Wagner assume a Lorentzian size profile and a
 * Gaussian strain profile, combined as β² = β·β_D + β_ε², with β_D = K λ / (D cos θ) and
 * β_ε = 4 ε tan θ. Dividing by suitable factors gives a straight line whose slope is K λ / D
 * and whose intercept is proportional to ε². Each function below states its axes.
 */
function lorentzGauss(
  method: 'ssp' | 'hw',
  peaks: readonly SizePeak[],
  s: SizeSettings,
  point: (p: SizePeak, index: number) => [number, number],
  strainFromIntercept: (c: number) => number,
): LineResult {
  const { points, fit, messages } = lineOf(peaks, point);
  if (!fit) return { method, points, fit, size: null, strain: null, messages };
  let size: Estimate = NOT_PHYSICAL;
  if (!(fit.slope > 0)) {
    messages.push({
      level: 'error',
      text: `The fitted slope is ${fit.slope.toPrecision(3)}, at or below zero. That would mean an infinite or negative crystallite size, which has no physical meaning, so no size is given.`,
    });
  } else {
    size = sizeFrom(s, fit.slope, fit.slopeSigma);
  }
  let strain: Estimate = NOT_PHYSICAL;
  if (fit.intercept < 0) {
    messages.push({
      level: 'error',
      text: `The line meets the vertical axis below zero (${fit.intercept.toPrecision(3)}). The intercept is the square of a strain term, so a negative value has no physical meaning and no strain is given. The strain is probably too small to measure with these peaks.`,
    });
  } else {
    const value = strainFromIntercept(fit.intercept);
    // ε ∝ √c, so σ(ε) / ε = σ(c) / (2c).
    strain = {
      value,
      sigma: fit.intercept > 0 ? (value * fit.interceptSigma) / (2 * fit.intercept) : NaN,
    };
  }
  return { method, points, fit, size, strain, messages };
}

/**
 * Size–strain plot (SSP), in the dimensionally consistent real-space form
 *   (d β cos θ)² = (K λ / D) · (d² β cos θ) + 4 ε² λ²
 * (d and λ in nm, so both axes are in nm²). Slope K λ / D; intercept 4 ε² λ², so
 * ε = √intercept / (2 λ). This is A. Pal's corrected eq. (10) multiplied by λ²
 * (arXiv:2512.00689v2; J. Alloys Compd. 1048 (2025) 185324), whose strain σ is defined by a
 * Gaussian reciprocal breadth β*_G = σ d* / 2, so σ = 4ε. The widely quoted form
 * "(K/D)(d²β cos θ) + (ε/2)²" (Pal's eq. 8) leaves out λ and is dimensionally inconsistent.
 */
export function sizeStrainPlot(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  return lorentzGauss(
    'ssp',
    peaks,
    s,
    (p) => {
      const d = spacingNm(p.twoTheta, s.lambdaNm);
      const bc = p.beta * Math.cos(theta(p.twoTheta));
      return [d * d * bc, (d * bc) ** 2];
    },
    (c) => Math.sqrt(c) / (2 * s.lambdaNm),
  );
}

/**
 * Halder–Wagner, in angle form:
 *   (β / tan θ)² = (K λ / D) · β / (tan θ sin θ) + 16 ε²
 * (both axes dimensionless). Slope K λ / D; intercept 16 ε², so ε = √intercept / 4.
 * Halder & Wagner, Acta Cryst. 20 (1966) 312–313, eq. (5): b^P / b = 1 − (b^D / b)², with b,
 * b^P and b^D the integral breadths (total, size, strain) in reciprocal units; that is,
 * β² = β β_D + β_ε² as used here. The angle form above is a rearrangement of it, as written in
 * T. C. Paul, J. Podder and L. Paik, arXiv:2103.03521, eq. (7) (checked against the preprint). Its axes are the
 * SSP axes multiplied by 4 / λ², so an unweighted fit gives exactly the same D and ε as the
 * size–strain plot; Pal (2025, section 6) shows the same equivalence.
 */
export function halderWagner(peaks: readonly SizePeak[], s: SizeSettings): LineResult {
  return lorentzGauss(
    'hw',
    peaks,
    s,
    (p) => {
      const t = theta(p.twoTheta);
      return [p.beta / (Math.tan(t) * Math.sin(t)), (p.beta / Math.tan(t)) ** 2];
    },
    (c) => Math.sqrt(c) / 4,
  );
}

function unavailable(method: LineMethod, reason: string): LineResult {
  return {
    method,
    points: [],
    fit: null,
    size: null,
    strain: null,
    messages: [],
    unavailable: reason,
  };
}

// ---------------------------------------------------------------- derived quantities

/**
 * Dislocation density δ = 1 / D² (lines crossing unit area, m⁻², D converted from nm to m),
 * with σ(δ) = 2 δ σ(D) / D. This is the usual estimate in the literature, not the formula of
 * Williamson & Smallman, Phil. Mag. 1 (1956) 34–46. Their eq. (1) is ρ = 3n / D² for the total
 * dislocation line length per unit volume, with n ≥ 1 dislocations per block face (n = 1 gives
 * a minimum). They note that counting lines crossing unit area gives n / D² instead, a third of
 * theirs; 1 / D² is that count with n = 1.
 */
export function dislocationDensity(size: Estimate): Estimate {
  if (!(size.value > 0)) return NOT_PHYSICAL;
  const value = 1 / (size.value * 1e-9) ** 2;
  return { value, sigma: (2 * value * size.sigma) / size.value };
}

/**
 * Specific surface area of dense, separate spheres of diameter D: S = 6 / (ρ D).
 * With ρ in g/cm³ and D in nm, S = 6000 / (ρ D) in m²/g. σ(S) = S σ(D) / D.
 */
export function specificSurfaceArea(size: Estimate, densityGcm3: number): Estimate {
  if (!(size.value > 0) || !(densityGcm3 > 0)) return NOT_PHYSICAL;
  const value = 6000 / (densityGcm3 * size.value);
  return { value, sigma: (value * size.sigma) / size.value };
}
