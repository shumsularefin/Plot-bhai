/*
 * Basic Rietveld refinement: the whole calculated pattern (model.ts) is fitted to the measured
 * one by weighted least squares (Levenberg–Marquardt), minimising
 *
 *   Σ_i w_i (y_obs,i − y_calc,i)²   with   w_i = 1 / y_obs,i   (Poisson counting statistics; y < 1
 *                                           counts as 1).
 *
 * Parameters are released in stages, as recommended for a stable refinement (for example
 * L. B. McCusker, R. B. Von Dreele, D. E. Cox, D. Louër and P. Scardi, J. Appl. Cryst. 32 (1999)
 * 36–50): scale factors and background, then zero shift (and sample displacement), then the cell,
 * then the peak widths and shape, then peak asymmetry, then preferred orientation, then an overall
 * displacement factor.
 * Before that the starting width is chosen from a few values, and each phase's cell is lined up
 * by trying small isotropic changes of its lengths (± 1.5 %), because least squares cannot find a
 * peak that starts further away than about its own width.
 *
 * Agreement indices (Young, The Rietveld Method, IUCr/Oxford 1993, chapter 1):
 *   R_p   = Σ|y_obs − y_calc| / Σ y_obs
 *   R_wp  = √( Σ w (y_obs − y_calc)² / Σ w y_obs² )
 *   R_exp = √( (N − P) / Σ w y_obs² )            N points, P refined parameters
 *   χ²    = (R_wp / R_exp)²,  GOF = R_wp / R_exp
 *   R_Bragg = Σ_k |I_obs,k − I_calc,k| / Σ_k I_obs,k, with I_obs,k shared out from the observed
 *            pattern in proportion to each reflection's calculated profile (Rietveld's method).
 *
 * Weight fractions (Hill and Howard, J. Appl. Cryst. 20 (1987) 467–474):
 *   W_p = S_p (Z M V)_p / Σ_i S_i (Z M V)_i
 * with S the scale factor, ZM the mass of the unit cell contents (g/mol) and V the cell volume.
 * They are fractions of the crystalline phases included, with no microabsorption correction.
 *
 * Le Bail mode (A. Le Bail, H. Duroy and J. L. Fourquet, Mat. Res. Bull. 23 (1988) 447–452), per
 * phase: no structure is used. After each least-squares stage the Σ|F|² of every reflection is
 * replaced by the share of the observed intensity that its calculated profile takes (the same
 * partition as for R_Bragg), and this is repeated until R_wp stops falling; only the cell, the
 * profile and the global parameters are refined (the scale factor is fixed, since it multiplies
 * the extracted intensities). Accidentally overlapping reflections keep the ratio they start with.
 * Before the first stage, the intensities are extracted ten times against the flat starting
 * background for each trial peak width, so a phase that starts with equal intensities (a cell
 * from indexing, with every reflection its lattice allows) starts the refinement near the data.
 *
 * Fixed instrument profile (optional): U, V, W, X, Y of the TCH profile are set from a standard
 * (or a GSAS-II .instprm file) and not refined, so the crystallite size and microstrain refined
 * per phase (sample.ts) are the sample's own broadening.
 *
 * Standard uncertainties are √(diagonal of s²(JᵀWJ)⁻¹), s² = Σ w(y_obs − y_calc)² / (N − P). They
 * ignore serial correlation of the residuals and so usually underestimate the real uncertainty
 * (Bérar and Lelann, J. Appl. Cryst. 24 (1991) 1–5).
 */

import { ELEMENT_BY_SYMBOL } from '../../elements';
import { levenbergMarquardt } from '../../math/levenbergMarquardt';
import { reciprocalMetric, type Cell, type FormFactors } from '../reference/powder';
import type { ReferencePeak, StoredStructure } from '../reference/types';
import { cellKind, cellParameterNames, cellVolume } from './cell';
import {
  laueClass,
  stephensFromIsotropic,
  stephensNames,
  stephensStrain,
  stephensSum,
  uniaxialStrain,
  cosAngle,
} from './broadening';
import {
  addProfiles,
  profileWindow,
  peakWindows,
  asymmetryFactor,
  backgroundCurve,
  chebyshevBasis,
  atomStates,
  makeLayout,
  phaseCell,
  phaseCurve,
  placePeaks,
  type Layout,
  type PhaseModel,
  type Wavelengths,
} from './model';
import { fillJacobian } from './derivatives';
import type { StructureGeometry } from '../structure/bonds';
import { refinementReflections, type Hkl } from './reflections';
import {
  MAX_TEXTURE_ORDER,
  textureIndex,
  textureName,
  textureSymmetry,
  textureTerms,
  type TextureLaue,
} from './texture';
import {
  positiveDefinite,
  restraintResiduals,
  structureModel,
  substitutedContents,
  type Dispersion,
  type StructureModel,
  type Substitution,
} from './structure';
import {
  durbinWatson,
  internalStandard,
  strongCorrelations,
  type Correlation,
  type StandardResult,
} from './statistics';

export interface RietveldPhaseInput {
  id: string;
  name: string;
  /** Crystal system as stored with the phase ("cubic", "monoclinic", …, or "unknown"). */
  crystalSystem: string;
  cell: Cell;
  peaks: readonly ReferencePeak[];
  /** Atoms per element in the unit cell, for the weight fraction; missing means not available. */
  cellContents?: Readonly<Record<string, number>>;
  /** Preferred-orientation direction (h k l), or null. */
  orientation: Hkl | null;
  /**
   * Even order (2 to 16) of GSAS-II's spherical-harmonic texture (texture.ts), which then
   * replaces March–Dollase for this phase; missing or 0 means March–Dollase (or none).
   */
  textureOrder?: number;
  /** Symmetry operators and atoms, needed for structure refinement. */
  structure?: StoredStructure;
  /** Le Bail mode: intensities extracted from the data, no structure (see the header). */
  leBail?: boolean;
  /** Dopants placed on sites of the structure (structure.ts); needs the stored structure. */
  substitutions?: Substitution[];
  /** Space-group number, when known: it tells −31m from −3m1 for the Stephens terms. */
  spaceGroupNumber?: number;
  /** Axes (plane normals) of the uniaxial size and microstrain models; [0 0 1] if missing. */
  sizeAxis?: Hkl;
  strainAxis?: Hkl;
}

/** Instrument profile of the TCH shape, degrees 2θ (U, V, W in deg², X, Y in deg). */
export interface InstrumentProfile {
  u: number;
  v: number;
  w: number;
  x: number;
  y: number;
  /** Axial divergence SH/L (fcj.ts); missing means 0, a symmetric profile. */
  shl?: number;
}

/** Which groups of parameters are refined. Scale factors and background always are. */
export interface RefineChoices {
  zero: boolean;
  displacement: boolean;
  cell: boolean;
  /** Caglioti W and the Lorentzian fraction η. */
  width: boolean;
  /** Caglioti U and V (change of width with angle). */
  widthSlope: boolean;
  /** March–Dollase r of every phase that has a preferred direction. */
  orientation: boolean;
  /** Overall displacement factor B of every phase. */
  overallB: boolean;
  /** Bérar–Baldinozzi peak asymmetry P1, P2 of every phase (see model.ts). */
  asymmetry: boolean;
  /** Thompson–Cox–Hastings profile (GSAS-II's) instead of one width and a refined η. */
  tch?: boolean;
  /** Structure refinement (Advanced): free atom coordinates. */
  positions?: boolean;
  /** Structure refinement: site occupancies. */
  occupancy?: boolean;
  /** Structure refinement: isotropic displacement B of each isotropic atom. */
  biso?: boolean;
  /** Structure refinement: anisotropic U_ij of every atom (isotropic ones are converted). */
  aniso?: boolean;
  /** Bond-length restraints to the starting structure while positions are refined. */
  restraints?: boolean;
  /** Sample transparency T (Δ2θ = T sin 2θ), for weakly absorbing samples. */
  transparency?: boolean;
  /** Suortti surface roughness A and B (sample.ts). */
  roughness?: boolean;
  /** Crystallite size of every phase (sample broadening, uses the TCH profile). */
  size?: boolean;
  /** Microstrain of every phase (sample broadening, uses the TCH profile). */
  strain?: boolean;
  /** Lorentzian fractions of the size and strain broadening (otherwise 1, as in GSAS-II). */
  sampleMix?: boolean;
  /** Crystallite-size model with `size` (broadening.ts); isotropic if missing. */
  sizeModel?: 'isotropic' | 'uniaxial';
  /** Microstrain model with `strain` (broadening.ts); isotropic if missing. */
  strainModel?: 'isotropic' | 'uniaxial' | 'generalized';
  /** Axial divergence SH/L (Finger–Cox–Jephcoat asymmetry, fcj.ts), when no instrument is fixed. */
  axialDivergence?: boolean;
  /** Capillary absorption μR (sample.ts), in capillary geometry only; otherwise fixed. */
  absorption?: boolean;
}

export const DEFAULT_CHOICES: RefineChoices = {
  zero: true,
  displacement: false,
  cell: true,
  width: true,
  widthSlope: true,
  orientation: false,
  overallB: false,
  asymmetry: false,
};

