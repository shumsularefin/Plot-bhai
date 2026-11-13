/*
 * Calculated powder pattern for whole-pattern (Rietveld) refinement, Bragg–Brentano geometry.
 *
 *   y_calc(2θ_i) = b(2θ_i) + Σ_phases S Σ_k Σ_λ r_λ · M|F|²_k · LP(θ_k) · P_k · exp(−B / (2 d_k²))
 *                                  · Ω(2θ_i − 2θ_k,λ)
 *
 * - b: background, Chebyshev polynomial Σ_n b_n T_n(t) with t = 2·(2θ − 2θ_min)/(2θ_max − 2θ_min) − 1.
 * - S: phase scale factor (dimensionless, absorbs the incident intensity and the volume fraction).
 * - M|F|²_k: Σ|F|² of reflection family k from the reference structure (electron units²), or
 *   calculated from the refined atoms when the structure is refined (structure.ts).
 * - LP(θ) = 2[P + (1 − P) cos²2θ]/(sin²θ cosθ): Lorentz-polarisation factor, P the polarisation
 *   coefficient of GSAS-II (0.5, the default, is no monochromator: LP = (1 + cos²2θ)/(sin²θ cosθ);
 *   sample.ts gives P for a monochromator).
 * - All angle-dependent intensity factors are taken at each line's own Bragg angle. GSAS-II takes
 *   them at the Kα1 angle for both lines (Wavelengths.correctionsAtKAlpha1 reproduces that); the
 *   difference moved a refined roughness B by 0.6 % in the GSAS-II check.
 * - SR(θ): Suortti surface roughness (sample.ts), 1 unless refined; V(θ) = sin θ when the data were
 *   measured with an automatic (variable) divergence slit, otherwise 1 (sample.ts).
 * - P_k: March–Dollase preferred orientation, mean over the family's reflections of
 *   (r² cos²α + sin²α / r)^(−3/2), α the angle between the reflection's normal and the preferred
 *   direction (also given as a plane normal h k l); r = 1 is a random powder (P = 1).
 * - exp(−B/(2d²)) = exp(−2B sin²θ/λ²): an overall displacement factor B (Å²) applied on top of
 *   the displacement parameters already in the reference structure.
 * - r_λ: relative intensity of the Kα1 line (1) and the Kα2 line (the Kα2/Kα1 ratio, or none
 *   with a monochromator); each line has its own Bragg angle from λ = 2d sinθ.
 * - Peak position: 2θ_k,λ = 2·asin(λ/2d)·180/π + Z + D·cosθ + T·sin2θ (degrees): Z is the zero
 *   shift (the measured 2θ minus the true one, as in the Clean data step), D the sample
 *   displacement coefficient (for a sample surface a distance s above the focusing circle of
 *   radius R, D = −(360/π)·s/R degrees) and T the sample transparency (sample.ts).
 * - Ω: pseudo-Voigt of unit area, Ω = η·L + (1 − η)·G, with full width at half maximum H from the
 *   Caglioti relation H² = U tan²θ + V tanθ + W (H in degrees 2θ, U, V, W in deg²). η is the
 *   Lorentzian fraction (0 to 1). Ω is computed from 50 F below to 75 F above the peak (reversed
 *   above 2θ = 90°), F = H_G + H_L with the TCH profile and F = H otherwise, as in GSAS-II
 *   (GSASIIpwd.getWidthsCW); the Lorentzian tails beyond hold about 0.5 % of its area. A shorter
 *   window biases the size and strain of Lorentzian peaks by about 1 % (found in the GSAS-II check).
 * - TCH profile (optional, GSAS-II's peak shape): the Gaussian width follows the Caglioti relation
 *   above, H_G² = U tan²θ + V tanθ + W, the Lorentzian width H_L = X/cosθ + Y tanθ (degrees), and
 *   H and η come from the Thompson–Cox–Hastings formulas (tch.ts) instead of a refined η.
 * - Sample broadening (optional, always with the TCH profile): crystallite size and microstrain
 *   add to H_L and H_G² as in GSAS-II (sample.ts), so U, V, W, X, Y can stay those of the
 *   instrument (for example fixed from a standard) while size and strain are refined per phase.
 * - Le Bail mode (optional, per phase): M|F|²_k are not calculated from a structure but extracted
 *   from the data (refine.ts), so only the cell and the profile are fitted.
 * - Peak asymmetry (optional, off unless refined): Ω is multiplied by the Bérar–Baldinozzi
 *   correction (J.-F. Bérar and G. Baldinozzi, J. Appl. Cryst. 26 (1993) 128–129), in the form of
 *   the FullProf manual (eq. 3.29) with its 1/tan θ terms:
 *     As(z) = 1 + [P1 Fa(z) + P2 Fb(z)] / tan θ_k,   z = (2θ_i − 2θ_k) / H,
 *     Fa(z) = 2z exp(−z²),   Fb(z) = 2(2z² − 3) Fa(z),
 *   θ_k the Bragg angle of the line. Fa and Fb are odd in z and Ω is even, so the correction moves
 *   intensity from one side of the peak to the other without changing its area. The manual's
 *   further 1/tan 2θ terms (P3, P4) are not used: they matter mainly at high angle, where lab
 *   patterns show little asymmetry.
 *
 * - Anisotropic sample broadening (optional, per phase, broadening.ts): uniaxial crystallite size,
 *   uniaxial microstrain or Stephens' generalized microstrain, as in GSAS-II. The width then
 *   depends on the direction of each reflection, so the reflections of a family that are not
 *   equivalent for it (for example (1 0 0) and (0 1 0) of a hexagonal cell with the size axis
 *   along [1 0 0]) are placed as separate peaks, each with its share of Σ|F|². GSAS-II uses one
 *   representative reflection; the two agree whenever the axis is a symmetry axis of the lattice.
 * - Axial divergence (optional, fcj.ts): the Finger–Cox–Jephcoat profile of GSAS-II with one
 *   parameter SH/L, which replaces the symmetric pseudo-Voigt; its low-angle side (the high-angle
 *   side above 90°) is then computed 50 · SH/L · |cos 2θ| further out, as in GSAS-II.
 *
 * Absorption (other than surface roughness) is not modelled.
 */

