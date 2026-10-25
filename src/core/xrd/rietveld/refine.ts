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
 * then the peak widths and shape, then preferred orientation, then an overall displacement factor.
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
 * Standard uncertainties are √(diagonal of s²(JᵀWJ)⁻¹), s² = Σ w(y_obs − y_calc)² / (N − P). They
 * ignore serial correlation of the residuals and so usually underestimate the real uncertainty
 * (Bérar and Lelann, J. Appl. Cryst. 24 (1991) 1–5).
 */

import { levenbergMarquardt } from '../../math/levenbergMarquardt';
import type { Cell } from '../reference/powder';
import type { ReferencePeak } from '../reference/types';
import { cellKind, cellParameterNames, cellVolume } from './cell';
import {
  addProfiles,
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCell,
  phaseCurve,
  placePeaks,
  type Layout,
  type PhaseModel,
  type Wavelengths,
} from './model';
import { refinementReflections, type Hkl } from './reflections';

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
}

export const DEFAULT_CHOICES: RefineChoices = {
  zero: true,
  displacement: false,
  cell: true,
  width: true,
  widthSlope: true,
  orientation: false,
  overallB: false,
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
  eta: Estimate;
  /** March–Dollase r, or null when the phase has no preferred direction. */
  orientation: Estimate | null;
  orientationDirection: Hkl | null;
  overallB: Estimate;
  rBragg: number;
  /** Kα1 positions (degrees 2θ) of the reflections inside the data range, with one (h k l) each. */
  ticks: { twoTheta: number; hkl: Hkl }[];
}

export interface RietveldStats {
  rp: number;
  rwp: number;
  rexp: number;
  chi2: number;
  gof: number;
  points: number;
  parameters: number;
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
  phases: RietveldPhaseResult[];
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
  const { x, y, wavelengths, choices } = input;
  const n = x.length;
  if (n < 50) return { ok: false, error: 'The pattern has too few points for a refinement.' };
  if (input.phases.length === 0)
    return { ok: false, error: 'Choose at least one phase to refine.' };