export interface RietveldInput {
  /** 2θ in degrees, ascending. */
  x: Float64Array;
  /** Measured intensity, counts. */
  y: Float64Array;
  wavelengths: Wavelengths;
  phases: RietveldPhaseInput[];
  choices: RefineChoices;
  /** Number of Chebyshev background terms (2 to 12). */
  backgroundTerms: number;
  /** Atomic weights (g/mol) by element symbol. */
  atomicWeights: Readonly<Record<string, number>>;
  /** Scattering factors and covalent radii (Å), needed only for structure refinement. */
  factors?: FormFactors;
  radii?: Readonly<Record<string, number>>;
  /** Fixed instrument profile (TCH); when given, U, V, W, X, Y are not refined. */
  instrument?: InstrumentProfile;
  /** 2θ ranges (degrees) left out of the refinement, for example a sample-holder peak. */
  excluded?: readonly (readonly [number, number])[];
  /** Internal standard for the amorphous content: phase id and its weighed fraction (0 to 1). */
  standard?: { phaseId: string; fraction: number };
  /**
   * Anomalous dispersion f′, f″ of each element for the wavelength of the data (structure.ts).
   * When given, Σ|F|² of every phase with stored atoms is calculated with it.
   */
  dispersion?: Dispersion;
  /** Starting (or fixed) capillary μR, with wavelengths.capillary; 0 if missing. */
  muR?: number;
}

export interface AtomResult {
  label: string;
  element: string;
  /** Fractional coordinates; refined only along the directions the site symmetry leaves free. */
  x: [Estimate, Estimate, Estimate];
  occupancy: Estimate;
  /** Isotropic B (Å²); NaN value for anisotropic atoms. */
  b: Estimate;
  /** Anisotropic U (CIF U11, U22, U33, U12, U13, U23; Å²), or null for isotropic atoms. */
  u: Estimate[] | null;
  /** False when the refined anisotropic U is not positive definite (physically impossible). */
  positiveDefinite: boolean;
  /** The substituting element on this site and its fraction x, or null. */
  substitute: { element: string; fraction: Estimate } | null;
}

export interface Estimate {
  value: number;
  /** Standard uncertainty; NaN when not available, 0 when the parameter was fixed. */
  esd: number;
  refined: boolean;
}

export interface RietveldPhaseResult {
  id: string;
  name: string;
  cell: Record<keyof Cell, Estimate>;
  /** Cell volume, Å³. */
  volume: Estimate;
  scale: Estimate;
  /** Weight fraction (0 to 1) among the phases refined, or null when a cell mass is missing. */
  weightFraction: Estimate | null;
  u: Estimate;
  v: Estimate;
  w: Estimate;
  /** η of the pseudo-Voigt; NaN with the TCH profile, where η follows from X, Y and U, V, W. */
  eta: Estimate;
  /** TCH Lorentzian X, Y (degrees); 0 and fixed without the TCH profile. */
  x: Estimate;
  y: Estimate;
  /** True when the TCH profile was used (then U, V, W are the Gaussian widths). */
  tch: boolean;
  /** March–Dollase r, or null when the phase has no preferred direction. */
  orientation: Estimate | null;
  orientationDirection: Hkl | null;
  /** Spherical-harmonic texture, when that model was used (texture.ts). */
  texture: TextureResult | null;
  overallB: Estimate;
  /** Bérar–Baldinozzi P1 and P2 (0 and fixed unless asymmetry was refined). */
  asymmetry: [Estimate, Estimate];
  rBragg: number;
  /** Refined atoms when the structure was refined, otherwise null. */
  atoms: AtomResult[] | null;
  /**
   * The structure at the end of the refinement with the covariance of its cell and coordinates,
   * for bond lengths and angles with uncertainties (structure/bonds.ts); null without atoms or in
   * Le Bail mode. Parameters that were not refined have zero rows.
   */
  geometry: StructureGeometry | null;
  /** True when the phase was fitted in Le Bail mode (no structure; R_Bragg not meaningful). */
  leBail: boolean;
  /** Crystallite size (nm) and microstrain (10⁻⁶, GSAS-II definition), or null when not refined. */
  size: Estimate | null;
  microstrain: Estimate | null;
  /** Lorentzian fractions of the size and strain broadening. */
  sizeMix: Estimate;
  strainMix: Estimate;
  /**
   * Anisotropic broadening (broadening.ts). Uniaxial: `size` and `microstrain` above are the
   * equatorial values (across the axis), these the axial ones (along it). Generalized: the
   * Stephens coefficients S_hkl in GSAS-II's units, and the range of μ_hkl over the reflections in
   * the data range (`microstrain` is then null).
   */
  sizeModel: 'isotropic' | 'uniaxial';
  sizeAxis: Hkl | null;
  sizeAxial: Estimate | null;
  strainModel: 'isotropic' | 'uniaxial' | 'generalized';
  strainAxis: Hkl | null;
  microstrainAxial: Estimate | null;
  stephens: { name: string; value: Estimate }[] | null;
  strainRange: [number, number] | null;
  /** Reflection list in the data range, with observed (partitioned) and calculated intensities. */
  reflections: ReflectionRow[];
  /** Kα1 positions (degrees 2θ) of the reflections inside the data range, with one (h k l) each. */
  ticks: { twoTheta: number; hkl: Hkl }[];
}

export interface TextureResult {
  order: number;
  /** GSAS-II's Laue class of the phase. */
  laue: TextureLaue;
  /** C(l,n) in GSAS-II's order and naming. */
  coefficients: { name: string; value: Estimate }[];
  /** Texture index J = 1 + Σ C²/(2l+1): 1 for a random powder. */
  index: { value: number; esd: number };
  /** Smallest and largest correction over the reflections in the data range. */
  range: [number, number];
}

export interface ReflectionRow {
  hkl: Hkl;
  /** Number of reflections in the family. */
  multiplicity: number;
  /** d-spacing (Å) and Kα1 position (degrees 2θ) in the refined cell. */
  d: number;
  twoTheta: number;
  /** |F|² per reflection (electron units², Σ|F|² / multiplicity); extracted in Le Bail mode. */
  f2: number;
  /** Integrated intensities (counts × degrees), Kα1 and Kα2 together. */
  iObs: number;
  iCalc: number;
  /** Preferred-orientation factor of the reflection (1 for a random powder). */
  orientation: number;
}

export interface RietveldStats {
  rp: number;
  rwp: number;
  rexp: number;
  chi2: number;
  gof: number;
  points: number;
  parameters: number;
  /** Durbin–Watson d of the weighted residuals (statistics.ts); about 2 is ideal. */
  durbinWatson: number;
}

export interface RietveldResult {
  ok: true;
  x: number[];
  observed: number[];
  calculated: number[];
  background: number[];
  /** Calculated pattern of each phase (without background), in phase order. */
  phaseCurves: number[][];
  zero: Estimate;
  displacement: Estimate;
  transparency: Estimate;
  /** Suortti surface roughness A and B (A = 1, B = 0 and fixed unless refined). */
  roughness: [Estimate, Estimate];
  /** Axial divergence SH/L (0 and fixed unless refined or given by the fixed instrument). */
  axial: Estimate;
  /**
   * Capillary geometry: μR, or null for a flat plate. `displacement` and `transparency` are then
   * the capillary displacements Dx (cos 2θ) and Dy (sin 2θ), degrees (sample.ts).
   */
  absorption: Estimate | null;
  /** True when Σ|F|² included anomalous dispersion; names of phases it could not be applied to. */
  anomalous: boolean;
  anomalousSkipped: string[];
  /** Polarisation coefficient P used (GSAS-II's Polariz.). */
  polarisation: number;
  /** The fixed instrument profile, when one was used. */
  instrument: InstrumentProfile | null;
  /** 2θ ranges left out. */
  excluded: [number, number][];
  phases: RietveldPhaseResult[];
  /** Pairs of refined parameters with |r| ≥ 0.9, strongest first (at most 20). */
  correlations: Correlation[];
  /** Amorphous content from an internal standard, or null. */
  standard: (StandardResult & { phaseId: string; fraction: number }) | null;
  stats: RietveldStats;
  /** R_wp after each stage, to show how the refinement went. */
  stages: { name: string; rwp: number }[];
  converged: boolean;
  /** Plain-language warnings about the data or the result. */
  warnings: string[];
}

export type RietveldOutcome = RietveldResult | { ok: false; error: string };

const TYPICAL_WIDTHS = [0.05, 0.1, 0.2, 0.35];
const LINE_UP_RANGE = 0.015;
const LINE_UP_STEP = 0.0005;

/** Mass of the unit cell contents, g/mol, or null when an element or the contents are missing. */
export function cellMass(
  contents: Readonly<Record<string, number>> | undefined,
  weights: Readonly<Record<string, number>>,
): number | null {
  if (!contents) return null;
  let mass = 0;
  for (const [element, n] of Object.entries(contents)) {
    const weight = weights[element];
    if (weight === undefined) return null;
    mass += n * weight;
  }
  return mass > 0 ? mass : null;
}

/**
 * Hill–Howard weight fractions W_p = S_p a_p / Σ S_i a_i with a = ZMV, and their standard
 * uncertainties from the covariance of the scale factors (row-major, k × k).
 */
export function weightFractions(
  scales: readonly number[],
  massVolume: readonly number[],
  covariance: readonly number[],
): { value: number; esd: number }[] {
  const k = scales.length;
  const total = scales.reduce((s, v, i) => s + v * (massVolume[i] as number), 0);
  return scales.map((sp, p) => {
    const ap = massVolume[p] as number;
    const value = (sp * ap) / total;
    // ∂W_p/∂S_q = (δ_pq a_p T − S_p a_p a_q) / T²
    const grad = massVolume.map(
      (aq, q) => ((p === q ? ap * total : 0) - sp * ap * aq) / total ** 2,
    );
    let variance = 0;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++)
        variance += (grad[i] as number) * (covariance[i * k + j] as number) * (grad[j] as number);
    return { value, esd: Math.sqrt(Math.max(0, variance)) };
  });
}