import { dSpacing, lorentzPolarisation, reciprocalMetric, type Cell } from '../reference/powder';
import {
  cosAngle,
  stephensNames,
  stephensStrain,
  uniaxialInverseSize,
  uniaxialStrain,
  type LaueClass,
} from './broadening';
import { fcjNodes, type FcjNodes } from './fcj';
import { tchEta, tchFwhm } from './tch';
import {
  polarisation,
  sampleWidths,
  surfaceRoughness,
  transparencyShift,
  variableSlitFactor,
} from './sample';
import { cellFromParameters, cellParameterNames, type CellKind } from './cell';
import type { Hkl, RefinementReflection } from './reflections';
import {
  atomPosition,
  atomTensor,
  rotateTensor,
  structureFactorSquared,
  type AtomState,
  type StructureModel,
} from './structure';

export interface PhaseModel {
  id: string;
  name: string;
  kind: CellKind;
  /** Reference cell (also supplies the fixed cell parameters). */
  cell: Cell;
  reflections: RefinementReflection[];
  /** Preferred-orientation direction as a plane normal (h k l), or null for none. */
  orientation: Hkl | null;
  /** Atoms, when the structure is refined: Σ|F|² is then calculated (structure.ts). */
  structure?: StructureModel;
  /** Thompson–Cox–Hastings profile (GSAS-II) instead of the single-width pseudo-Voigt. */
  tch?: boolean;
  /** Crystallite size and microstrain broadening (sample.ts); uses the TCH profile. */
  sample?: boolean;
  /** Le Bail mode: Σ|F|² of each reflection as extracted from the data (refine.ts). */
  leBail?: Float64Array;
  /** Laue class of the generalized microstrain terms (broadening.ts); needed for that model. */
  laue?: LaueClass;
  /** Crystallite-size model (isotropic unless given) and its axis as a plane normal. */
  sizeModel?: 'isotropic' | 'uniaxial';
  sizeAxis?: Hkl;
  /** Microstrain model (isotropic unless given) and the axis of the uniaxial one. */
  strainModel?: 'isotropic' | 'uniaxial' | 'generalized';
  strainAxis?: Hkl;
}