  // Reflections that can appear in the data range: d down to λ / (2 sin θ_max), with 1° to spare.
  const thetaMax = (Math.min((x[n - 1] as number) + 1, 179) * Math.PI) / 360;
  const dMin = wavelengths.kAlpha1 / (2 * Math.sin(thetaMax));
  const phases: PhaseModel[] = input.phases.map((phase) => {
    const kind = cellKind(phase.crystalSystem, phase.cell);
    return {
      id: phase.id,
      name: phase.name,
      kind,
      cell: phase.cell,
      reflections: refinementReflections(phase.peaks, phase.cell, kind, dMin),
      orientation: phase.orientation,
    };
  });
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
    bound(pl.u, -1, 2, 0, 0.01);
    bound(pl.v, -2, 2, 0, 0.01);
    bound(pl.w, 1e-6, 2, 0.01, 0.01);
    bound(pl.eta, 0, 1, 0.5, 0.1);
    bound(pl.orientation, 0.3, 3, 1, 1);
    bound(pl.b, -2, 10, 0, 1);
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
  labels[layout.displacement] = 'sample displacement';
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
    labels[pl.orientation] = `${phase.name}: March–Dollase r`;
    labels[pl.b] = `${phase.name}: B`;
  });

  const curves = (params: Float64Array) =>
    phases.map((_, k) => phaseCurve(x, phases, layout, k, params, wavelengths));
  const phaseOf = new Int32Array(layout.size).fill(-1);
  layout.phases.forEach((pl, k) => {
    for (const j of [pl.scale, ...pl.cell, pl.u, pl.v, pl.w, pl.eta, pl.orientation, pl.b])
      phaseOf[j] = k;
  });
  const backgroundIndex = new Map(layout.background.map((j, i) => [j, i]));

  let free = new Array<boolean>(layout.size).fill(false);
  const evaluate = (params: Float64Array, model: Float64Array, jacobian: Float64Array | null) => {
    const bg = backgroundCurve(basis, layout, params, n);
    const parts = curves(params);
    for (let i = 0; i < n; i++) {
      let total = bg[i] as number;
      for (const part of parts) total += part[i] as number;
      model[i] = total * (sw[i] as number);
    }
    if (!jacobian) return;
    jacobian.fill(0);
    const m = layout.size;
    for (let j = 0; j < m; j++) {
      if (!free[j]) continue;
      const bgTerm = backgroundIndex.get(j);
      if (bgTerm !== undefined) {
        for (let i = 0; i < n; i++)
          jacobian[i * m + j] = (basis[i * terms + bgTerm] as number) * (sw[i] as number);
        continue;
      }
      const h = 1e-6 * Math.max(Math.abs(params[j] as number), typical[j] as number);
      const shifted = params.slice();
      shifted[j] = (params[j] as number) + h;
      const k = phaseOf[j] as number;
      if (k >= 0) {
        const moved = phaseCurve(x, phases, layout, k, shifted, wavelengths);
        const base = parts[k] as Float64Array;
        for (let i = 0; i < n; i++)
          jacobian[i * m + j] =
            (((moved[i] as number) - (base[i] as number)) / h) * (sw[i] as number);
      } else {
        const moved = curves(shifted);
        for (let i = 0; i < n; i++) {
          let change = 0;
          for (let q = 0; q < moved.length; q++)
            change +=
              ((moved[q] as Float64Array)[i] as number) - ((parts[q] as Float64Array)[i] as number);
          jacobian[i * m + j] = (change / h) * (sw[i] as number);
        }
      }
    }
  };

  const sumWy2 = target.reduce((s, v) => s + v * v, 0);
  let current: Float64Array = p;
  const run = (freeNow: boolean[], maxIterations: number) => {
    free = freeNow;
    const result = levenbergMarquardt({
      y: target,
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
  const rwpOf = (ssr: number) => Math.sqrt(ssr / sumWy2);

  const mask = new Array<boolean>(layout.size).fill(false);
  const release = (indices: number[]) => indices.forEach((j) => (mask[j] = true));
  release(layout.background);
  release(layout.phases.map((pl) => pl.scale));
  const stages: { name: string; rwp: number }[] = [];

  // Starting width: the best of a few typical values, with only scale and background refined.
  progress('Choosing the starting peak width');
  let best: { ssr: number; params: Float64Array } = { ssr: Infinity, params: current };
  for (const fwhm of TYPICAL_WIDTHS) {
    const trial = p.slice();
    layout.phases.forEach((pl) => (trial[pl.w] = fwhm * fwhm));
    current = trial;
    const result = run([...mask], 30);
    if (result.ssr < best.ssr) best = { ssr: result.ssr, params: result.parameters };
  }
  current = best.params;

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
        const result = run([...mask], 10);
        if (result.ssr < bestFactor.ssr)
          bestFactor = { ssr: result.ssr, params: result.parameters };
      }
      current = bestFactor.params;
    });
  }
  stages.push({ name: 'Scale factors and background', rwp: rwpOf(run([...mask], 50).ssr) });

  const stage = (name: string, indices: number[]) => {
    if (indices.length === 0) return;
    progress(name);
    release(indices);
    stages.push({ name, rwp: rwpOf(run([...mask], 100).ssr) });
  };
  stage('Zero shift' + (choices.displacement ? ' and sample displacement' : ''), [
    ...(choices.zero ? [layout.zero] : []),
    ...(choices.displacement ? [layout.displacement] : []),
  ]);
  if (choices.cell)
    stage(
      'Unit cells',
      layout.phases.flatMap((pl) => pl.cell),
    );
  if (choices.width)
    stage(
      'Peak width (W) and shape (η)',
      layout.phases.flatMap((pl) => [pl.w, pl.eta]),
    );
  if (choices.widthSlope)
    stage(
      'Width against angle (U, V)',
      layout.phases.flatMap((pl) => [pl.u, pl.v]),
    );
  if (choices.orientation)
    stage(
      'Preferred orientation',
      layout.phases.flatMap((pl, k) =>
        (phases[k] as PhaseModel).orientation ? [pl.orientation] : [],
      ),
    );
  if (choices.overallB)
    stage(
      'Overall displacement factor B',
      layout.phases.map((pl) => pl.b),
    );
  progress('Final cycles');
  const final = run([...mask], 200);

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
  };

  const m = layout.size;
  const covariance = final.covariance;
  const cov = (i: number, j: number) => covariance[i * m + j] as number;
  const masses = input.phases.map((phase) => cellMass(phase.cellContents, input.atomicWeights));
  const volumes = phases.map((phase, k) =>
    cellVolume(phaseCell(phase, layout.phases[k] as (typeof layout.phases)[number], params)),
  );
  const scaleIdx = layout.phases.map((pl) => pl.scale);
  const fractions = masses.every((mass) => mass !== null)
    ? weightFractions(
        scaleIdx.map((j) => params[j] as number),
        masses.map((mass, k) => (mass as number) * (volumes[k] as number)),
        scaleIdx.flatMap((i) => scaleIdx.map((j) => cov(i, j))),
      )
    : null;

  const xLo = x[0] as number;
  const xHi = x[n - 1] as number;
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
    const iCalc = new Float64Array(phase.reflections.length);
    const iObs = new Float64Array(phase.reflections.length);
    const profile = new Float64Array(n);
    for (const peak of peaks) {
      if (peak.twoTheta < xLo || peak.twoTheta > xHi) continue;
      profile.fill(0);
      addProfiles(x, [peak], profile);
      // Both sums run over the data points, so they share units and cut-off.
      for (let i = 0; i < n; i++) {
        const share = profile[i] as number;
        if (share === 0) continue;
        iCalc[peak.reflection] = (iCalc[peak.reflection] as number) + share;
        const net = (calc[i] as number) - (bg[i] as number);
        if (net <= 0) continue;
        iObs[peak.reflection] =
          (iObs[peak.reflection] as number) +
          (share * ((y[i] as number) - (bg[i] as number))) / net;
      }
    }
    let numerator = 0;
    let denominator = 0;
    for (let r = 0; r < iCalc.length; r++) {
      if (iCalc[r] === 0) continue;
      numerator += Math.abs((iObs[r] as number) - (iCalc[r] as number));
      denominator += Math.abs(iObs[r] as number);
    }

    const fraction = fractions?.[k];
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
      eta: estimate(pl.eta),
      orientation: phase.orientation ? estimate(pl.orientation) : null,
      orientationDirection: phase.orientation,
      overallB: estimate(pl.b),
      rBragg: denominator > 0 ? numerator / denominator : NaN,
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
  phaseResults.forEach((phase) => {
    if (phase.scale.value <= 0 || phase.scale.esd > phase.scale.value)
      warnings.push(
        `${phase.name}: the scale factor is not determined by the data, so this phase may not be present.`,
      );
  });
  if (fractions)
    warnings.push(
      'Weight fractions are of the crystalline phases you included only: amorphous content and missing phases are not counted, and microabsorption is not corrected.',
    );
  else if (phases.length > 1)
    warnings.push(
      'Weight fractions need the unit-cell contents of every phase; at least one phase does not have them (reload its CIF or reference to add them).',
    );
  warnings.push(
    'Atom positions, occupancies and displacement parameters are kept from the reference structures; this is not a structure refinement.',
  );

  return {
    ok: true,
    x: Array.from(x),
    observed: Array.from(y),
    calculated: Array.from(calc),
    background: Array.from(bg),
    phaseCurves: parts.map((part) => Array.from(part)),
    zero: estimate(layout.zero),
    displacement: estimate(layout.displacement),
    phases: phaseResults,
    stats,
    stages,
    converged: final.converged,
    warnings,
  };
}
