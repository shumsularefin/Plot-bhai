/*
 * Calculated powder pattern for whole-pattern (Rietveld) refinement, Bragg–Brentano geometry.
 *
 *   y_calc(2θ_i) = b(2θ_i) + Σ_phases S Σ_k Σ_λ r_λ · M|F|²_k · LP(θ_k) · P_k · exp(−B / (2 d_k²))
 *                                  · Ω(2θ_i − 2θ_k,λ)
 *
 * - b: background, Chebyshev polynomial Σ_n b_n T_n(t) with t = 2·(2θ − 2θ_min)/(2θ_max − 2θ_min) − 1.
 * - S: phase scale factor (dimensionless, absorbs the incident intensity and the volume fraction).
 * - M|F|²_k: Σ|F|² of reflection family k from the reference structure (electron units²).
 * - LP(θ) = (1 + cos²2θ)/(sin²θ cosθ): Lorentz-polarisation factor with no monochromator.
 * - P_k: March–Dollase preferred orientation, mean over the family's reflections of
 *   (r² cos²α + sin²α / r)^(−3/2), α the angle between the reflection's normal and the preferred
 *   direction (also given as a plane normal h k l); r = 1 is a random powder (P = 1).
 * - exp(−B/(2d²)) = exp(−2B sin²θ/λ²): an overall displacement factor B (Å²) applied on top of
 *   the displacement parameters already in the reference structure.
 * - r_λ: relative intensity of the Kα1 line (1) and the Kα2 line (the Kα2/Kα1 ratio, or none
 *   with a monochromator); each line has its own Bragg angle from λ = 2d sinθ.
 * - Peak position: 2θ_k,λ = 2·asin(λ/2d)·180/π + Z + D·cosθ (degrees): Z is the zero shift (the
 *   measured 2θ minus the true one, as in the Clean data step) and D the sample displacement
 *   coefficient (for a sample surface a distance s above the focusing circle of radius R,
 *   D = −(360/π)·s/R degrees).
 * - Ω: pseudo-Voigt of unit area, Ω = η·L + (1 − η)·G, with full width at half maximum H from the
 *   Caglioti relation H² = U tan²θ + V tanθ + W (H in degrees 2θ, U, V, W in deg²). η is the
 *   Lorentzian fraction (0 to 1). Ω is cut off at ±25 H (the Lorentzian tails beyond hold about
 *   1.3 % of its area).
 *
 * Peak asymmetry, anisotropic broadening, absorption and surface roughness are not modelled.
 */

import { dSpacing, lorentzPolarisation, reciprocalMetric, type Cell } from '../reference/powder';
import { cellFromParameters, cellParameterNames, type CellKind } from './cell';
import type { Hkl, RefinementReflection } from './reflections';

export interface PhaseModel {
  id: string;
  name: string;
  kind: CellKind;
  /** Reference cell (also supplies the fixed cell parameters). */
  cell: Cell;
  reflections: RefinementReflection[];
  /** Preferred-orientation direction as a plane normal (h k l), or null for none. */
  orientation: Hkl | null;
}

export interface Wavelengths {
  /** Kα1 wavelength, Å. */
  kAlpha1: number;
  /** Kα2 wavelength, Å. */
  kAlpha2: number;
  /** Kα2/Kα1 intensity ratio; 0 when a monochromator removed Kα2. */
  ratio: number;
}

/** Where each parameter sits in the parameter vector. */
export interface Layout {
  zero: number;
  displacement: number;
  /** Background coefficients b_0 … b_(n−1). */
  background: number[];
  phases: PhaseLayout[];
  size: number;
}

export interface PhaseLayout {
  scale: number;
  /** In the order of cellParameterNames(kind). */
  cell: number[];
  u: number;
  v: number;
  w: number;
  eta: number;
  orientation: number;
  b: number;
}

export function makeLayout(phases: readonly PhaseModel[], backgroundTerms: number): Layout {
  let next = 0;
  const take = () => next++;
  const zero = take();
  const displacement = take();
  const background = Array.from({ length: backgroundTerms }, take);
  const phaseLayouts = phases.map((phase) => ({
    scale: take(),
    cell: cellParameterNames(phase.kind).map(take),
    u: take(),
    v: take(),
    w: take(),
    eta: take(),
    orientation: take(),
    b: take(),
  }));
  return { zero, displacement, background, phases: phaseLayouts, size: next };
}

const SQRT_LN2_PI = Math.sqrt(Math.LN2 / Math.PI);
const CUT_OFF = 25;
const RAD = Math.PI / 180;

/** Chebyshev polynomials T_0 … T_(n−1) at every point (row-major, n per point). */
export function chebyshevBasis(x: Float64Array, terms: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n * terms);
  const lo = x[0] as number;
  const hi = x[n - 1] as number;
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    const t = (2 * ((x[i] as number) - lo)) / span - 1;
    let previous = 1;
    let current = t;
    for (let j = 0; j < terms; j++) {
      if (j === 0) out[i * terms] = 1;
      else if (j === 1) out[i * terms + 1] = t;
      else {
        const value = 2 * t * current - previous;
        previous = current;
        current = value;
        out[i * terms + j] = value;
      }
    }
  }
  return out;
}