export interface Wavelengths {
  /** Kα1 wavelength, Å. */
  kAlpha1: number;
  /** Kα2 wavelength, Å. */
  kAlpha2: number;
  /** Kα2/Kα1 intensity ratio; 0 when a monochromator removed Kα2. */
  ratio: number;
  /** GSAS-II polarisation coefficient P (sample.ts); missing means 0.5, no monochromator. */
  polarisation?: number;
  /** Data measured with an automatic (variable) divergence slit (sample.ts). */
  variableSlit?: boolean;
  /**
   * Evaluate LP, polarisation, roughness and slit factors at the Kα1 angle for both lines, as
   * GSAS-II does (GetIntensityCorr uses the Kα1 position), instead of at each line's own angle.
   * Only for reproducing GSAS-II exactly in the validation; the default is the exact form.
   */
  correctionsAtKAlpha1?: boolean;
}

/** Where each parameter sits in the parameter vector. */
export interface Layout {
  zero: number;
  displacement: number;
  /** Sample transparency T (degrees). */
  transparency: number;
  /** Suortti surface roughness A and B. */
  roughness: [number, number];
  /** Axial divergence SH/L (fcj.ts); 0 is a symmetric profile. */
  axial: number;
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
  /** TCH Lorentzian widths X, Y (degrees), used only with the TCH profile. */
  lx: number;
  ly: number;
  orientation: number;
  b: number;
  /** Bérar–Baldinozzi asymmetry P1 and P2. */
  asymmetry: [number, number];
  /**
   * Sample broadening: 1/size (nm⁻¹), microstrain (10⁻⁶) and their Lorentzian fractions. With the
   * uniaxial models these are the equatorial values and the axial ones follow; `stephens` holds
   * the generalized microstrain coefficients S_hkl (one per term of the Laue class).
   */
  inverseSize: number;
  inverseSizeAxial: number;
  microstrain: number;
  microstrainAxial: number;
  stephens: number[];
  sizeMix: number;
  strainMix: number;
  /**
   * Per atom of the structure (empty without one): free coordinate coefficients, occupancy, B,
   * U_ij coefficients and the fraction of a substituting element (structure.ts).
   */
  atoms: { coords: number[]; occupancy: number; b: number; aniso: number[]; fraction: number }[];
}

export function makeLayout(phases: readonly PhaseModel[], backgroundTerms: number): Layout {
  let next = 0;
  const take = () => next++;
  const zero = take();
  const displacement = take();
  const transparency = take();
  const roughness: [number, number] = [take(), take()];
  const axial = take();
  const background = Array.from({ length: backgroundTerms }, take);
  const phaseLayouts = phases.map((phase) => ({
    scale: take(),
    cell: cellParameterNames(phase.kind).map(take),
    u: take(),
    v: take(),
    w: take(),
    eta: take(),
    lx: take(),
    ly: take(),
    orientation: take(),
    b: take(),
    asymmetry: [take(), take()] as [number, number],
    inverseSize: take(),
    inverseSizeAxial: take(),
    microstrain: take(),
    microstrainAxial: take(),
    stephens: (phase.laue ? stephensNames(phase.laue) : []).map(take),
    sizeMix: take(),
    strainMix: take(),
    atoms: (phase.structure?.atoms ?? []).map((atom) => ({
      coords: atom.basis.map(take),
      occupancy: take(),
      b: take(),
      aniso: atom.uBasis.map(take),
      fraction: take(),
    })),
  }));
  return {
    zero,
    displacement,
    transparency,
    roughness,
    axial,
    background,
    phases: phaseLayouts,
    size: next,
  };
}

