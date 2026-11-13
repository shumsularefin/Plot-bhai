/*
 * Jacobian of the calculated pattern (model.ts) with respect to the refined parameters, peak by
 * peak instead of by recalculating the whole pattern for each parameter.
 *
 * Each peak contributes A·Ω(x; T, H, η, a, b) on the points of its window, A its area, T its
 * position (degrees 2θ), H its FWHM, η its Lorentzian fraction and a, b the asymmetry coefficients
 * (P1/tan θ, P2/tan θ). For a parameter p the chain rule gives
 *   ∂y/∂p = Σ_peaks [ ∂A/∂p · Ω + A (∂T/∂p ∂Ω/∂T + ∂H/∂p ∂Ω/∂H + ∂η/∂p ∂Ω/∂η + ∂a/∂p ∂Ω/∂a
 *                     + ∂b/∂p ∂Ω/∂b) ].
 * - ∂A/∂p, ∂T/∂p, … are central differences of the peak list alone (placePeaks, without the
 *   profiles), with the step of the earlier whole-pattern difference, h = 10⁻⁶ max(|p|, typical
 *   p). Where one side does not move (a clamped quantity, such as η = 0 or SH/L = 0) the forward
 *   difference is used, as before. Σ|F|² is not recalculated for them unless the cell of a refined
 *   structure changes.
 * - For the atoms' parameters ∂A/∂p = (A/Σ|F|²) ∂Σ|F|²/∂p from the exact structure-factor
 *   gradient (structure.ts); nothing else depends on them.
 * - ∂Ω/∂T, … are exact. With Ω = V(u)·As(z), u = x − T, z = u/H,
 *     V = η L + (1 − η) G,   L = (2/(πH)) / (1 + 4u²/H²),   G = (2√(ln2/π)/H) exp(−4 ln2 u²/H²)
 *     ∂L/∂u = −L (8u/H²)/(1 + 4u²/H²),          ∂G/∂u = −G · 8 ln2 u/H²
 *     ∂L/∂H = L [−1 + (8u²/H²)/(1 + 4u²/H²)]/H,  ∂G/∂H = G (−1 + 8 ln2 u²/H²)/H
 *     As = 1 + a Fa(z) + b Fb(z),  Fa = 2z e^(−z²),  Fb = 2(2z² − 3) Fa,
 *     Fa′ = 2 e^(−z²)(1 − 2z²),    Fb′ = 8z Fa + 2(2z² − 3) Fa′
 *   so ∂Ω/∂T = −V′As − V As′/H, ∂Ω/∂H = V_H As − V As′ u/H², ∂Ω/∂η = (L − G) As,
 *   ∂Ω/∂a = V Fa and ∂Ω/∂b = V Fb.
 * - Peaks with the axial-divergence profile (fcj.ts), whose nodes move with T, H and SH/L, use a
 *   central difference of that one peak's profile when its shape changes (forward at a bound),
 *   and the ∂A/∂p term alone otherwise.
 * The profile windows are those of the unshifted parameters (model.ts, addProfiles). A parameter
 * whose shifted peak list does not line up with the unshifted one (a peak appearing or vanishing)
 * is returned to the caller for the whole-pattern difference.
 */

import {
  addProfiles,
  placePeaks,
  atomStates,
  type Layout,
  type PhaseModel,
  type PlacedPeak,
  type Wavelengths,
} from './model';
import { atomParameterCount, structureFactorGradient } from './structure';

const SQRT_LN2_PI = Math.sqrt(Math.LN2 / Math.PI);
/** Coefficients per peak and column: Ω, ∂Ω/∂T, ∂Ω/∂H, ∂Ω/∂η, ∂Ω/∂a, ∂Ω/∂b. */
const TERMS = 6;

export interface JacobianInput {
  x: Float64Array;
  /** Multiplier of every point of the model (model[i] = (b + Σ y) · sw[i]). */
  sw: Float64Array;
  phases: readonly PhaseModel[];
  layout: Layout;
  wavelengths: Wavelengths;
  params: Float64Array;
  /** Peaks and their windows (peakWindows) of every phase for params. */
  peaks: readonly PlacedPeak[][];
  windows: readonly Int32Array[];
  /** Free parameters other than the background, whose columns are filled. */
  columns: readonly number[];
  /** Phase of each parameter, −1 for those shared by all phases. */
  phaseOf: Int32Array;
  /** Forward-difference step of parameter j. */
  step: (j: number) => number;
  /** Row-major Jacobian, `m` columns, rows = points first; columns of `columns` must be zero. */
  jacobian: Float64Array;
  m: number;
}