/** First index with x[i] ≥ value (x ascending). */
function lowerBound(x: Float64Array, value: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((x[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** March–Dollase factor of one family: mean of (r² cos²α + sin²α / r)^(−3/2) over its members. */
function marchDollase(
  gStar: readonly number[],
  members: readonly Hkl[],
  direction: Hkl,
  r: number,
): number {
  const dot = (p: Hkl, q: Hkl) => {
    let s = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        s += (p[i] as number) * (gStar[i * 3 + j] as number) * (q[j] as number);
    return s;
  };
  const dd = dot(direction, direction);
  let sum = 0;
  for (const m of members) {
    const cos2 = dot(m, direction) ** 2 / (dot(m, m) * dd);
    sum += (r * r * cos2 + (1 - cos2) / r) ** -1.5;
  }
  return sum / members.length;
}

/** One reflection's peak for one wavelength, as placed by the current parameters. */
export interface PlacedPeak {
  phase: number;
  reflection: number;
  /** Peak position, degrees 2θ. */
  twoTheta: number;
  /** Integrated intensity (counts × degrees). */
  area: number;
  fwhm: number;
  eta: number;
  /** 0 for Kα1, 1 for Kα2. */
  line: 0 | 1;
}

/** The cell of a phase for parameter vector p. */
export function phaseCell(phase: PhaseModel, layout: PhaseLayout, p: Float64Array): Cell {
  return cellFromParameters(
    phase.kind,
    layout.cell.map((j) => p[j] as number),
    phase.cell,
  );
}

/** Every peak of a phase for parameters p, within [lo, hi] degrees 2θ (with a margin). */
export function placePeaks(
  phases: readonly PhaseModel[],
  layout: Layout,
  index: number,
  p: Float64Array,
  wavelengths: Wavelengths,
): PlacedPeak[] {
  const phase = phases[index] as PhaseModel;
  const pl = layout.phases[index] as PhaseLayout;
  const gStar = reciprocalMetric(phaseCell(phase, pl, p));
  const zero = p[layout.zero] as number;
  const displacement = p[layout.displacement] as number;
  const scale = p[pl.scale] as number;
  const u = p[pl.u] as number;
  const v = p[pl.v] as number;
  const w = p[pl.w] as number;
  const eta = Math.min(1, Math.max(0, p[pl.eta] as number));
  const r = p[pl.orientation] as number;
  const b = p[pl.b] as number;
  const lines: [number, number][] = [[wavelengths.kAlpha1, 1]];
  if (wavelengths.ratio > 0) lines.push([wavelengths.kAlpha2, wavelengths.ratio]);
  const out: PlacedPeak[] = [];
  phase.reflections.forEach((reflection, k) => {
    const [h, kk, l] = reflection.hkl;
    const d = dSpacing(gStar, h, kk, l);
    const orientation =
      phase.orientation && r !== 1
        ? marchDollase(gStar, reflection.members, phase.orientation, r)
        : 1;
    const common = scale * reflection.mf2 * orientation * Math.exp(-b / (2 * d * d));
    lines.forEach(([lambda, weight], line) => {
      const s = lambda / (2 * d);
      if (!(s < 1)) return;
      const theta = Math.asin(s);
      const tan = Math.tan(theta);
      const h2 = u * tan * tan + v * tan + w;
      out.push({
        phase: index,
        reflection: k,
        twoTheta: (2 * theta) / RAD + zero + displacement * Math.cos(theta),
        area: common * weight * lorentzPolarisation(theta),
        fwhm: Math.sqrt(Math.max(h2, 1e-8)),
        eta,
        line: line as 0 | 1,
      });
    });
  });
  return out;
}

/** Adds the profiles of the peaks to `out` (same length as x). */
export function addProfiles(
  x: Float64Array,
  peaks: readonly PlacedPeak[],
  out: Float64Array,
): void {
  for (const peak of peaks) {
    const hw = CUT_OFF * peak.fwhm;
    const start = lowerBound(x, peak.twoTheta - hw);
    const end = lowerBound(x, peak.twoTheta + hw);
    const inv = 1 / peak.fwhm;
    const gNorm = 2 * SQRT_LN2_PI * inv;
    const lNorm = (2 / Math.PI) * inv;
    for (let i = start; i < end; i++) {
      const t = ((x[i] as number) - peak.twoTheta) * inv;
      const t2 = 4 * t * t;
      out[i] =
        (out[i] as number) +
        peak.area *
          ((peak.eta * lNorm) / (1 + t2) + (1 - peak.eta) * gNorm * Math.exp(-Math.LN2 * t2));
    }
  }
}

/** Background at every point for parameters p. */
export function backgroundCurve(
  basis: Float64Array,
  layout: Layout,
  p: Float64Array,
  n: number,
): Float64Array {
  const terms = layout.background.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < terms; j++)
      s += (basis[i * terms + j] as number) * (p[layout.background[j] as number] as number);
    out[i] = s;
  }
  return out;
}

/** Calculated pattern of one phase (no background). */
export function phaseCurve(
  x: Float64Array,
  phases: readonly PhaseModel[],
  layout: Layout,
  index: number,
  p: Float64Array,
  wavelengths: Wavelengths,
): Float64Array {
  const out = new Float64Array(x.length);
  addProfiles(x, placePeaks(phases, layout, index, p, wavelengths), out);
  return out;
}