const SQRT_LN2_PI = Math.sqrt(Math.LN2 / Math.PI);
/** Profile window in units of F (see the header): low-angle and high-angle side. */
const REACH_LOW = 50;
const REACH_HIGH = 75;
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
  /** Coefficients of Fa(z) and Fb(z) in the asymmetry correction: P1 / tan θ and P2 / tan θ. */
  asymmetry: [number, number];
  /** 0 for Kα1, 1 for Kα2. */
  line: 0 | 1;
  /** d-spacing (Å) and Σ|F|² of the reflection family. */
  d: number;
  mf2: number;
  /** Width F (degrees) that sets the profile window (see the header); missing means fwhm. */
  reach?: number;
  /** Axial-divergence profile (fcj.ts) and how much further its asymmetric side reaches. */
  fcj?: FcjNodes;
  fcjReach?: number;
}

/** First and last 2θ (degrees) at which a peak's profile is computed. */
function peakRange(peak: PlacedPeak): [number, number] {
  const f = peak.reach ?? peak.fwhm;
  const extra = peak.fcjReach ?? 0;
  // A pure Gaussian is below 10⁻³⁰ of its height beyond 8 H.
  if (peak.eta === 0 && !peak.fcj)
    return [peak.twoTheta - 8 * peak.fwhm, peak.twoTheta + 8 * peak.fwhm];
  return peak.twoTheta > 90
    ? [peak.twoTheta - REACH_HIGH * f, peak.twoTheta + REACH_LOW * (f + extra)]
    : [peak.twoTheta - REACH_LOW * (f + extra), peak.twoTheta + REACH_HIGH * f];
}

/** Bérar–Baldinozzi correction As(z) = 1 + a·Fa(z) + b·Fb(z), Fa = 2z e^(−z²), Fb = 2(2z² − 3) Fa. */
export function asymmetryFactor(z: number, a: number, b: number): number {
  const fa = 2 * z * Math.exp(-z * z);
  return 1 + a * fa + b * 2 * (2 * z * z - 3) * fa;
}

/** The cell of a phase for parameter vector p. */
export function phaseCell(phase: PhaseModel, layout: PhaseLayout, p: Float64Array): Cell {
  return cellFromParameters(
    phase.kind,
    layout.cell.map((j) => p[j] as number),
    phase.cell,
  );
}