function percentile(values: Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

/** Runs the refinement. `progress` receives the name of each stage as it starts. */
export function refineRietveld(
  input: RietveldInput,
  progress: (stage: string) => void = () => undefined,
): RietveldOutcome {
  const { wavelengths, choices } = input;
  const excluded = (input.excluded ?? [])
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  const keep: number[] = [];
  input.x.forEach((v, i) => {
    if (Number.isFinite(input.y[i]) && !excluded.some(([a, b]) => v >= a && v <= b)) keep.push(i);
  });
  const x = Float64Array.from(keep, (i) => input.x[i] as number);
  const y = Float64Array.from(keep, (i) => input.y[i] as number);
  const instrument = input.instrument ?? null;
  const sampleBroadening = Boolean(choices.size || choices.strain);
  const sizeModel = choices.size ? (choices.sizeModel ?? 'isotropic') : 'isotropic';
  const strainModel = choices.strain ? (choices.strainModel ?? 'isotropic') : 'isotropic';
  // SH/L is refined when chosen, unless the fixed instrument profile already gives it.
  const refineAxial = Boolean(choices.axialDivergence && !((instrument?.shl ?? 0) > 0));
  const tch = Boolean(choices.tch || instrument || sampleBroadening);
  const n = x.length;
  if (n < 50) return { ok: false, error: 'The pattern has too few points for a refinement.' };
  if (input.phases.length === 0)
    return { ok: false, error: 'Choose at least one phase to refine.' };

  // Reflections that can appear in the data range: d down to λ / (2 sin θ_max), with 1° to spare.
  const thetaMax = (Math.min((x[n - 1] as number) + 1, 179) * Math.PI) / 360;
  const dMin = wavelengths.kAlpha1 / (2 * Math.sin(thetaMax));
  const wantsStructure = Boolean(
    choices.positions || choices.occupancy || choices.biso || choices.aniso,
  );
  const noStructure: string[] = [];
  const anomalousSkipped: string[] = [];
  const textureTooLow: string[] = [];
  const dispersion = input.dispersion;
  let setupError: string | null = null;
  const phases: PhaseModel[] = input.phases.map((phase) => {
    const kind = cellKind(phase.crystalSystem, phase.cell);
    let structure: StructureModel | undefined;
    const substitutions = phase.substitutions ?? [];
    if ((wantsStructure || substitutions.length > 0 || dispersion) && !phase.leBail) {
      try {
        if (!phase.structure || !input.factors) throw new Error('no structure');
        structure = structureModel(
          phase.cell,
          phase.structure,
          input.factors,
          input.radii ?? {},
          wantsStructure && choices.aniso === true,
          substitutions,
          dispersion,
        );
      } catch (e) {
        if (substitutions.length > 0)
          setupError = `The substitution in ${phase.name} cannot be used: ${e instanceof Error ? e.message : 'no atom positions are stored'}.`;
        else if (wantsStructure) noStructure.push(phase.name);
        if (dispersion) anomalousSkipped.push(phase.name);
      }
    }
    const reflections = refinementReflections(phase.peaks, phase.cell, kind, dMin);
    // Spherical-harmonic texture (not in Le Bail mode, where intensities are free anyway).
    const order = phase.leBail ? 0 : Math.min(MAX_TEXTURE_ORDER, phase.textureOrder ?? 0);
    const symmetry = textureSymmetry(kind, phase.spaceGroupNumber);
    const terms = order >= 2 ? textureTerms(symmetry.laue, order) : [];
    if (order >= 2 && terms.length === 0) textureTooLow.push(phase.name);
    const texture = terms.length > 0 ? { symmetry, terms } : undefined;
    return {
      id: phase.id,
      name: phase.name,
      kind,
      cell: phase.cell,
      reflections,
      orientation: phase.orientation,
      ...(texture && { texture }),
      ...(structure && { structure }),
      ...(tch && { tch: true }),
      ...(sampleBroadening && { sample: true }),
      ...(phase.leBail && { leBail: Float64Array.from(reflections, (r) => r.mf2 || 1) }),
      // The anisotropic models start isotropic and are switched on in their own stage.
      ...(strainModel === 'generalized' && {
        laue: laueClass(kind, phase.spaceGroupNumber),
      }),
      sizeAxis: phase.sizeAxis ?? [0, 0, 1],
      strainAxis: phase.strainAxis ?? [0, 0, 1],
    };
  });
  if (setupError) return { ok: false, error: setupError };
  const empty = phases.find((phase) => phase.reflections.length === 0);
  if (empty)
    return { ok: false, error: `${empty.name} has no reflections in the 2θ range of the data.` };

  const terms = Math.min(12, Math.max(2, Math.round(input.backgroundTerms)));
  const layout: Layout = makeLayout(phases, terms);
  const basis = chebyshevBasis(x, terms);
  const sw = y.map((v) => 1 / Math.sqrt(Math.max(v, 1)));
  const target = y.map((v, i) => v * (sw[i] as number));

  // Starting values and bounds.
  const p = new Float64Array(layout.size);
  const lower = new Float64Array(layout.size).fill(-Infinity);
  const upper = new Float64Array(layout.size).fill(Infinity);
  const typical = new Float64Array(layout.size).fill(1);
  const bound = (j: number, lo: number, hi: number, start: number, typ: number) => {
    lower[j] = lo;
    upper[j] = hi;
    p[j] = start;
    typical[j] = typ;
  };
  const yMax = y.reduce((m, v) => Math.max(m, v), 0);
  bound(layout.zero, -1, 1, 0, 0.1);
  bound(layout.displacement, -1, 1, 0, 0.1);
  bound(layout.transparency, -1, 1, 0, 0.01);
  // A = 0, B = 0 is a smooth surface (SR = 1); B is released first, then A (see the stages).
  bound(layout.roughness[0], 0, 1, 0, 0.1);
  bound(layout.roughness[1], 0, 2, 0, 0.01);
  const capillary = wavelengths.capillary === true;
  bound(layout.absorption, 0, 20, capillary ? Math.max(0, input.muR ?? 0) : 0, 0.1);
  bound(
    layout.axial,
    0,
    0.2,
    refineAxial ? instrument?.shl || 0.01 : (instrument?.shl ?? 0),
    0.001,
  );
  layout.background.forEach((j, i) =>
    bound(j, -Infinity, Infinity, i === 0 ? percentile(y, 0.1) : 0, Math.max(yMax, 1) * 1e-3),
  );
  phases.forEach((phase, k) => {
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    bound(pl.scale, 0, Infinity, 1, 1);
    cellParameterNames(phase.kind).forEach((name, i) => {
      const v = phase.cell[name];
      const j = pl.cell[i] as number;
      if (name === 'a' || name === 'b' || name === 'c') bound(j, v * 0.95, v * 1.05, v, v);
      else bound(j, v - 3, v + 3, v, 1);
    });
    bound(pl.u, -1, 2, instrument?.u ?? 0, 0.01);
    bound(pl.v, -2, 2, instrument?.v ?? 0, 0.01);
    bound(pl.w, Math.min(1e-6, instrument?.w ?? 1), 2, instrument?.w ?? 0.01, 0.01);
    bound(pl.eta, 0, 1, 0.5, 0.1);
    bound(pl.lx, 0, 2, instrument?.x ?? (tch && !choices.size ? 0.02 : 0), 0.01);
    bound(pl.ly, -1, 2, instrument?.y ?? 0, 0.01);
    bound(pl.inverseSize, 0, 2, choices.size ? 0.002 : 0, 0.01);
    bound(pl.microstrain, 0, 50000, choices.strain ? 100 : 0, 100);
    bound(pl.inverseSizeAxial, 0, 2, 0, 0.01);
    bound(pl.microstrainAxial, 0, 50000, 0, 100);
    for (const j of pl.stephens) bound(j, -Infinity, Infinity, 0, 1);
    bound(pl.sizeMix, 0, 1, 1, 0.1);
    bound(pl.strainMix, 0, 1, 1, 0.1);
    bound(pl.orientation, 0.3, 3, 1, 1);
    for (const j of pl.texture) bound(j, -Infinity, Infinity, 0, 0.1);
    bound(pl.b, -2, 10, 0, 1);
    for (const j of pl.asymmetry) bound(j, -1, 1, 0, 0.01);
    phase.structure?.atoms.forEach((atom, a) => {
      const al = pl.atoms[a] as (typeof pl.atoms)[number];
      for (const j of al.coords) bound(j, -0.1, 0.1, 0, 0.001);
      bound(al.occupancy, 0, Math.max(1, atom.occupancy0), atom.occupancy0, 0.01);
      bound(al.b, Math.min(0, atom.b0), 20, atom.b0, 0.1);
      for (const j of al.aniso) bound(j, -0.05, 0.05, 0, 0.001);
      bound(al.fraction, 0, 1, atom.substitute?.fraction0 ?? 0, 0.01);
    });
  });

  // Starting scale: the strongest calculated peak matches the strongest measured one.
  const lift = yMax - percentile(y, 0.5);
  phases.forEach((_, k) => {
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    const curve = phaseCurve(x, phases, layout, k, p, wavelengths);
    const peak = curve.reduce((m, v) => Math.max(m, v), 0);
    p[pl.scale] = peak > 0 ? Math.max(lift, 1) / peak / phases.length : 1;
    typical[pl.scale] = p[pl.scale] as number;
  });

  const labels = new Array<string>(layout.size).fill('');
  labels[layout.zero] = 'zero shift';
  labels[layout.displacement] = capillary ? 'capillary displacement Dx' : 'sample displacement';
  labels[layout.transparency] = capillary ? 'capillary displacement Dy' : 'sample transparency';
  labels[layout.absorption] = 'capillary absorption μR';
  labels[layout.roughness[0]] = 'surface roughness A';
  labels[layout.roughness[1]] = 'surface roughness B';
  labels[layout.axial] = 'axial divergence SH/L';
  layout.background.forEach((j, i) => (labels[j] = `background term ${i}`));
  phases.forEach((phase, k) => {
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    labels[pl.scale] = `${phase.name}: scale`;
    cellParameterNames(phase.kind).forEach(
      (name, i) => (labels[pl.cell[i] as number] = `${phase.name}: ${name}`),
    );
    labels[pl.u] = `${phase.name}: U`;
    labels[pl.v] = `${phase.name}: V`;
    labels[pl.w] = `${phase.name}: W`;
    labels[pl.eta] = `${phase.name}: η`;
    labels[pl.lx] = `${phase.name}: X`;
    labels[pl.ly] = `${phase.name}: Y`;
    labels[pl.orientation] = `${phase.name}: March–Dollase r`;
    phase.texture?.terms.forEach(
      (term, i) =>
        (labels[pl.texture[i] as number] = `${phase.name}: texture ${textureName(term)}`),
    );
    labels[pl.b] = `${phase.name}: B`;
    labels[pl.asymmetry[0]] = `${phase.name}: asymmetry P1`;
    labels[pl.asymmetry[1]] = `${phase.name}: asymmetry P2`;
    labels[pl.inverseSize] = `${phase.name}: 1/size`;
    labels[pl.microstrain] = `${phase.name}: microstrain`;
    labels[pl.inverseSizeAxial] = `${phase.name}: 1/size along the axis`;
    labels[pl.microstrainAxial] = `${phase.name}: microstrain along the axis`;
    if (phase.laue)
      stephensNames(phase.laue).forEach(
        (name, i) => (labels[pl.stephens[i] as number] = `${phase.name}: ${name}`),
      );
    labels[pl.sizeMix] = `${phase.name}: size Lorentzian fraction`;
    labels[pl.strainMix] = `${phase.name}: strain Lorentzian fraction`;
    phase.structure?.atoms.forEach((atom, a) => {
      const al = pl.atoms[a] as (typeof pl.atoms)[number];
      al.coords.forEach((j, c) => (labels[j] = `${phase.name}: ${atom.label} position ${c + 1}`));
      labels[al.occupancy] = `${phase.name}: ${atom.label} occupancy`;
      labels[al.b] = `${phase.name}: ${atom.label} B`;
      al.aniso.forEach((j, c) => (labels[j] = `${phase.name}: ${atom.label} U term ${c + 1}`));
      labels[al.fraction] =
        `${phase.name}: ${atom.substitute?.element ?? 'dopant'} fraction on ${atom.label}`;
    });
  });

  const curves = (params: Float64Array, windows?: Int32Array[]) =>
    phases.map((_, k) => phaseCurve(x, phases, layout, k, params, wavelengths, windows?.[k]));
  const phaseOf = new Int32Array(layout.size).fill(-1);
  layout.phases.forEach((pl, k) => {
    for (const j of [
      pl.scale,
      ...pl.cell,
      pl.u,
      pl.v,
      pl.w,
      pl.eta,
      pl.lx,
      pl.ly,
      pl.orientation,
      ...pl.texture,
      pl.b,
      ...pl.asymmetry,
      pl.inverseSize,
      pl.inverseSizeAxial,
      pl.microstrain,
      pl.microstrainAxial,
      ...pl.stephens,
      pl.sizeMix,
      pl.strainMix,
      ...pl.atoms.flatMap((al) => [...al.coords, al.occupancy, al.b, ...al.aniso, al.fraction]),
    ])
      phaseOf[j] = k;
  });
  const backgroundIndex = new Map(layout.background.map((j, i) => [j, i]));

  let free = new Array<boolean>(layout.size).fill(false);
  // Bond restraints: extra rows (d − d₀)/σ after the data, with target 0 (structure.ts).
  const restrained = Boolean(choices.restraints && choices.positions);
  const restraints = (params: Float64Array): number[] =>
    restrained
      ? phases.flatMap((phase, k) => {
          const pl = layout.phases[k] as (typeof layout.phases)[number];
          return phase.structure
            ? restraintResiduals(
                phaseCell(phase, pl, params),
                phase.structure,
                atomStates(phase, pl, params),
              )
            : [];
        })
      : [];
  const rows = n + restraints(p).length;
  const evaluate = (params: Float64Array, model: Float64Array, jacobian: Float64Array | null) => {
    const bg = backgroundCurve(basis, layout, params, n);
    // With derivatives, the shifted peaks use the same profile windows as these (addProfiles).
    const peaks = phases.map((_, k) => placePeaks(phases, layout, k, params, wavelengths));
    const windows = peaks.map((list) => peakWindows(x, list));
    const parts = peaks.map((list, k) => {
      const out = new Float64Array(n);
      addProfiles(x, list, out, windows[k]);
      return out;
    });
    for (let i = 0; i < n; i++) {
      let total = bg[i] as number;
      for (const part of parts) total += part[i] as number;
      model[i] = total * (sw[i] as number);
    }
    const r0 = restraints(params);
    r0.forEach((v, i) => (model[n + i] = v));
    if (!jacobian) return;
    jacobian.fill(0);
    const m = layout.size;
    const step = (j: number) =>
      1e-6 * Math.max(Math.abs(params[j] as number), typical[j] as number);
    const columns: number[] = [];
    for (let j = 0; j < m; j++) {
      if (!free[j]) continue;
      if (r0.length > 0 && phaseOf[j] !== -1) {
        const h = step(j);
        const shifted = params.slice();
        shifted[j] = (params[j] as number) + h;
        restraints(shifted).forEach(
          (v, i) => (jacobian[(n + i) * m + j] = (v - (r0[i] as number)) / h),
        );
      }
      const bgTerm = backgroundIndex.get(j);
      if (bgTerm === undefined) columns.push(j);
      else
        for (let i = 0; i < n; i++)
          jacobian[i * m + j] = (basis[i * terms + bgTerm] as number) * (sw[i] as number);
    }
    const fallback = fillJacobian({
      x,
      sw,
      phases,
      layout,
      wavelengths,
      params,
      peaks,
      windows,
      columns,
      phaseOf,
      step,
      jacobian,
      m,
    });
    // A peak appeared or vanished with the step: difference of the whole pattern instead.
    for (const j of fallback) {
      const h = step(j);
      const shifted = params.slice();
      shifted[j] = (params[j] as number) + h;
      const moved = curves(shifted, windows);
      for (let i = 0; i < n; i++) {
        let change = 0;
        for (let q = 0; q < moved.length; q++)
          change +=
            ((moved[q] as Float64Array)[i] as number) - ((parts[q] as Float64Array)[i] as number);
        jacobian[i * m + j] = (change / h) * (sw[i] as number);
      }
    }
  };

  const sumWy2 = target.reduce((s, v) => s + v * v, 0);
  const goal = new Float64Array(rows);
  goal.set(target);
  let current: Float64Array = p;
  const leBailPhases = phases.flatMap((phase, k) => (phase.leBail ? [k] : []));
  /** Observed (partitioned) and calculated integrated intensity of each reflection of phase k. */
  const partition = (k: number, params: Float64Array, calc: Float64Array, bg: Float64Array) => {
    const phase = phases[k] as PhaseModel;
    const iCalc = new Float64Array(phase.reflections.length);
    const iObs = new Float64Array(phase.reflections.length);
    const xLo = x[0] as number;
    const xHi = x[n - 1] as number;
    for (const peak of placePeaks(phases, layout, k, params, wavelengths)) {
      if (peak.twoTheta < xLo || peak.twoTheta > xHi) continue;
      const { start, values } = profileWindow(x, peak);
      // Both sums run over the data points, so they share units and cut-off.
      for (let q = 0; q < values.length; q++) {
        const share = values[q] as number;
        if (share === 0) continue;
        const i = start + q;
        iCalc[peak.reflection] = (iCalc[peak.reflection] as number) + share;
        const net = (calc[i] as number) - (bg[i] as number);
        if (net <= 0) continue;
        iObs[peak.reflection] =
          (iObs[peak.reflection] as number) +
          (share * ((y[i] as number) - (bg[i] as number))) / net;
      }
    }
    return { iObs, iCalc };
  };
  const totals = (params: Float64Array) => {
    const bg = backgroundCurve(basis, layout, params, n);
    const calc = Float64Array.from(bg);
    for (const part of curves(params))
      for (let i = 0; i < n; i++) calc[i] = (calc[i] as number) + (part[i] as number);
    return { bg, calc };
  };
  // Le Bail extraction: each reflection's Σ|F|² scaled by its observed / calculated intensity.
  const extract = (params: Float64Array) => {
    const { bg, calc } = totals(params);
    for (const k of leBailPhases) {
      const intensities = (phases[k] as PhaseModel).leBail as Float64Array;
      const { iObs, iCalc } = partition(k, params, calc, bg);
      for (let r = 0; r < intensities.length; r++) {
        const ic = iCalc[r] as number;
        if (ic > 0)
          intensities[r] =
            ((intensities[r] as number) * Math.max(iObs[r] as number, 1e-6 * ic)) / ic;
      }
    }
  };
  const run = (freeNow: boolean[], maxIterations: number, extractCycles = 4) => {
    free = freeNow;
    const once = () => {
      const result = levenbergMarquardt({
        y: goal,
        initial: current,
        lower,
        upper,
        free,
        evaluate,
        maxIterations,
      });
      current = result.parameters;
      return result;
    };
    let result = once();
    for (let c = 0; leBailPhases.length > 0 && c < extractCycles; c++) {
      extract(current);
      const before = result.ssr;
      result = once();
      if (before - result.ssr < 1e-4 * before) break;
    }
    return result;
  };
  // R_wp of the data rows only (restraint rows excluded).
  const rwpOf = (result: { model: Float64Array }) => {
    let ssr = 0;
    for (let i = 0; i < n; i++) ssr += ((target[i] as number) - (result.model[i] as number)) ** 2;
    return Math.sqrt(ssr / sumWy2);
  };

  const mask = new Array<boolean>(layout.size).fill(false);
  const release = (indices: number[]) => indices.forEach((j) => (mask[j] = true));
  release(layout.background);
  // A Le Bail phase's scale only multiplies its extracted intensities, so it stays fixed.
  release(layout.phases.flatMap((pl, k) => ((phases[k] as PhaseModel).leBail ? [] : [pl.scale])));
  const stages: { name: string; rwp: number }[] = [];

  // Starting width: the best of a few typical values, with only scale and background refined.
  // Le Bail: each trial starts from the same intensities, which are first matched to the data
  // with the flat starting background (from equal intensities, as for a cell from indexing, a
  // free background would otherwise go negative under the many empty reflections).
  progress('Choosing the starting peak width');
  const extracted = () =>
    leBailPhases.map((k) => ((phases[k] as PhaseModel).leBail as Float64Array).slice());
  const restore = (saved: Float64Array[]) =>
    leBailPhases.forEach((k, i) =>
      ((phases[k] as PhaseModel).leBail as Float64Array).set(saved[i] as Float64Array),
    );
  const startIntensities = extracted();
  let best: { ssr: number; params: Float64Array; intensities: Float64Array[] } = {
    ssr: Infinity,
    params: current,
    intensities: startIntensities,
  };
  for (const fwhm of instrument ? [null] : TYPICAL_WIDTHS) {
    const trial = p.slice();
    if (fwhm !== null) layout.phases.forEach((pl) => (trial[pl.w] = fwhm * fwhm));
    restore(startIntensities);
    for (let c = 0; leBailPhases.length > 0 && c < 10; c++) extract(trial);
    current = trial;
    const result = run([...mask], 30, leBailPhases.length > 0 ? 3 : 0);
    if (result.ssr < best.ssr)
      best = { ssr: result.ssr, params: result.parameters, intensities: extracted() };
  }
  current = best.params;
  restore(best.intensities);

  // Line up each phase's cell with the data by small isotropic changes of its lengths.
  if (choices.cell) {
    progress('Lining up the reference cells');
    phases.forEach((phase, k) => {
      const pl = layout.phases[k] as (typeof layout.phases)[number];
      const names = cellParameterNames(phase.kind);
      const start = current.slice();
      let bestFactor: { ssr: number; params: Float64Array } = { ssr: Infinity, params: start };
      for (let f = -LINE_UP_RANGE; f <= LINE_UP_RANGE + 1e-12; f += LINE_UP_STEP) {
        const trial = start.slice();
        names.forEach((name, i) => {
          if (name === 'a' || name === 'b' || name === 'c')
            trial[pl.cell[i] as number] = (start[pl.cell[i] as number] as number) * (1 + f);
        });
        current = trial;
        const result = run([...mask], 10, 0);
        if (result.ssr < bestFactor.ssr)
          bestFactor = { ssr: result.ssr, params: result.parameters };
      }
      current = bestFactor.params;
    });
  }
  stages.push({ name: 'Scale factors and background', rwp: rwpOf(run([...mask], 50)) });

  const stage = (name: string, indices: number[]) => {
    if (indices.length === 0) return;
    progress(name);
    release(indices);
    stages.push({ name, rwp: rwpOf(run([...mask], 100)) });
  };
  stage(
    [
      'Zero shift',
      ...(choices.displacement
        ? [capillary ? 'capillary displacement Dx' : 'sample displacement']
        : []),
      ...(choices.transparency ? [capillary ? 'capillary displacement Dy' : 'transparency'] : []),
    ].join(', '),
    [
      ...(choices.zero ? [layout.zero] : []),
      ...(choices.displacement ? [layout.displacement] : []),
      ...(choices.transparency ? [layout.transparency] : []),
    ],
  );
  if (choices.cell)
    stage(
      'Unit cells',
      layout.phases.flatMap((pl) => pl.cell),
    );
  // The axial asymmetry is a property of the instrument, released before the sample widths so
  // that they do not start by absorbing it.
  if (refineAxial) stage('Axial divergence (SH/L)', [layout.axial]);
  // Without a fixed instrument, X (∝ 1/cos θ) cannot be told from the size and Y (∝ tan θ) from
  // the microstrain, so each stays fixed when its sample term is refined.
  const refineX = !choices.size;
  const refineY = !choices.strain;
  if (choices.width && !instrument)
    stage(
      tch
        ? refineX
          ? 'Peak width (W) and Lorentzian width (X)'
          : 'Peak width (W)'
        : 'Peak width (W) and shape (η)',
      layout.phases.flatMap((pl) => [pl.w, ...(tch ? (refineX ? [pl.lx] : []) : [pl.eta])]),
    );
  if (choices.widthSlope && !instrument)
    stage(
      tch
        ? refineY
          ? 'Width against angle (U, V, Y)'
          : 'Width against angle (U, V)'
        : 'Width against angle (U, V)',
      layout.phases.flatMap((pl) => [pl.u, pl.v, ...(tch && refineY ? [pl.ly] : [])]),
    );
  if (sampleBroadening)
    stage(
      [choices.size && 'Crystallite size', choices.strain && 'microstrain']
        .filter(Boolean)
        .join(' and '),
      layout.phases.flatMap((pl) => [
        ...(choices.size ? [pl.inverseSize] : []),
        ...(choices.strain ? [pl.microstrain] : []),
      ]),
    );
  if (sizeModel === 'uniaxial' || strainModel !== 'isotropic') {
    // From the isotropic result: the axial values equal the equatorial ones, and the Stephens
    // coefficients give the refined microstrain in every direction (broadening.ts). An isotropic
    // microstrain of about 0 (when the anisotropic widths cancel on average) is raised to 100 × 10⁻⁶:
    // at 0 the uniaxial and Stephens strains are singular (μ = d²√ΣS·T has no derivative there)
    // and every S_hkl would start at 0 with no scale for its steps.
    phases.forEach((phase, k) => {
      const pl = layout.phases[k] as (typeof layout.phases)[number];
      if (strainModel !== 'isotropic')
        current[pl.microstrain] = Math.max(current[pl.microstrain] as number, 100);
      if (sizeModel === 'uniaxial') {
        phase.sizeModel = 'uniaxial';
        current[pl.inverseSizeAxial] = current[pl.inverseSize] as number;
      }
      if (strainModel === 'uniaxial') {
        phase.strainModel = 'uniaxial';
        current[pl.microstrainAxial] = current[pl.microstrain] as number;
      }
      if (strainModel === 'generalized' && phase.laue) {
        phase.strainModel = 'generalized';
        const gStar = reciprocalMetric(phaseCell(phase, pl, current));
        const start = stephensFromIsotropic(
          phase.laue,
          current[pl.microstrain] as number,
          gStar,
          phase.reflections.flatMap((r) => r.members),
        );
        const size = Math.max(...start.map(Math.abs), 1e-12);
        start.forEach((v, i) => {
          const j = pl.stephens[i] as number;
          current[j] = v;
          typical[j] = Math.max(Math.abs(v), 1e-3 * size);
        });
      }
    });
    // The isotropic microstrain is replaced by the Stephens coefficients, not refined with them.
    if (strainModel === 'generalized') for (const pl of layout.phases) mask[pl.microstrain] = false;
    stage(
      [
        sizeModel === 'uniaxial' && 'Crystallite size along the axis',
        strainModel === 'uniaxial' && 'microstrain along the axis',
        strainModel === 'generalized' && 'generalized (Stephens) microstrain',
      ]
        .filter(Boolean)
        .join(' and '),
      layout.phases.flatMap((pl) => [
        ...(sizeModel === 'uniaxial' ? [pl.inverseSizeAxial] : []),
        ...(strainModel === 'uniaxial' ? [pl.microstrainAxial] : []),
        ...(strainModel === 'generalized' ? pl.stephens : []),
      ]),
    );
  }
  if (sampleBroadening && choices.sampleMix)
    stage(
      'Lorentzian fractions of size and strain',
      layout.phases.flatMap((pl) => [
        ...(choices.size ? [pl.sizeMix] : []),
        ...(choices.strain ? [pl.strainMix] : []),
      ]),
    );
  if (choices.asymmetry)
    stage(
      'Peak asymmetry (P1, P2)',
      layout.phases.flatMap((pl) => pl.asymmetry),
    );
  if (choices.orientation)
    stage(
      'Preferred orientation',
      layout.phases.flatMap((pl, k) =>
        (phases[k] as PhaseModel).texture
          ? pl.texture
          : (phases[k] as PhaseModel).orientation
            ? [pl.orientation]
            : [],
      ),
    );
  if (choices.overallB && !choices.biso)
    stage(
      'Overall displacement factor B',
      layout.phases.flatMap((pl, k) => ((phases[k] as PhaseModel).leBail ? [] : [pl.b])),
    );
  if (capillary && choices.absorption) stage('Capillary absorption (μR)', [layout.absorption]);
  if (choices.roughness && !capillary) {
    stage('Surface roughness B', [layout.roughness[1]]);
    // A changes nothing while B = 0 (a smooth surface), so it is released only after B moved.
    if ((current[layout.roughness[1]] as number) > 1e-4)
      stage('Surface roughness A', [layout.roughness[0]]);
  }
  progress('Final cycles');
  let final = run([...mask], 200);

  // Structure (Advanced): only once the basic refinement has converged.
  const structured = phases.flatMap((phase, k) =>
    phase.structure ? [{ phase, pl: layout.phases[k] as (typeof layout.phases)[number] }] : [],
  );
  const structureSkipped = structured.length > 0 && !final.converged;
  if (structured.length > 0 && final.converged) {
    if (choices.positions)
      stage(
        'Atom positions' + (restrained ? ' (with bond restraints)' : ''),
        structured.flatMap(({ pl }) => pl.atoms.flatMap((al) => al.coords)),
      );
    const fractions = structured.flatMap(({ phase, pl }) =>
      pl.atoms.flatMap((al, a) =>
        phase.structure?.atoms[a]?.substitute?.refine ? [al.fraction] : [],
      ),
    );
    if (fractions.length > 0) stage('Substitution fractions on shared sites', fractions);
    if (choices.occupancy)
      stage(
        'Site occupancies',
        // Only sites the file gives as partly filled: refining every occupancy with the scale
        // factor is singular (all of them times k is the same pattern as the scale times k).
        structured.flatMap(({ phase, pl }) =>
          pl.atoms.flatMap((al, a) =>
            (phase.structure?.atoms[a]?.occupancy0 ?? 1) < 1 ? [al.occupancy] : [],
          ),
        ),
      );
    if (choices.biso)
      stage(
        'Atomic displacement B',
        structured.flatMap(({ phase, pl }) =>
          pl.atoms.flatMap((al, a) => (phase.structure?.atoms[a]?.anisotropic ? [] : [al.b])),
        ),
      );
    if (choices.aniso)
      stage(
        'Anisotropic displacement (U_ij)',
        structured.flatMap(({ pl }) => pl.atoms.flatMap((al) => al.aniso)),
      );
    progress('Final cycles with the structure');
    final = run([...mask], 200);
  }

  // Results.
  const params = final.parameters;
  const errors = final.standardErrors;
  const estimate = (j: number): Estimate => ({
    value: params[j] as number,
    esd: mask[j] ? (errors[j] as number) : 0,
    refined: mask[j] as boolean,
  });
  const bg = backgroundCurve(basis, layout, params, n);
  const parts = curves(params);
  const calc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let total = bg[i] as number;
    for (const part of parts) total += part[i] as number;
    calc[i] = total;
  }
  const refinedCount = mask.filter((on, j) => on && !final.atBound[j]).length;
  let absDiff = 0;
  let sumObs = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    const diff = (y[i] as number) - (calc[i] as number);
    absDiff += Math.abs(diff);
    sumObs += y[i] as number;
    weighted += (diff * (sw[i] as number)) ** 2;
  }
  const rwp = Math.sqrt(weighted / sumWy2);
  const rexp = Math.sqrt(Math.max(n - refinedCount, 1) / sumWy2);
  const stats: RietveldStats = {
    rp: absDiff / sumObs,
    rwp,
    rexp,
    chi2: (rwp / rexp) ** 2,
    gof: rwp / rexp,
    points: n,
    parameters: refinedCount,
    durbinWatson: durbinWatson(
      Float64Array.from(y, (v, i) => (v - (calc[i] as number)) * (sw[i] as number)),
    ),
  };

  const m = layout.size;
  const covariance = final.covariance;
  const cov = (i: number, j: number) => covariance[i * m + j] as number;
  // Cell contents with each dopant moved onto its site: n = (site multiplicity) × occupancy × x
  // atoms of the host element become the dopant.
  const masses = input.phases.map((phase, k) => {
    const model = (phases[k] as PhaseModel).structure;
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    if (!phase.cellContents || !model?.atoms.some((a) => a.substitute))
      return cellMass(phase.cellContents, input.atomicWeights);
    const contents = substitutedContents(
      phase.cellContents,
      model,
      pl.atoms.map((al) => ({
        occupancy: params[al.occupancy] as number,
        fraction: params[al.fraction] as number,
      })),
    );
    return cellMass(contents, input.atomicWeights);
  });
  const volumes = phases.map((phase, k) =>
    cellVolume(phaseCell(phase, layout.phases[k] as (typeof layout.phases)[number], params)),
  );
  const scaleIdx = layout.phases.map((pl) => pl.scale);
  const anyLeBail = leBailPhases.length > 0;
  const massVolume = masses.map((mass, k) => (mass ?? NaN) * (volumes[k] as number));
  const scaleValues = scaleIdx.map((j) => params[j] as number);
  const scaleCovariance = scaleIdx.flatMap((i) => scaleIdx.map((j) => cov(i, j)));
  const fractions =
    masses.every((mass) => mass !== null) && !anyLeBail
      ? weightFractions(scaleValues, massVolume, scaleCovariance)
      : null;
  const standardIndex = input.standard
    ? phases.findIndex((phase) => phase.id === input.standard?.phaseId)
    : -1;
  const standardFraction = input.standard?.fraction ?? NaN;
  const standard =
    fractions && standardIndex >= 0 && standardFraction > 0 && standardFraction < 1
      ? {
          ...internalStandard(
            scaleValues,
            massVolume,
            scaleCovariance,
            standardIndex,
            standardFraction,
          ),
          phaseId: input.standard?.phaseId as string,
          fraction: standardFraction,
        }
      : null;
  const reported = mask.map((on, j) => on && !final.atBound[j]);
  const correlations = final.covarianceOk
    ? strongCorrelations(
        covariance,
        labels,
        reported,
        0.9,
        (a, b) => backgroundIndex.has(a) && backgroundIndex.has(b),
      ).slice(0, 20)
    : [];

  /**
   * Cell, atoms and the covariance of p = [a, b, c, α, β, γ, x₁, y₁, z₁, …] of phase k:
   * C_p = J C Jᵀ, J = ∂p/∂(refined parameters). The cell rows are central differences of the
   * cell built from its refined parameters; a coordinate is x = x₀ + Σ c_k v_k, so ∂x/∂c_k = v_k.
   * Without a structure model (only the cell refined) the stored positions are used.
   */
  const geometryOf = (k: number, cellNow: Cell): StructureGeometry => {
    const phase = phases[k] as PhaseModel;
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    const stored = (input.phases[k] as (typeof input.phases)[number]).structure as StoredStructure;
    const model = phase.structure;
    const states = model ? atomStates(phase, pl, params) : null;
    const size = 6 + 3 * stored.atoms.length;
    const jacobian: Map<number, number>[] = Array.from({ length: size }, () => new Map());
    const keys: (keyof Cell)[] = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
    for (const j of pl.cell) {
      if (!mask[j]) continue;
      const h = 1e-6 * Math.max(Math.abs(params[j] as number), 1);
      const shifted = (by: number) => {
        const p = params.slice();
        p[j] = (params[j] as number) + by;
        return phaseCell(phase, pl, p);
      };
      const up = shifted(h);
      const down = shifted(-h);
      keys.forEach((key, r) => {
        const d = (up[key] - down[key]) / (2 * h);
        if (d !== 0) (jacobian[r] as Map<number, number>).set(j, d);
      });
    }
    model?.atoms.forEach((atom, a) => {
      const al = pl.atoms[a] as (typeof pl.atoms)[number];
      al.coords.forEach((j, kk) => {
        if (!mask[j]) return;
        for (let i = 0; i < 3; i++) {
          const v = (atom.basis[kk] as number[])[i] as number;
          if (v !== 0) (jacobian[6 + 3 * a + i] as Map<number, number>).set(j, v);
        }
      });
    });
    const covarianceOut = new Array<number>(size * size).fill(0);
    for (let r = 0; r < size; r++)
      for (let t = r; t < size; t++) {
        let v = 0;
        for (const [i, ji] of jacobian[r] as Map<number, number>)
          for (const [j, jj] of jacobian[t] as Map<number, number>) v += ji * cov(i, j) * jj;
        covarianceOut[r * size + t] = v;
        covarianceOut[t * size + r] = v;
      }
    return {
      cell: { ...cellNow },
      ops: [...stored.ops],
      atoms: stored.atoms.map((atom, a) => ({
        label: atom.label,
        element: atom.element,
        x: states
          ? ([...(states[a] as (typeof states)[number]).x] as [number, number, number])
          : [...atom.x],
        occupancy: states ? (states[a] as (typeof states)[number]).occupancy : atom.occupancy,
      })),
      covariance: covarianceOut,
    };
  };

  const xLo = x[0] as number;
  const xHi = x[n - 1] as number;
  const negativeStrain: string[] = [];
  const phaseResults: RietveldPhaseResult[] = phases.map((phase, k) => {
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    const names = cellParameterNames(phase.kind);
    const cellNow = phaseCell(phase, pl, params);
    const keys: (keyof Cell)[] = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'];
    // Fixed parameters follow a refined one (b = a in a cubic cell) or are fixed by symmetry.
    const follows = (key: keyof Cell): number | null => {
      const own = names.indexOf(key);
      if (own >= 0) return pl.cell[own] as number;
      if ((key === 'b' || key === 'c') && cellNow[key] === cellNow.a && names.includes('a'))
        return pl.cell[0] as number;
      if ((key === 'beta' || key === 'gamma') && phase.kind === 'rhombohedral')
        return pl.cell[1] as number;
      return null;
    };
    const cellEstimates = Object.fromEntries(
      keys.map((key) => {
        const j = follows(key);
        return [
          key,
          j === null
            ? { value: cellNow[key], esd: 0, refined: false }
            : { ...estimate(j), value: cellNow[key] },
        ];
      }),
    ) as Record<keyof Cell, Estimate>;
    // Volume uncertainty: gradient of V with respect to the cell parameters, by finite differences.
    let volumeVariance = 0;
    if (mask[pl.cell[0] as number]) {
      const grad = pl.cell.map((j) => {
        const h = 1e-6 * Math.abs(params[j] as number);
        const shifted = params.slice();
        shifted[j] = (params[j] as number) + h;
        return (cellVolume(phaseCell(phase, pl, shifted)) - (volumes[k] as number)) / h;
      });
      pl.cell.forEach((i, s) =>
        pl.cell.forEach(
          (j, t) => (volumeVariance += (grad[s] as number) * cov(i, j) * (grad[t] as number)),
        ),
      );
    }

    // R_Bragg: observed intensities shared out in proportion to each reflection's profile.
    const peaks = placePeaks(phases, layout, k, params, wavelengths);
    const { iObs, iCalc } = partition(k, params, calc, bg);
    let numerator = 0;
    let denominator = 0;
    for (let r = 0; r < iCalc.length; r++) {
      if (iCalc[r] === 0) continue;
      numerator += Math.abs((iObs[r] as number) - (iCalc[r] as number));
      denominator += Math.abs(iObs[r] as number);
    }

    const fraction = fractions?.[k];
    const reflections: ReflectionRow[] = peaks
      .filter((peak) => peak.line === 0 && peak.twoTheta >= xLo && peak.twoTheta <= xHi)
      .map((peak) => {
        const family = phase.reflections[peak.reflection] as (typeof phase.reflections)[number];
        return {
          hkl: family.hkl,
          multiplicity: family.members.length,
          d: peak.d,
          twoTheta: peak.twoTheta,
          f2: peak.mf2 / family.members.length,
          iObs: iObs[peak.reflection] as number,
          iCalc: iCalc[peak.reflection] as number,
          orientation: peak.orientation,
        };
      });
    // Size from 1/D: σ(D) = σ(1/D) / (1/D)²; no size broadening found when 1/D is at 0.
    const sizeOf = (j: number): Estimate => {
      const inverse = estimate(j);
      return inverse.value > 0
        ? { value: 1 / inverse.value, esd: inverse.esd / inverse.value ** 2, refined: true }
        : { value: Infinity, esd: NaN, refined: true };
    };
    const size: Estimate | null = choices.size ? sizeOf(pl.inverseSize) : null;
    const uniaxialSize = phase.sizeModel === 'uniaxial';
    const phaseStrain = phase.strainModel ?? 'isotropic';
    // μ_hkl of every reflection in the data range, for the anisotropic microstrain models.
    const gStar = reciprocalMetric(phaseCell(phase, pl, params));
    const inRange = peaks.filter(
      (peak) => peak.line === 0 && peak.twoTheta >= xLo && peak.twoTheta <= xHi,
    );
    const strains =
      phaseStrain === 'isotropic'
        ? []
        : inRange.flatMap((peak) =>
            (phase.reflections[peak.reflection] as (typeof phase.reflections)[number]).members.map(
              (member) =>
                phaseStrain === 'generalized' && phase.laue
                  ? stephensStrain(
                      phase.laue,
                      pl.stephens.map((j) => params[j] as number),
                      member,
                      peak.d,
                    )
                  : uniaxialStrain(
                      params[pl.microstrain] as number,
                      params[pl.microstrainAxial] as number,
                      cosAngle(gStar, member, phase.strainAxis ?? [0, 0, 1]),
                    ),
            ),
          );
    const negative =
      phaseStrain === 'generalized' && phase.laue
        ? inRange.some((peak) =>
            (phase.reflections[peak.reflection] as (typeof phase.reflections)[number]).members.some(
              (member) =>
                stephensSum(
                  phase.laue as NonNullable<typeof phase.laue>,
                  pl.stephens.map((j) => params[j] as number),
                  member,
                ) < 0,
            ),
          )
        : false;
    if (negative) negativeStrain.push(phase.name);
    const states = atomStates(phase, pl, params);
    // A structure built only for anomalous dispersion is not reported as refined atoms.
    const reportAtoms = wantsStructure || phase.structure?.atoms.some((atom) => atom.substitute);
    const atoms: AtomResult[] | null =
      phase.structure && reportAtoms
        ? phase.structure.atoms.map((atom, a) => {
            const al = pl.atoms[a] as (typeof pl.atoms)[number];
            const state = states[a] as (typeof states)[number];
            const coordFree = al.coords.some((j) => mask[j]);
            const x = [0, 1, 2].map((i) => {
              // x_i = x0_i + Σ_k c_k v_ki, so var(x_i) = Σ_kl v_ki v_li cov(c_k, c_l).
              let variance = 0;
              al.coords.forEach((jk, kk) =>
                al.coords.forEach(
                  (jl, ll) =>
                    (variance +=
                      ((atom.basis[kk] as number[])[i] as number) *
                      ((atom.basis[ll] as number[])[i] as number) *
                      cov(jk, jl)),
                ),
              );
              const moves = atom.basis.some((v) => v[i] !== 0);
              return {
                value: state.x[i] as number,
                esd: coordFree && moves ? Math.sqrt(Math.max(variance, 0)) : 0,
                refined: coordFree && moves,
              };
            }) as [Estimate, Estimate, Estimate];
            return {
              label: atom.label,
              element: atom.element,
              x,
              occupancy: estimate(al.occupancy),
              b: atom.anisotropic ? { value: NaN, esd: 0, refined: false } : estimate(al.b),
              u: atom.uCif0
                ? atom.uCif0.map((u0, q) => {
                    // U_q = U0_q + Σ_k c_k V_kq, var(U_q) = Σ_kl V_kq V_lq cov(c_k, c_l).
                    let value = u0;
                    let variance = 0;
                    al.aniso.forEach((jk, kk) => {
                      const vk = (atom.uBasisCif[kk] as number[])[q] as number;
                      value += (params[jk] as number) * vk;
                      al.aniso.forEach(
                        (jl, ll) =>
                          (variance +=
                            vk * ((atom.uBasisCif[ll] as number[])[q] as number) * cov(jk, jl)),
                      );
                    });
                    const refined =
                      al.aniso.some((j) => mask[j]) && atom.uBasisCif.some((v) => v[q] !== 0);
                    return { value, esd: refined ? Math.sqrt(Math.max(variance, 0)) : 0, refined };
                  })
                : null,
              positiveDefinite: state.uImages?.[0] ? positiveDefinite(state.uImages[0]) : true,
              substitute: atom.substitute
                ? { element: atom.substitute.element, fraction: estimate(al.fraction) }
                : null,
            };
          })
        : null;
    const geometry = input.phases[k]?.structure && !phase.leBail ? geometryOf(k, cellNow) : null;
    return {
      id: phase.id,
      name: phase.name,
      cell: cellEstimates,
      volume: {
        value: volumes[k] as number,
        esd: mask[pl.cell[0] as number] ? Math.sqrt(Math.max(volumeVariance, 0)) : 0,
        refined: mask[pl.cell[0] as number] as boolean,
      },
      scale: estimate(pl.scale),
      weightFraction: fraction ? { value: fraction.value, esd: fraction.esd, refined: true } : null,
      u: estimate(pl.u),
      v: estimate(pl.v),
      w: estimate(pl.w),
      eta: tch ? { value: NaN, esd: 0, refined: false } : estimate(pl.eta),
      x: estimate(pl.lx),
      y: estimate(pl.ly),
      tch,
      orientation: phase.orientation && !phase.texture ? estimate(pl.orientation) : null,
      orientationDirection: phase.texture ? null : phase.orientation,
      texture: phase.texture
        ? {
            order: Math.max(...phase.texture.terms.map(([l]) => l)),
            laue: phase.texture.symmetry.laue,
            coefficients: phase.texture.terms.map((term, i) => ({
              name: textureName(term),
              value: estimate(pl.texture[i] as number),
            })),
            index: textureIndex(
              phase.texture.terms,
              pl.texture.map((j) => params[j] as number),
              pl.texture.map((j) => (mask[j] ? (errors[j] as number) : 0)),
            ),
            range: [
              Math.min(...inRange.map((peak) => peak.orientation)),
              Math.max(...inRange.map((peak) => peak.orientation)),
            ],
          }
        : null,
      overallB: estimate(pl.b),
      asymmetry: [estimate(pl.asymmetry[0]), estimate(pl.asymmetry[1])],
      rBragg: denominator > 0 && !phase.leBail ? numerator / denominator : NaN,
      atoms,
      geometry,
      leBail: phase.leBail !== undefined,
      size,
      microstrain:
        choices.strain && phaseStrain !== 'generalized' ? estimate(pl.microstrain) : null,
      sizeMix: estimate(pl.sizeMix),
      strainMix: estimate(pl.strainMix),
      sizeModel: uniaxialSize ? 'uniaxial' : 'isotropic',
      sizeAxis: uniaxialSize ? (phase.sizeAxis ?? [0, 0, 1]) : null,
      sizeAxial: uniaxialSize ? sizeOf(pl.inverseSizeAxial) : null,
      strainModel: phaseStrain,
      strainAxis: phaseStrain === 'uniaxial' ? (phase.strainAxis ?? [0, 0, 1]) : null,
      microstrainAxial: phaseStrain === 'uniaxial' ? estimate(pl.microstrainAxial) : null,
      stephens:
        phaseStrain === 'generalized' && phase.laue
          ? stephensNames(phase.laue).map((name, i) => ({
              name,
              value: estimate(pl.stephens[i] as number),
            }))
          : null,
      strainRange: strains.length > 0 ? [Math.min(...strains), Math.max(...strains)] : null,
      reflections,
      ticks: peaks
        .filter((peak) => peak.line === 0 && peak.twoTheta >= xLo && peak.twoTheta <= xHi)
        .map((peak) => ({
          twoTheta: peak.twoTheta,
          hkl: (phase.reflections[peak.reflection] as { hkl: Hkl }).hkl,
        })),
    };
  });

  const warnings: string[] = [];
  const integerCounts = y.every((v) => Math.abs(v - Math.round(v)) < 1e-6);
  if (!integerCounts || yMax < 100)
    warnings.push(
      'The intensities do not look like raw counts (they are not whole numbers, or are very small). The weights 1/y then mean little, so R_exp, χ² and the uncertainties are not reliable. R_wp can still be compared between refinements of this pattern.',
    );
  if (!final.converged)
    warnings.push('The refinement stopped before it converged. Check the fit, then refine again.');
  if (capillary && choices.roughness)
    warnings.push(
      'Surface roughness describes a flat sample, so it was not used in capillary geometry. The capillary absorption μR takes its place.',
    );
  if (capillary && wavelengths.variableSlit)
    warnings.push(
      'An automatic divergence slit belongs to flat-plate (Bragg–Brentano) geometry, so its correction was not used for the capillary.',
    );
  if (capillary && choices.absorption && mask[layout.absorption])
    warnings.push(
      'The refined capillary μR is strongly correlated with the displacement parameters B (both change the intensity smoothly with angle). Prefer fixing μR at the value calculated from the composition, the packing fraction and the capillary radius, and check that the refined value is close to it.',
    );
  if (dispersion && anomalousSkipped.length > 0)
    warnings.push(
      `Anomalous dispersion could not be applied to ${anomalousSkipped.join(', ')}: no atom positions are stored, so the reference intensities were used. Add the phase again from its CIF to include it.`,
    );
  if (textureTooLow.length > 0)
    warnings.push(
      `The texture of ${textureTooLow.join(', ')} has no terms at order 2: cubic symmetry allows the first ones at order 4, so no preferred orientation was refined. Choose order 4 or higher.`,
    );
  for (const r of phaseResults) {
    if (r.texture && r.texture.range[0] <= 0)
      warnings.push(
        `The texture of ${r.name} makes some reflections negative (smallest correction ${r.texture.range[0].toFixed(2)}), which is not physical. Use a lower order, or refine fewer terms.`,
      );
  }
  if (!final.covarianceOk)
    warnings.push(
      'Uncertainties could not be calculated: some refined parameters cannot be told apart. Fix some of them (for example U and V) and refine again.',
    );
  const atBound = mask.flatMap((on, j) => (on && final.atBound[j] ? [j] : []));
  if (atBound.length > 0)
    warnings.push(
      `Some parameters ended at the edge of their allowed range (${atBound.map((j) => labels[j]).join(', ')}), so their values are not reliable. This often means a phase is not present, its reference does not fit, or the parameter should not be refined.`,
    );
  if (stats.gof > 2)
    warnings.push(
      'GOF is well above 1: the model misses something in the data, for example another phase, peak asymmetry, size or strain broadening that differs between reflections, or the wrong preferred orientation. Look at the difference curve.',
    );
  if (choices.asymmetry) {
    // The corrected profile must stay ≥ 0: check As(z) on |z| ≤ 3 for every peak in the range.
    const negative = phases.filter((_, k) =>
      placePeaks(phases, layout, k, params, wavelengths).some((peak) => {
        if (peak.twoTheta < xLo || peak.twoTheta > xHi) return false;
        for (let z = -3; z <= 3; z += 0.01) {
          if (asymmetryFactor(z, ...peak.asymmetry) < 0) return true;
        }
        return false;
      }),
    );
    if (negative.length > 0)
      warnings.push(
        `The refined asymmetry is so large that some calculated peaks of ${negative.map((p) => p.name).join(', ')} dip below the background on one side, which is not physical. Start from a narrower 2θ range or leave asymmetry off.`,
      );
  }
  phaseResults.forEach((phase) => {
    if (phase.scale.value <= 0 || phase.scale.esd > phase.scale.value)
      warnings.push(
        `${phase.name}: the scale factor is not determined by the data, so this phase may not be present.`,
      );
  });
  if (anyLeBail)
    warnings.push(
      `Le Bail mode (${leBailPhases.map((k) => (phases[k] as PhaseModel).name).join(', ')}): the peak intensities were taken from the data, not from a structure, so this fit gives the cell and the peak shape only. It gives no weight fractions and no R_Bragg, and a good R_wp does not show that the phase is right.`,
    );
  if (sampleBroadening && !instrument)
    warnings.push(
      'The instrument profile was not fixed, so the crystallite size and microstrain include the instrument’s own broadening (the size is a lower limit, the strain an upper limit). Refine a standard such as LaB₆ or Si first and use its profile as the fixed instrument profile.',
    );
  if (negativeStrain.length > 0)
    warnings.push(
      `${negativeStrain.join(', ')}: the refined Stephens coefficients give a negative strain variance for some reflections, which is not physical (their strain broadening is taken as zero). Refine the isotropic or uniaxial microstrain instead, or fix some of the coefficients.`,
    );
  if (choices.size)
    phaseResults.forEach((phase) => {
      if (phase.size && !Number.isFinite(phase.size.value))
        warnings.push(
          `${phase.name}: no size broadening was found; the crystallites are too large to measure from the peak widths (above about 1 µm).`,
        );
    });
  if (standard) {
    const a = standard.amorphous;
    if (a.value < -2 * a.esd - 0.01)
      warnings.push(
        'The amorphous content came out clearly negative, which is not physical: check the weighed fraction of the standard, its reference structure, and preferred orientation or microabsorption of either phase.',
      );
  } else if (input.standard)
    warnings.push(
      'The amorphous content could not be calculated: it needs the internal standard among the phases refined, a weighed fraction between 0 and 1, the unit-cell contents of every phase and no phase in Le Bail mode.',
    );
  const strong = correlations.filter((c) => Math.abs(c.r) >= 0.95);
  if (strong.length > 0)
    warnings.push(
      `Some refined parameters are strongly correlated (|r| ≥ 0.95): ${strong
        .slice(0, 3)
        .map((c) => `${c.a} and ${c.b} (r = ${c.r.toFixed(2)})`)
        .join(
          '; ',
        )}. The data cannot tell them apart well, so their values and uncertainties are less reliable; fix one of each pair if it is not needed.`,
    );
  if (fractions)
    warnings.push(
      'Weight fractions are of the crystalline phases you included only: amorphous content and missing phases are not counted, and microabsorption is not corrected.',
    );
  else if (phases.length > 1 && !anyLeBail)
    warnings.push(
      'Weight fractions need the unit-cell contents of every phase; at least one phase does not have them (reload its CIF or reference to add them).',
    );
  if (!wantsStructure)
    warnings.push(
      'Atom positions, occupancies and displacement parameters are kept from the reference structures; this is not a structure refinement.',
    );
  else {
    warnings.push(
      'Structure refinement from a laboratory powder pattern is rarely well determined: check that the refined positions give sensible bond lengths, that occupancies and B stay physical, and that R_Bragg falls. Treat the values as estimates.',
    );
    if (noStructure.length > 0)
      warnings.push(
        `No atom positions are stored for ${noStructure.join(', ')}, so its structure was kept. Remove the phase and add it again from its CIF to refine it.`,
      );
    if (structureSkipped)
      warnings.push(
        'The basic refinement did not converge, so the structure was not refined. Improve the basic fit first.',
      );
    if (
      choices.occupancy &&
      !phases.some((phase) => phase.structure?.atoms.some((atom) => atom.occupancy0 < 1))
    )
      warnings.push(
        'No site is partly filled in the reference files, so no occupancy was refined. Full sites stay at 1 because refining them together with the scale factor has no unique answer.',
      );
    if (choices.occupancy && choices.biso)
      warnings.push(
        'Occupancies and B were refined together; they are strongly correlated (both lower high-angle intensity), so look at their uncertainties.',
      );
    if (choices.aniso)
      warnings.push(
        'Anisotropic U_ij need very good data to high angle; a laboratory pattern rarely supports them. Every atom was made anisotropic, starting from its isotropic value, so atom B values were not refined.',
      );
    const notPositive = phaseResults.flatMap((r) =>
      (r.atoms ?? []).filter((a) => !a.positiveDefinite).map((a) => `${r.name} ${a.label}`),
    );
    if (notPositive.length > 0)
      warnings.push(
        `The refined U_ij of ${notPositive.join(', ')} are not positive definite, which is physically impossible: refine them isotropically instead.`,
      );
    if (choices.biso && choices.overallB)
      warnings.push('The overall B was kept fixed because the atoms’ own B values were refined.');
  }
  const substituted = phaseResults.flatMap((r) =>
    (r.atoms ?? []).flatMap((a) => (a.substitute ? [{ phase: r.name, atom: a }] : [])),
  );
  if (substituted.length > 0) {
    warnings.push(
      'The dopant fraction comes from how strongly the site scatters X-rays: it cannot tell a dopant from vacancies on the site, it is correlated with the site’s B and occupancy, and a dopant sitting elsewhere (another site, a grain boundary or a second phase) is not seen. Confirm the composition with another method, for example EDS or ICP.',
    );
    if (structureSkipped)
      warnings.push(
        'The basic refinement did not converge, so the dopant fractions were kept at their starting values.',
      );
    for (const { phase, atom } of substituted) {
      const zHost = ELEMENT_BY_SYMBOL.get(atom.element)?.z;
      const zDopant = ELEMENT_BY_SYMBOL.get(atom.substitute?.element ?? '')?.z;
      if (zHost !== undefined && zDopant !== undefined && Math.abs(zHost - zDopant) <= 3)
        warnings.push(
          `${phase}: ${atom.substitute?.element} and ${atom.element} differ by only ${Math.abs(zHost - zDopant)} electron${Math.abs(zHost - zDopant) === 1 ? '' : 's'}, so X-rays can hardly tell them apart and the refined fraction on ${atom.label} is not reliable. Keep it fixed at the nominal composition instead.`,
        );
    }
  }

  return {
    ok: true,
    x: Array.from(x),
    observed: Array.from(y),
    calculated: Array.from(calc),
    background: Array.from(bg),
    phaseCurves: parts.map((part) => Array.from(part)),
    zero: estimate(layout.zero),
    displacement: estimate(layout.displacement),
    transparency: estimate(layout.transparency),
    roughness: [estimate(layout.roughness[0]), estimate(layout.roughness[1])],
    axial: estimate(layout.axial),
    absorption: capillary ? estimate(layout.absorption) : null,
    anomalous:
      dispersion !== undefined &&
      anomalousSkipped.length < phases.filter((ph) => !ph.leBail).length,
    anomalousSkipped,
    polarisation: wavelengths.polarisation ?? 0.5,
    instrument,
    excluded,
    phases: phaseResults,
    correlations,
    standard,
    stats,
    stages,
    converged: final.converged,
    warnings,
  };
}