/** Same profile shape (everything but the area) for two placements of one peak. */
function sameShape(p: PlacedPeak, s: PlacedPeak): boolean {
  if (
    p.twoTheta !== s.twoTheta ||
    p.fwhm !== s.fwhm ||
    p.eta !== s.eta ||
    p.asymmetry[0] !== s.asymmetry[0] ||
    p.asymmetry[1] !== s.asymmetry[1] ||
    p.reach !== s.reach
  )
    return false;
  if (!p.fcj || !s.fcj) return !p.fcj && !s.fcj;
  const a = p.fcj;
  const b = s.fcj;
  if (a.centres.length !== b.centres.length) return false;
  for (let j = 0; j < a.centres.length; j++)
    if (a.centres[j] !== b.centres[j] || a.weights[j] !== b.weights[j]) return false;
  return true;
}

const aligned = (a: readonly PlacedPeak[], b: readonly PlacedPeak[]) =>
  a.length === b.length &&
  a.every((p, q) => {
    const s = b[q] as PlacedPeak;
    return s.reflection === p.reflection && s.line === p.line;
  });

/**
 * Fills the columns of `columns` (see the header) and returns the parameters it could not fill,
 * which the caller differentiates over the whole pattern.
 */
export function fillJacobian(input: JacobianInput): number[] {
  const { x, sw, phases, layout, wavelengths, params, peaks, windows, jacobian, m } = input;
  const nCols = input.columns.length;
  const fallback: number[] = [];
  // coef[k][(q · nCols + c) · TERMS + t]: coefficient of term t for peak q of phase k, column c.
  const coef = peaks.map((list) => new Float64Array(list.length * nCols * TERMS));
  const known = peaks.map((list, k) => {
    const out = new Float64Array((phases[k] as PhaseModel).reflections.length);
    for (const peak of list) out[peak.reflection] = peak.mf2;
    return out;
  });
  const empty = (k: number, q: number) => {
    const w = windows[k] as Int32Array;
    return (w[2 * q] as number) >= (w[2 * q + 1] as number);
  };
  /** Profile of one peak on its unshifted window, added to buffer `out` (cleared first). */
  const profileOn = (k: number, q: number, peak: PlacedPeak, out: Float64Array) => {
    const w = windows[k] as Int32Array;
    const start = w[2 * q] as number;
    const end = w[2 * q + 1] as number;
    out.fill(0, 0, end - start);
    addProfiles(x.subarray(start, end), [peak], out, Int32Array.of(0, end - start));
    return start;
  };
  let buffer = new Float64Array(0);
  const bufferFor = (length: number) => {
    if (buffer.length < length) buffer = new Float64Array(length);
    return buffer;
  };

  // Structure columns: index of each atom parameter in the gradient of its phase.
  const structureIndex = new Map<number, number>();
  layout.phases.forEach((pl, k) => {
    let g = 0;
    pl.atoms.forEach((al, a) => {
      const atom = (phases[k] as PhaseModel).structure?.atoms[a];
      if (!atom) return;
      [...al.coords, al.occupancy, al.b, ...al.aniso, al.fraction].forEach((j, i) =>
        structureIndex.set(j, g + i),
      );
      g += atomParameterCount(atom);
    });
  });

  input.columns.forEach((j, c) => {
    if (structureIndex.has(j)) return;
    const k0 = input.phaseOf[j] as number;
    const affected = k0 >= 0 ? [k0] : phases.map((_, k) => k);
    const h = input.step(j);
    const cellOf = (k: number) => (layout.phases[k] as Layout['phases'][number]).cell.includes(j);
    const place = (shift: number) => {
      const shifted = params.slice();
      shifted[j] = (params[j] as number) + shift;
      return affected.map((k) =>
        placePeaks(
          phases,
          layout,
          k,
          shifted,
          wavelengths,
          (phases[k] as PhaseModel).structure && cellOf(k) ? undefined : known[k],
        ),
      );
    };
    const fits = (lists: PlacedPeak[][]) =>
      affected.every((k, i) => aligned(peaks[k] as PlacedPeak[], lists[i] as PlacedPeak[]));
    const plus = place(h);
    if (!fits(plus)) {
      fallback.push(j);
      return;
    }
    // Central differences where both sides move; the forward one where a side sits on a bound
    // (for example η = 0 or SH/L = 0, clamped in model.ts), as the whole-pattern difference did.
    const minusLists = place(-h);
    const minus = fits(minusLists) ? minusLists : null;
    const slope = (q0: number, qp: number, qm: number | undefined) =>
      qm === undefined || qm === q0 || qp === q0 ? (qp - q0) / h : (qp - qm) / (2 * h);
    affected.forEach((k, i) => {
      const base = peaks[k] as PlacedPeak[];
      const list = plus[i] as PlacedPeak[];
      const below = minus?.[i];
      const cf = coef[k] as Float64Array;
      const w = windows[k] as Int32Array;
      base.forEach((p, q) => {
        if (empty(k, q)) return;
        const s = list[q] as PlacedPeak;
        const sm = below?.[q];
        const o = (q * nCols + c) * TERMS;
        if (p.fcj || s.fcj || sm?.fcj) {
          if (sameShape(p, s) && (!sm || sameShape(p, sm))) {
            cf[o] = slope(p.area, s.area, sm?.area);
            return;
          }
          // Difference of this peak's profile: (Ω₊ − Ω₋)/2h, or (Ω₊ − Ω₀)/h with Ω₀ added below
          // through the coefficient −A/h.
          const central = sm !== undefined && !sameShape(p, sm);
          const len = (w[2 * q + 1] as number) - (w[2 * q] as number);
          const values = bufferFor(len);
          const start = profileOn(k, q, s, values);
          const add = (factor: number) => {
            for (let t = 0; t < len; t++) {
              const i = start + t;
              jacobian[i * m + j] =
                (jacobian[i * m + j] as number) +
                (values[t] as number) * factor * (sw[i] as number);
            }
          };
          if (central) {
            add(1 / (2 * h));
            profileOn(k, q, sm, values);
            add(-1 / (2 * h));
          } else {
            add(1 / h);
            cf[o] = -p.area / h;
          }
          return;
        }
        cf[o] = slope(p.area, s.area, sm?.area);
        cf[o + 1] = p.area * slope(p.twoTheta, s.twoTheta, sm?.twoTheta);
        cf[o + 2] = p.area * slope(p.fwhm, s.fwhm, sm?.fwhm);
        cf[o + 3] = p.area * slope(p.eta, s.eta, sm?.eta);
        cf[o + 4] = p.area * slope(p.asymmetry[0], s.asymmetry[0], sm?.asymmetry[0]);
        cf[o + 5] = p.area * slope(p.asymmetry[1], s.asymmetry[1], sm?.asymmetry[1]);
      });
    });
  });

  // Exact Σ|F|² gradients, once per reflection that reaches the data. Every peak of a reflection
  // (Kα1, Kα2, width groups) shares them, so they are applied to the sum of its peaks' A/Σ|F|²·Ω.
  const atomColumns = phases.map(() => ({ columns: [] as number[], entries: [] as number[] }));
  const gradients = phases.map(() => new Map<number, Float64Array>());
  phases.forEach((phase, k) => {
    const structure = phase.structure;
    const cols = input.columns.flatMap((j, c) =>
      structureIndex.has(j) && input.phaseOf[j] === k
        ? [[c, structureIndex.get(j) as number] as const]
        : [],
    );
    if (!structure || cols.length === 0 || phase.leBail) return;
    const pl = layout.phases[k] as Layout['phases'][number];
    const states = atomStates(phase, pl, params);
    const own = atomColumns[k] as (typeof atomColumns)[number];
    for (const [c, gi] of cols) {
      own.columns.push(input.columns[c] as number);
      own.entries.push(gi);
    }
    const map = gradients[k] as Map<number, Float64Array>;
    (peaks[k] as PlacedPeak[]).forEach((p, q) => {
      if (empty(k, q) || map.has(p.reflection)) return;
      const reflection = phase.reflections[p.reflection] as PhaseModel['reflections'][number];
      map.set(
        p.reflection,
        structureFactorGradient(structure, states, reflection.members, p.d).gradient,
      );
    });
  });

  // Assembly, peak by peak.
  const active = new Int32Array(nCols);
  const area = new Int32Array(nCols);
  const areaCoef = new Float64Array(nCols);
  const areaColumn = new Int32Array(nCols);
  const shapeCoef = new Float64Array(nCols * TERMS);
  const shapeColumn = new Int32Array(nCols);
  const reflectionOmega = new Float64Array(x.length);
  phases.forEach((_, k) => {
    const base = peaks[k] as PlacedPeak[];
    const cf = coef[k] as Float64Array;
    const w = windows[k] as Int32Array;
    const { columns: atomJ, entries } = atomColumns[k] as (typeof atomColumns)[number];
    const map = gradients[k] as Map<number, Float64Array>;
    const nAtom = atomJ.length;
    let current = -1;
    let lo = 0;
    let hi = 0;
    /** Adds Σ|F|²-gradient × the summed Ω of the reflection collected so far, then clears it. */
    const flush = () => {
      const g = map.get(current);
      if (g)
        for (let i = lo; i < hi; i++) {
          const v = reflectionOmega[i] as number;
          if (v === 0) continue;
          const row = i * m;
          for (let a = 0; a < nAtom; a++) {
            const j = row + (atomJ[a] as number);
            jacobian[j] = (jacobian[j] as number) + (g[entries[a] as number] as number) * v;
          }
        }
      reflectionOmega.fill(0, lo, hi);
      lo = x.length;
      hi = 0;
    };
    base.forEach((p, q) => {
      if (empty(k, q)) return;
      if (p.reflection !== current) {
        flush();
        current = p.reflection;
      }
      const collect = nAtom > 0 && map.has(p.reflection);
      // Columns with only the Ω term (atoms, scale, …) and those that also move the shape.
      let count = 0;
      let areaOnly = 0;
      for (let c = 0; c < nCols; c++) {
        const o = (q * nCols + c) * TERMS;
        let shape = false;
        for (let t = 1; t < TERMS; t++) if (cf[o + t] !== 0) shape = true;
        if (shape) active[count++] = c;
        else if (cf[o] !== 0) area[areaOnly++] = c;
      }
      if (p.fcj) {
        for (let a = 0; a < count; a++) area[areaOnly++] = active[a] as number;
        count = 0;
      }
      if (count === 0 && areaOnly === 0 && !collect) return;
      const start = w[2 * q] as number;
      const end = w[2 * q + 1] as number;
      if (collect) {
        lo = Math.min(lo, start);
        hi = Math.max(hi, end);
      }
      const perMf2 = p.areaPerMf2;
      for (let a = 0; a < areaOnly; a++) {
        const c = area[a] as number;
        areaCoef[a] = cf[(q * nCols + c) * TERMS] as number;
        areaColumn[a] = input.columns[c] as number;
      }
      for (let a = 0; a < count; a++) {
        const c = active[a] as number;
        for (let t = 0; t < TERMS; t++)
          shapeCoef[a * TERMS + t] = cf[(q * nCols + c) * TERMS + t] as number;
        shapeColumn[a] = input.columns[c] as number;
      }
      /** Adds the Ω-only columns at point i, Ω already multiplied by sw[i]. */
      const addArea = (row: number, omega: number) => {
        for (let a = 0; a < areaOnly; a++) {
          const j = row + (areaColumn[a] as number);
          jacobian[j] = (jacobian[j] as number) + (areaCoef[a] as number) * omega;
        }
      };
      if (p.fcj) {
        const shape = bufferFor(end - start);
        profileOn(k, q, { ...p, area: 1 }, shape);
        for (let i = start; i < end; i++) {
          const omega = (shape[i - start] as number) * (sw[i] as number);
          addArea(i * m, omega);
          if (collect) reflectionOmega[i] = (reflectionOmega[i] as number) + perMf2 * omega;
        }
        return;
      }
      const inv = 1 / p.fwhm;
      const lNorm = (2 / Math.PI) * inv;
      const gNorm = 2 * SQRT_LN2_PI * inv;
      const eta = p.eta;
      const [aa, bb] = p.asymmetry;
      for (let i = start; i < end; i++) {
        const u = (x[i] as number) - p.twoTheta;
        const z = u * inv;
        const t2 = 4 * z * z;
        const den = 1 / (1 + t2);
        const l = lNorm * den;
        const g = t2 < 135 ? gNorm * Math.exp(-Math.LN2 * t2) : 0;
        const v = eta * l + (1 - eta) * g;
        const e = Math.exp(-z * z);
        const fa = 2 * z * e;
        const fb = 2 * (2 * z * z - 3) * fa;
        const as = 1 + aa * fa + bb * fb;
        const scale = sw[i] as number;
        const row = i * m;
        const omega = v * as * scale;
        addArea(row, omega);
        if (collect) reflectionOmega[i] = (reflectionOmega[i] as number) + perMf2 * omega;
        if (count === 0) continue;
        // ∂/∂u and ∂/∂H of L and G.
        const lu = -l * 8 * u * inv * inv * den;
        const gu = -g * 8 * Math.LN2 * u * inv * inv;
        const lh = l * inv * (-1 + 2 * t2 * den);
        const gh = g * inv * (-1 + 2 * Math.LN2 * t2);
        const vu = eta * lu + (1 - eta) * gu;
        const vh = eta * lh + (1 - eta) * gh;
        const faz = 2 * e * (1 - 2 * z * z);
        const fbz = 8 * z * fa + 2 * (2 * z * z - 3) * faz;
        const asz = aa * faz + bb * fbz;
        const dT = (-vu * as - v * asz * inv) * scale;
        const dH = (vh * as - v * asz * u * inv * inv) * scale;
        const dEta = (l - g) * as * scale;
        const dA = v * fa * scale;
        const dB = v * fb * scale;
        for (let a = 0; a < count; a++) {
          const o = a * TERMS;
          const j = row + (shapeColumn[a] as number);
          jacobian[j] =
            (jacobian[j] as number) +
            (shapeCoef[o] as number) * omega +
            (shapeCoef[o + 1] as number) * dT +
            (shapeCoef[o + 2] as number) * dH +
            (shapeCoef[o + 3] as number) * dEta +
            (shapeCoef[o + 4] as number) * dA +
            (shapeCoef[o + 5] as number) * dB;
        }
      }
    });
    flush();
  });
  return fallback;
}