/** Positions, occupancies and B of a phase's atoms for parameter vector p. */
export function atomStates(phase: PhaseModel, layout: PhaseLayout, p: Float64Array): AtomState[] {
  return (phase.structure?.atoms ?? []).map((atom, a) => {
    const al = layout.atoms[a] as PhaseLayout['atoms'][number];
    const u = atomTensor(
      atom,
      al.aniso.map((j) => p[j] as number),
    );
    return {
      x: atomPosition(
        atom,
        al.coords.map((j) => p[j] as number),
      ),
      occupancy: p[al.occupancy] as number,
      b: p[al.b] as number,
      fraction: p[al.fraction] as number,
      ...(u && { uImages: atom.images.map((image) => rotateTensor(image.op.rot, u)) }),
    };
  });
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
  const transparency = p[layout.transparency] as number;
  const roughA = p[layout.roughness[0]] as number;
  const roughB = p[layout.roughness[1]] as number;
  const rough = roughA !== 1 && roughB !== 0;
  const pola = wavelengths.polarisation ?? 0.5;
  const scale = p[pl.scale] as number;
  const u = p[pl.u] as number;
  const v = p[pl.v] as number;
  const w = p[pl.w] as number;
  const eta = Math.min(1, Math.max(0, p[pl.eta] as number));
  const lx = p[pl.lx] as number;
  const ly = p[pl.ly] as number;
  const r = p[pl.orientation] as number;
  const b = p[pl.b] as number;
  const p1 = p[pl.asymmetry[0]] as number;
  const p2 = p[pl.asymmetry[1]] as number;
  const inverseSize = p[pl.inverseSize] as number;
  const inverseSizeAxial = p[pl.inverseSizeAxial] as number;
  const microstrain = p[pl.microstrain] as number;
  const microstrainAxial = p[pl.microstrainAxial] as number;
  const stephens = pl.stephens.map((j) => p[j] as number);
  const sizeMix = p[pl.sizeMix] as number;
  const strainMix = p[pl.strainMix] as number;
  const shl = Math.max(0, p[layout.axial] as number);
  const tch = phase.tch === true || phase.sample === true;
  const sizeAxis = phase.sample && phase.sizeModel === 'uniaxial' ? phase.sizeAxis : undefined;
  const strainModel = phase.sample ? (phase.strainModel ?? 'isotropic') : 'isotropic';
  const strainAxis = strainModel === 'uniaxial' ? phase.strainAxis : undefined;
  const laue = phase.laue;
  const anisotropic =
    sizeAxis !== undefined ||
    strainAxis !== undefined ||
    (strainModel === 'generalized' && laue !== undefined);
  /** Inverse size and microstrain of one reflection (h k l) of spacing d (broadening.ts). */
  const sampleOf = (hkl: Hkl, d: number): [number, number] => [
    sizeAxis
      ? uniaxialInverseSize(inverseSize, inverseSizeAxial, cosAngle(gStar, hkl, sizeAxis))
      : inverseSize,
    strainAxis
      ? uniaxialStrain(microstrain, microstrainAxial, cosAngle(gStar, hkl, strainAxis))
      : strainModel === 'generalized' && laue
        ? stephensStrain(laue, stephens, hkl, d)
        : microstrain,
  ];
  const lines: [number, number][] = [[wavelengths.kAlpha1, 1]];
  if (wavelengths.ratio > 0) lines.push([wavelengths.kAlpha2, wavelengths.ratio]);
  const out: PlacedPeak[] = [];
  const structure = phase.structure;
  const states = structure ? atomStates(phase, pl, p) : [];
  phase.reflections.forEach((reflection, k) => {
    const [h, kk, l] = reflection.hkl;
    const d = dSpacing(gStar, h, kk, l);
    const mf2 = phase.leBail
      ? (phase.leBail[k] as number)
      : structure
        ? reflection.members.reduce(
            (sum, m) => sum + structureFactorSquared(structure, states, m, d),
            0,
          )
        : reflection.mf2;
    const orientation =
      phase.orientation && r !== 1
        ? marchDollase(gStar, reflection.members, phase.orientation, r)
        : 1;
    const common = scale * mf2 * orientation * Math.exp(-b / (2 * d * d));
    // Reflections of the family with the same sample broadening share a peak (see the header).
    const groups: { share: number; sample: [number, number] }[] = [];
    if (anisotropic) {
      const byWidth = new Map<string, { share: number; sample: [number, number] }>();
      const share = 1 / reflection.members.length;
      for (const member of reflection.members) {
        const sample = sampleOf(member, d);
        const key = `${sample[0].toPrecision(12)}:${sample[1].toPrecision(12)}`;
        const group = byWidth.get(key);
        if (group) group.share += share;
        else byWidth.set(key, { share, sample });
      }
      groups.push(...byWidth.values());
    } else groups.push({ share: 1, sample: [inverseSize, microstrain] });
    for (const group of groups)
      lines.forEach(([lambda, weight], line) => {
        const s = lambda / (2 * d);
        if (!(s < 1)) return;
        const theta = Math.asin(s);
        const tan = Math.tan(theta);
        const h2 = u * tan * tan + v * tan + w;
        let fwhm = Math.sqrt(Math.max(h2, 1e-8));
        let mix = eta;
        let reach = fwhm;
        let lorentzian = 0;
        if (tch) {
          let hl = Math.max(0, lx / Math.cos(theta) + ly * tan);
          let hg2 = Math.max(h2, 1e-8);
          if (phase.sample) {
            const [size, strain] = group.sample;
            const extra = sampleWidths(size, strain, sizeMix, strainMix, lambda, theta);
            hl += extra.lorentzian;
            hg2 += extra.gaussian2;
          }
          fwhm = tchFwhm(Math.sqrt(hg2), hl);
          mix = tchEta(hl / fwhm);
          reach = Math.sqrt(hg2) + hl;
          lorentzian = hl;
        }
        const at = wavelengths.correctionsAtKAlpha1
          ? Math.asin(wavelengths.kAlpha1 / (2 * d))
          : theta;
        let factor = weight * lorentzPolarisation(at);
        if (pola !== 0.5) factor *= polarisation(pola, at) / (1 + Math.cos(2 * at) ** 2);
        if (rough) factor *= surfaceRoughness(roughA, roughB, at);
        if (wavelengths.variableSlit) factor *= variableSlitFactor(at);
        const twoTheta =
          (2 * theta) / RAD +
          zero +
          displacement * Math.cos(theta) +
          transparencyShift(transparency, theta);
        const fcj = shl > 0 ? fcjNodes(twoTheta, shl, tch ? lorentzian : mix * fwhm) : null;
        out.push({
          phase: index,
          reflection: k,
          twoTheta,
          area: common * factor * group.share,
          fwhm,
          eta: mix,
          asymmetry: [p1 / tan, p2 / tan],
          line: line as 0 | 1,
          d,
          mf2,
          reach,
          ...(fcj && { fcj, fcjReach: shl * Math.abs(Math.cos(twoTheta * RAD)) }),
        });
      });
  });
  return out;
}

/** One peak's profile on the points it reaches: values[q] belongs to x[start + q]. */
export function profileWindow(
  x: Float64Array,
  peak: PlacedPeak,
): { start: number; values: Float64Array } {
  const [lo, hi] = peakRange(peak);
  const start = lowerBound(x, lo);
  const end = lowerBound(x, hi);
  const values = new Float64Array(end - start);
  addProfiles(x.subarray(start, end), [peak], values);
  return { start, values };
}

/** Index range [start, end) of the points each peak's profile covers, two entries per peak. */
export function peakWindows(x: Float64Array, peaks: readonly PlacedPeak[]): Int32Array {
  const out = new Int32Array(2 * peaks.length);
  peaks.forEach((peak, q) => {
    const [lo, hi] = peakRange(peak);
    out[2 * q] = lowerBound(x, lo);
    out[2 * q + 1] = lowerBound(x, hi);
  });
  return out;
}

/**
 * Adds the profiles of the peaks to `out` (same length as x). `windows` (from peakWindows) fixes
 * the points each peak covers; finite-difference derivatives pass the windows of the unshifted
 * parameters, because a window edge that crosses a point would add a jump to the derivative.
 */
export function addProfiles(
  x: Float64Array,
  peaks: readonly PlacedPeak[],
  out: Float64Array,
  windows?: Int32Array,
): void {
  const fixed = windows !== undefined && windows.length === 2 * peaks.length;
  peaks.forEach((peak, q) => {
    let start: number;
    let end: number;
    if (fixed) {
      start = windows[2 * q] as number;
      end = windows[2 * q + 1] as number;
    } else {
      const [lo, hi] = peakRange(peak);
      start = lowerBound(x, lo);
      end = lowerBound(x, hi);
    }
    const inv = 1 / peak.fwhm;
    const gNorm = 2 * SQRT_LN2_PI * inv;
    const lNorm = (2 / Math.PI) * inv;
    const [a, b] = peak.asymmetry;
    const asymmetric = a !== 0 || b !== 0;
    const lorentz = peak.eta * lNorm;
    const gaussian = (1 - peak.eta) * gNorm;
    /** Pseudo-Voigt of unit area centred at 0, at u (degrees) from the centre. */
    const voigt = (u: number) => {
      const t2 = 4 * u * u * inv * inv;
      // The Gaussian part is below 10⁻⁴⁰ of its height for t² > 135, so it is skipped there.
      return lorentz / (1 + t2) + (t2 < 135 ? gaussian * Math.exp(-Math.LN2 * t2) : 0);
    };
    const fcj = peak.fcj;
    for (let i = start; i < end; i++) {
      const xi = x[i] as number;
      let shape: number;
      if (fcj) {
        shape = 0;
        const { centres, weights } = fcj;
        for (let j = 0; j < centres.length; j++)
          shape += (weights[j] as number) * voigt(xi - (centres[j] as number));
      } else shape = voigt(xi - peak.twoTheta);
      const value = peak.area * shape;
      const t = (xi - peak.twoTheta) * inv;
      out[i] = (out[i] as number) + (asymmetric ? value * asymmetryFactor(t, a, b) : value);
    }
  });
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
  windows?: Int32Array,
): Float64Array {
  const out = new Float64Array(x.length);
  addProfiles(x, placePeaks(phases, layout, index, p, wavelengths), out, windows);
  return out;
}
