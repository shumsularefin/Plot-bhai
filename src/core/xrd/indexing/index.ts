/*
 * Indexing a powder pattern: suggests unit cells (cubic, tetragonal, hexagonal, orthorhombic,
 * monoclinic, triclinic) that explain 10–20 measured line positions.
 *
 * Every line is written as Q = 1/d² (Å⁻²), which is linear in the cell's reciprocal parameters p:
 *   cubic         Q = A (h² + k² + l²),              A = 1/a²
 *   tetragonal    Q = A (h² + k²) + C l²,            A = 1/a², C = 1/c²
 *   hexagonal     Q = A (h² + hk + k²) + C l²,       A = 4/(3a²), C = 1/c²
 *   orthorhombic  Q = A h² + B k² + C l²,            A = 1/a², B = 1/b², C = 1/c²
 *   monoclinic    Q = A h² + B k² + C l² + E hl,     A = a*², B = b*², C = c*², E = 2a*c* cos β*
 *   triclinic     Q = A h² + B k² + C l² + D kl + E hl + F hk,
 *                 D = 2b*c* cos α*, E = 2a*c* cos β*, F = 2a*b* cos γ*
 * (in general Q = hᵀ G* h, G* the reciprocal metric tensor, the inverse of the direct one).
 * Trial cells of the higher systems come from assigning small indices to one, two or three of
 * the first lines and solving for p. Monoclinic trials take three of the first seven lines as
 * h00, 0k0 and 00l (index 1 or 2) and E from a further line as h0l (h, l = 1 or 2, either sign);
 * triclinic trials take three of the first six lines as 100, 010 and 001 and D, E, F from further
 * lines as 01±1, 10±1 and 1±10 (in the spirit of the zone methods of Ito and of Visser, J. Appl.
 * Cryst. 2 (1969) 89–95). Each trial then indexes all lines within a 2θ tolerance and is refined
 * by linear least squares. Monoclinic and triclinic cells are then reduced (shortest edges, by
 * repeatedly subtracting lattice vectors; β ≥ 90° for monoclinic, all angles acute or all obtuse
 * for triclinic) so equal lattices compare equal. Solutions are ranked by de Wolff's M20 (J. Appl. Cryst. 1 (1968) 108–113):
 *   M_N = Q_N / (2 ε̄ N_calc),
 * Q_N the Q of the N-th observed line, ε̄ the mean |Q_obs − Q_calc| of the N lines and N_calc the
 * number of different calculated Q values up to Q_N; and by Smith and Snyder's F_N (J. Appl.
 * Cryst. 12 (1979) 60–65):
 *   F_N = (1 / mean|Δ2θ|) · N / N_poss,
 * mean|Δ2θ| in degrees and N_poss the number of possible lines up to the N-th observed line.
 * Mean discrepancies below PRECISION (0.001° in 2θ) are raised to it. A solution is a
 * suggestion: several cells can index the same lines.
 */

export type IndexSystem =
  'cubic' | 'tetragonal' | 'hexagonal' | 'orthorhombic' | 'monoclinic' | 'triclinic';
/** Lattice centring: P primitive, I body, F all faces, C the ab face, A the bc face. */
export type Centring = 'P' | 'I' | 'F' | 'C' | 'A';
type Hkl = [number, number, number];

export interface IndexOptions {
  /** X-ray wavelength, Å. */
  wavelength: number;
  /** Largest |2θ_obs − 2θ_calc| (degrees) for a line to count as indexed. */
  tolerance: number;
  systems: IndexSystem[];
  /** Lines among the first ten that may stay unindexed (impurity or noise). */
  maxUnindexed: number;
  /** Largest cell volume tried, Å³. */
  maxVolume: number;
}

export const DEFAULT_INDEXING: IndexOptions = {
  wavelength: 1.5405929,
  tolerance: 0.03,
  systems: ['cubic', 'tetragonal', 'hexagonal', 'orthorhombic', 'monoclinic'],
  maxUnindexed: 1,
  maxVolume: 2500,
};

export interface IndexedLine {
  /** Observed 2θ, degrees. */
  twoTheta: number;
  /** Calculated 2θ of the assigned hkl, degrees, or null when the line is not indexed. */
  calc: number | null;
  hkl: Hkl | null;
}

export interface IndexSolution {
  system: IndexSystem;
  centring: Centring;
  /** Cell edges in Å and angles in degrees. */
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  volume: number;
  /** de Wolff figure of merit over the first N lines (N = 20, or fewer when fewer were given). */
  m20: number;
  /** Smith–Snyder figure of merit, with its mean |Δ2θ| (degrees) and N_poss. */
  fN: number;
  meanDelta: number;
  nPossible: number;
  /** Lines the figures are computed over. */
  n: number;
  lines: IndexedLine[];
  unindexed: number;
}

const RAD = Math.PI / 180;
/** Longest cell edge tried, Å: longer edges give more possible lines than 20 can test. */
const MAX_EDGE = 40;
/**
 * Smallest mean discrepancy (degrees 2θ) used in the figures of merit: measured positions are not
 * more precise than this, and without a floor error-free data would divide by zero.
 */
export const PRECISION = 0.001;
const qOf = (twoTheta: number, lambda: number) =>
  ((2 * Math.sin((twoTheta * RAD) / 2)) / lambda) ** 2;
const twoThetaOf = (q: number, lambda: number) => {
  const s = (lambda * Math.sqrt(q)) / 2;
  return s >= 1 ? NaN : (2 * Math.asin(s)) / RAD;
};

/** Coefficients of p in Q for one hkl. */
function coefficients(system: IndexSystem, [h, k, l]: Hkl): number[] {
  switch (system) {
    case 'cubic':
      return [h * h + k * k + l * l];
    case 'tetragonal':
      return [h * h + k * k, l * l];
    case 'hexagonal':
      return [h * h + h * k + k * k, l * l];
    case 'orthorhombic':
      return [h * h, k * k, l * l];
    case 'monoclinic':
      return [h * h, k * k, l * l, h * l];
    case 'triclinic':
      return [h * h, k * k, l * l, k * l, h * l, h * k];
  }
}

const lowSymmetry = (system: IndexSystem) => system === 'monoclinic' || system === 'triclinic';
type M3 = number[];

/** Reciprocal metric tensor G* (Å⁻², row-major 3×3) from p, so that Q = hᵀ G* h. */
function reciprocalMetric(system: IndexSystem, p: number[]): M3 {
  const [x, y, z, d = 0, e = 0, f = 0] = p as [number, number, number, number?, number?, number?];
  switch (system) {
    case 'cubic':
      return [x, 0, 0, 0, x, 0, 0, 0, x];
    case 'tetragonal':
      return [x, 0, 0, 0, x, 0, 0, 0, y];
    case 'hexagonal':
      return [x, x / 2, 0, x / 2, x, 0, 0, 0, y];
    case 'orthorhombic':
      return [x, 0, 0, 0, y, 0, 0, 0, z];
    case 'monoclinic':
      return [x, 0, d / 2, 0, y, 0, d / 2, 0, z];
    case 'triclinic':
      return [x, f / 2, e / 2, f / 2, y, d / 2, e / 2, d / 2, z];
  }
}

/** p from a reciprocal metric tensor (inverse of reciprocalMetric). */
function paramsOfMetric(system: IndexSystem, g: M3): number[] {
  const [g0, g1, g2, g4, g5, g8] = [0, 1, 2, 4, 5, 8].map((i) => g[i] as number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  switch (system) {
    case 'cubic':
      return [g0];
    case 'tetragonal':
    case 'hexagonal':
      return [g0, g8];
    case 'orthorhombic':
      return [g0, g4, g8];
    case 'monoclinic':
      return [g0, g4, g8, 2 * g2];
    case 'triclinic':
      return [g0, g4, g8, 2 * g5, 2 * g2, 2 * g1];
  }
}

const det3 = (m: M3) => {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
};
/** Inverse of a symmetric 3×3 matrix (adjugate over determinant). */
function inverse3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = det3(m);
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((v) => v / det);
}
/** Sylvester's criterion: a metric tensor must be positive definite. */
const positiveDefinite = (m: M3) =>
  (m[0] as number) > 0 &&
  (m[0] as number) * (m[4] as number) - (m[1] as number) ** 2 > 0 &&
  det3(m) > 0;

interface CellParams {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  volume: number;
}

/** Edges (Å), angles (degrees) and volume (Å³) from the direct metric G = (G*)⁻¹: V = √det G. */
function cellFromDirect(g: M3): CellParams {
  const [a, b, c] = [
    Math.sqrt(g[0] as number),
    Math.sqrt(g[4] as number),
    Math.sqrt(g[8] as number),
  ];
  const ang = (v: number) => Math.acos(Math.max(-1, Math.min(1, v))) / RAD;
  return {
    a,
    b,
    c,
    alpha: ang((g[5] as number) / (b * c)),
    beta: ang((g[2] as number) / (a * c)),
    gamma: ang((g[1] as number) / (a * b)),
    volume: Math.sqrt(det3(g)),
  };
}
const cellParams = (system: IndexSystem, p: number[]) =>
  cellFromDirect(inverse3(reciprocalMetric(system, p)));

const allowed = (centring: Centring, [h, k, l]: Hkl) =>
  centring === 'P' ||
  (centring === 'I' && (h + k + l) % 2 === 0) ||
  (centring === 'C' && (h + k) % 2 === 0) ||
  (centring === 'A' && (k + l) % 2 === 0) ||
  (centring === 'F' && (h + k) % 2 === 0 && (k + l) % 2 === 0);

const CENTRINGS: Record<IndexSystem, Centring[]> = {
  cubic: ['P', 'I', 'F'],
  tetragonal: ['P', 'I'],
  hexagonal: ['P'],
  orthorhombic: ['P', 'C', 'I', 'F'],
  monoclinic: ['P', 'C', 'A', 'I'],
  triclinic: ['P'],
};

/** Cell edges (Å) from the reciprocal parameters p. */
function cellOf(system: IndexSystem, p: number[]): [number, number, number] {
  const c = cellParams(system, p);
  return [c.a, c.b, c.c];
}

interface CalcLine {
  q: number;
  hkl: Hkl;
}

/** Calculated lines (one hkl per distinct Q, smallest indices first) with Q ≤ qMax. */
function calculated(
  system: IndexSystem,
  p: number[],
  centring: Centring,
  qMax: number,
): CalcLine[] {
  const [a, b, c] = cellOf(system, p);
  // h = H·a for the reciprocal vector H of hkl, so |h| ≤ |H| a = a √Q (and likewise k, l).
  const lim = (edge: number) => Math.floor(edge * Math.sqrt(qMax)) + 1;
  // Friedel pairs (hkl and −h−k−l) have the same Q; signs are needed where Q has cross terms.
  const range = (m: number, signed: boolean) =>
    Array.from({ length: signed ? 2 * m + 1 : m + 1 }, (_, i) =>
      signed ? (i % 2 === 0 ? -i / 2 : (i + 1) / 2) : i,
    );
  const hs = range(lim(a), lowSymmetry(system));
  const ks = range(lim(b), system === 'triclinic');
  const ls = range(lim(c), false);
  const out: CalcLine[] = [];
  for (const h of hs)
    for (const k of ks)
      for (const l of ls) {
        if (h === 0 && k === 0 && l === 0) continue;
        // With l = 0 the pair (h, k, 0) and (−h, −k, 0) is already covered once.
        if (l === 0 && (k < 0 || (k === 0 && h < 0))) continue;
        const hkl: Hkl = [h, k, l];
        if (!allowed(centring, hkl)) continue;
        const q = coefficients(system, hkl).reduce((s, v, i) => s + v * (p[i] as number), 0);
        if (q <= qMax) out.push({ q, hkl });
      }
  out.sort((x, y) => x.q - y.q);
  const distinct: CalcLine[] = [];
  for (const line of out) {
    const last = distinct[distinct.length - 1];
    if (last && Math.abs(line.q - last.q) <= 1e-9 * line.q) continue;
    distinct.push(line);
  }
  return distinct;
}

/** Nearest calculated line to each observation within its Q tolerance, or null. */
function assign(qObs: number[], tolQ: number[], calc: CalcLine[]): (CalcLine | null)[] {
  return qObs.map((q, i) => {
    let best: CalcLine | null = null;
    for (const line of calc) {
      const d = Math.abs(line.q - q);
      if (d <= (tolQ[i] as number) && (!best || d < Math.abs(best.q - q))) best = line;
      if (line.q > q + (tolQ[i] as number)) break;
    }
    return best;
  });
}

/** Solves the small linear system M p = v (Gaussian elimination with pivoting); null if singular. */
function solve(m: number[][], v: number[]): number[] | null {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i] as number]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(a[r]?.[col] as number) > Math.abs(a[piv]?.[col] as number)) piv = r;
    const pr = a[piv] as number[];
    if (Math.abs(pr[col] as number) < 1e-12) return null;
    [a[col], a[piv]] = [pr, a[col] as number[]];
    const row = a[col] as number[];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const other = a[r] as number[];
      const f = (other[col] as number) / (row[col] as number);
      for (let j = col; j <= n; j++) other[j] = (other[j] as number) - f * (row[j] as number);
    }
  }
  return a.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** Least-squares p from indexed lines: minimises Σ (Q_obs − p·coef)². */
function refine(system: IndexSystem, qObs: number[], hits: (CalcLine | null)[]): number[] | null {
  const n = coefficients(system, [1, 0, 0]).length;
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);
  hits.forEach((hit, i) => {
    if (!hit) return;
    const c = coefficients(system, hit.hkl);
    for (let r = 0; r < n; r++) {
      atb[r] = (atb[r] as number) + (c[r] as number) * (qObs[i] as number);
      for (let s = 0; s < n; s++)
        (ata[r] as number[])[s] =
          ((ata[r] as number[])[s] as number) + (c[r] as number) * (c[s] as number);
    }
  });
  const p = solve(ata, atb);
  return p && positiveDefinite(reciprocalMetric(system, p)) ? p : null;
}

/** Index basis for trial assignments: distinct coefficient vectors from small hkl. */
function trialBasis(system: IndexSystem): number[][] {
  const max = system === 'cubic' ? 4 : system === 'orthorhombic' ? 2 : 3;
  const seen = new Map<string, number[]>();
  for (let h = 0; h <= max; h++)
    for (let k = 0; k <= max; k++)
      for (let l = 0; l <= max; l++) {
        if (h + k + l === 0) continue;
        const c = coefficients(system, [h, k, l]);
        seen.set(c.join(','), c);
      }
  return [...seen.values()];
}

function combinations(n: number, r: number): number[][] {
  if (r === 0) return [[]];
  const out: number[][] = [];
  for (let i = 0; i <= n - r; i++)
    for (const rest of combinations(n - i - 1, r - 1)) out.push([i, ...rest.map((j) => j + i + 1)]);
  return out;
}

/** Figures of merit and line list for refined parameters and a centring. */
function evaluate(
  system: IndexSystem,
  centring: Centring,
  p: number[],
  twoTheta: number[],
  qObs: number[],
  tolQ: number[],
  lambda: number,
): IndexSolution | null {
  const n = Math.min(20, twoTheta.length);
  const qN = qObs[n - 1] as number;
  const calc = calculated(system, p, centring, (qObs[qObs.length - 1] as number) * 1.02);
  const hits = assign(qObs, tolQ, calc);
  const firstN = hits.slice(0, n);
  const indexedN = firstN.filter((h) => h !== null).length;
  if (indexedN === 0) return null;
  let sumQ = 0;
  let sum2t = 0;
  let floorQ = 0;
  firstN.forEach((hit, i) => {
    if (!hit) return;
    sumQ += Math.abs((qObs[i] as number) - hit.q);
    sum2t += Math.abs((twoTheta[i] as number) - twoThetaOf(hit.q, lambda));
    floorQ +=
      ((qObs[i] as number) / Math.tan(((twoTheta[i] as number) * RAD) / 2)) * PRECISION * RAD;
  });
  const nCalc = calc.filter((line) => line.q <= qN * (1 + 1e-9)).length;
  const meanQ = Math.max(sumQ, floorQ) / indexedN;
  const meanDelta = Math.max(sum2t / indexedN, PRECISION);
  return {
    system,
    centring,
    ...cellParams(system, p),
    m20: qN / (2 * meanQ * nCalc),
    fN: (1 / meanDelta) * (n / nCalc),
    meanDelta,
    nPossible: nCalc,
    n,
    lines: twoTheta.map((t, i) => {
      const hit = hits[i];
      return {
        twoTheta: t,
        calc: hit ? twoThetaOf(hit.q, lambda) : null,
        hkl: hit ? hit.hkl : null,
      };
    }),
    unindexed: hits.filter((h) => h === null).length,
  };
}

/**
 * Suggested cells for the given line positions (2θ, degrees; 10–20 lines, any order), best
 * first by M20. `onProgress` reports the fraction of trials done.
 */
export function indexPattern(
  positions: readonly number[],
  options: IndexOptions = DEFAULT_INDEXING,
  onProgress?: (fraction: number) => void,
): IndexSolution[] {
  const twoTheta = [...positions].sort((x, y) => x - y);
  const lambda = options.wavelength;
  const qObs = twoTheta.map((t) => qOf(t, lambda));
  // dQ/d(2θ) = Q cot θ per radian of 2θ.
  const tolQ = twoTheta.map(
    (t, i) => ((qObs[i] as number) / Math.tan((t * RAD) / 2)) * options.tolerance * RAD,
  );
  const first = Math.min(10, qObs.length);
  const solutions: IndexSolution[] = [];

  const jobs = options.systems.map((system) => {
    const nPar = coefficients(system, [1, 0, 0]).length;
    const base = {
      cubic: 3,
      tetragonal: 6,
      hexagonal: 6,
      orthorhombic: 5,
      monoclinic: 7,
      triclinic: 6,
    };
    // Monoclinic trials start from three base lines; triclinic ones from pairs of zones.
    // Monoclinic trials start from three base lines and then, like triclinic ones, from pairs
    // of zones (refined as triclinic and kept when two angles are right).
    const zones = lowSymmetry(system) ? triclinicZones(qObs, tolQ) : [];
    const own =
      system === 'triclinic'
        ? []
        : combinations(Math.min(base[system], qObs.length), system === 'monoclinic' ? 3 : nPar);
    const lines = [...own, ...zonePairs(zones)];
    const baseCount = own.length;
    return { system, nPar, lines, baseCount, zones, basis: trialBasis(system) };
  });
  const total = jobs.reduce((s, j) => s + j.lines.length, 0);
  let done = 0;

  for (const { system, nPar, lines, baseCount, zones, basis } of jobs) {
    const seen = new Set<string>();
    const seenTriclinic = new Set<string>();
    const fits = (sys: IndexSystem, p: number[]) => {
      const cell = cellParams(sys, p);
      return (
        Math.min(cell.a, cell.b, cell.c) >= 1.5 &&
        Math.max(cell.a, cell.b, cell.c) <= MAX_EDGE &&
        cell.volume <= options.maxVolume
      );
    };
    /** Reduced, quick-tested and least-squares refined parameters of a trial, or null. */
    const prepare = (sys: IndexSystem, trial: number[], keys: Set<string>) => {
      if (!positiveDefinite(reciprocalMetric(sys, trial))) return null;
      // Reduced first, so equal lattices share one key and the hkl search stays small.
      const p = reduceCell(sys, trial);
      if (!fits(sys, p)) return null;
      const key = p.map((v) => v.toPrecision(3)).join(',');
      if (keys.has(key)) return null;
      keys.add(key);
      // Quick test on the first lines before refining.
      let misses = 0;
      for (let i = 0; i < first && misses <= options.maxUnindexed; i++)
        if (!indexable(sys, p, qObs[i] as number, tolQ[i] as number)) misses++;
      if (misses > options.maxUnindexed || higherMetric(sys, p)) return null;
      let refined: number[] | null = p;
      for (let pass = 0; pass < 3 && refined; pass++) {
        const calc = calculated(sys, refined, 'P', (qObs[qObs.length - 1] as number) * 1.02);
        refined = refine(sys, qObs, assign(qObs, tolQ, calc));
      }
      if (!refined) return null;
      refined = reduceCell(sys, refined);
      return fits(sys, refined) && !higherMetric(sys, refined) ? refined : null;
    };
    const consider = (trial: number[]) => {
      const refined = prepare(system, trial, seen);
      if (!refined) return;
      for (const centring of CENTRINGS[system]) {
        const s = evaluate(system, centring, refined, twoTheta, qObs, tolQ, lambda);
        if (
          s &&
          s.lines.slice(0, first).filter((l) => l.hkl === null).length <= options.maxUnindexed
        )
          solutions.push(s);
      }
    };
    const viaTriclinic = (trial: number[]) => {
      const refined = prepare('triclinic', trial, seenTriclinic);
      const p = refined && monoclinicOf(refined);
      if (p) consider(p);
    };
    for (const [step, chosen] of lines.entries()) {
      onProgress?.(done++ / total);
      if (step >= baseCount) {
        triclinicTrials(qObs, zones, chosen, system === 'triclinic' ? consider : viaTriclinic);
        continue;
      }
      if (system === 'monoclinic') {
        monoclinicTrials(qObs, chosen, consider);
        continue;
      }
      const tuples = combinations(basis.length + nPar - 1, nPar); // multisets via stars and bars
      for (const t of tuples) {
        const rows = t.map((v, i) => basis[v - i] as number[]);
        // Assign the chosen lines (in order of Q) to every ordering of the basis vectors.
        for (const order of permutations(nPar)) {
          const m = order.map((o) => rows[o] as number[]);
          const p = solve(
            m,
            chosen.map((i) => qObs[i] as number),
          );
          if (p) consider(p);
        }
      }
    }
  }
  onProgress?.(1);
  return rank(solutions);
}

/** True when some hkl (primitive lattice) has |Q_calc − q| ≤ tol; no allocation, for the trial loop. */
function indexable(system: IndexSystem, p: number[], q: number, tol: number): boolean {
  if (lowSymmetry(system)) return indexableGeneral(reciprocalMetric(system, p), q, tol);
  const [x, y, z] = p as [number, number, number];
  if (system === 'cubic') {
    const n = Math.round(q / x);
    return n > 0 && Math.abs(q - n * x) <= tol;
  }
  const last = system === 'orthorhombic' ? z : y;
  const hMax = Math.floor(Math.sqrt((q + tol) / x)) + 1;
  for (let h = 0; h <= hMax; h++) {
    const kMax = system === 'orthorhombic' ? Math.floor(Math.sqrt((q + tol) / y)) : hMax;
    for (let k = 0; k <= kMax; k++) {
      const plane =
        system === 'orthorhombic'
          ? x * h * h + y * k * k
          : x * (system === 'hexagonal' ? h * h + h * k + k * k : h * h + k * k);
      const rest = q - plane;
      if (rest < -tol) break;
      const l = Math.round(Math.sqrt(Math.max(rest, 0) / last));
      if (h + k + l > 0 && Math.abs(rest - l * l * last) <= tol) return true;
    }
  }
  return false;
}

/**
 * indexable for any metric: for each h, k within the bounds |h| ≤ a √Q, |k| ≤ b √Q, Q(l) is a
 * quadratic in l, so only the integers next to its roots and its vertex can come within tol.
 */
function indexableGeneral(g: M3, q: number, tol: number): boolean {
  const [g0, g1, g2, g4, g5, g8] = [0, 1, 2, 4, 5, 8].map((i) => g[i] as number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const direct = inverse3(g);
  const hm = Math.floor(Math.sqrt((direct[0] as number) * (q + tol))) + 1;
  const km = Math.floor(Math.sqrt((direct[4] as number) * (q + tol))) + 1;
  for (let h = -hm; h <= hm; h++)
    for (let k = -km; k <= km; k++) {
      const b = 2 * (g2 * h + g5 * k);
      const c0 = g0 * h * h + g4 * k * k + 2 * g1 * h * k;
      const vertex = -b / (2 * g8);
      const disc = b * b - 4 * g8 * (c0 - q);
      const roots =
        disc >= 0 ? [vertex - Math.sqrt(disc) / (2 * g8), vertex + Math.sqrt(disc) / (2 * g8)] : [];
      for (const r of [vertex, ...roots]) {
        const l = Math.round(r);
        if (h === 0 && k === 0 && l === 0) continue;
        if (Math.abs(c0 + b * l + g8 * l * l - q) <= tol) return true;
      }
    }
  return false;
}

/** ±(Q − fixed)/scale for each of the lines, kept when below limit in size (a valid metric). */
function crossTerms(qs: number[], fixed: number, scale: number, limit: number): number[] {
  const out = new Set<number>();
  for (const q of qs) {
    const v = (q - fixed) / scale;
    if (Math.abs(v) < limit) out.add(v).add(-v);
  }
  return [...out];
}

/**
 * Monoclinic trials for three base lines (indices into qObs), passed to `emit`: in turn each base
 * line is taken as 0k0 (k = 1, 2) or as 110 and the other two as h00 and 00l (index 1 or 2), and
 * E = ±(Q − h²A − l²C)/(hl) from each of the first twelve other lines as h0l, h, l ∈ {1, 2}.
 * Taking b* from a 110 line covers C-centred cells, whose 100 and 010 lines are absent.
 */
function monoclinicTrials(qObs: number[], chosen: number[], emit: (p: number[]) => void): void {
  const others = qObs.slice(0, 12).filter((_, i) => !chosen.includes(i));
  const [q1, q2, q3] = chosen.map((i) => qObs[i] as number) as [number, number, number];
  const orders: [number, number, number][] = [
    [q1, q2, q3],
    [q2, q1, q3],
    [q1, q3, q2],
  ];
  const hl: [number, number][] = [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ];
  for (const [qa, qb, qc] of orders)
    for (const ia of [1, 2])
      for (const ic of [1, 2]) {
        const [a, c] = [qa / (ia * ia), qc / (ic * ic)];
        // b* from qb as 010, 020 or 110.
        for (const b of [qb, qb / 4, qb - a]) {
          if (!(b > 0)) continue;
          for (const [h, l] of hl)
            for (const e of crossTerms(others, h * h * a + l * l * c, h * l, 2 * Math.sqrt(a * c)))
              emit([a, b, c, e]);
        }
      }
}

interface Zone {
  /** Lines (indices into qObs) taken as the zone axes 10 and 01. */
  i: number;
  j: number;
  /** Cross term R in Q = h²Q_i + k²Q_j + hkR (Å⁻²). */
  r: number;
  /** Lines among the first twenty that the zone indexes with |h|, |k| ≤ 4. */
  score: number;
}

/**
 * Candidate zones (two-dimensional reciprocal lattices, after Ito and Visser): two of the first
 * eight lines as axes and R = ±(Q − h²Q_i − k²Q_j)/(hk) from another of the first twenty lines as
 * 11, 12 or 21. The forty that index the most lines are kept.
 */
function triclinicZones(qObs: number[], tolQ: number[]): Zone[] {
  const n = Math.min(20, qObs.length);
  const zones = new Map<string, Zone>();
  for (let i = 0; i < Math.min(8, n); i++)
    for (let j = i + 1; j < Math.min(8, n); j++) {
      const [a, b] = [qObs[i] as number, qObs[j] as number];
      const others = qObs.slice(0, n).filter((_, m) => m !== i && m !== j);
      for (const [h, k] of [
        [1, 1],
        [1, 2],
        [2, 1],
      ] as [number, number][])
        for (const r of crossTerms(others, h * h * a + k * k * b, h * k, 2 * Math.sqrt(a * b))) {
          const key = `${i},${j},${r.toPrecision(3)}`;
          if (zones.has(key)) continue;
          let score = 0;
          for (let m = 0; m < n; m++) {
            const q = qObs[m] as number;
            let hit = false;
            for (let x = 0; x <= 4 && !hit; x++)
              for (let y = -4; y <= 4 && !hit; y++)
                if (
                  (x > 0 || y > 0) &&
                  Math.abs(x * x * a + y * y * b + x * y * r - q) <= (tolQ[m] as number)
                )
                  hit = true;
            if (hit) score++;
          }
          zones.set(key, { i, j, r, score });
        }
    }
  return [...zones.values()].sort((x, y) => y.score - x.score).slice(0, 40);
}

/** Pairs of zones (indices) that share exactly one axis line and so span three dimensions. */
function zonePairs(zones: Zone[]): number[][] {
  const out: number[][] = [];
  zones.forEach((z1, u) =>
    zones.forEach((z2, v) => {
      if (v <= u) return;
      const shared = [z1.i, z1.j].filter((x) => x === z2.i || x === z2.j);
      if (shared.length === 1) out.push([u, v]);
    }),
  );
  return out;
}

/**
 * Triclinic trials from two zones sharing an axis: the shared line as 100, the other axes as 010
 * and 001, F and ±E from the zones (the relative sign of the two zones is unknown), and
 * D = (Q − Ah² − Bk² − Cl² − Fhk − Ehl)/(kl) from each of the first twenty lines as h, ±1, 1 with
 * h ∈ {−1, 0, 1}.
 */
function triclinicTrials(
  qObs: number[],
  zones: Zone[],
  pair: number[],
  emit: (p: number[]) => void,
): void {
  const [z1, z2] = pair.map((i) => zones[i] as Zone) as [Zone, Zone];
  const common = z1.i === z2.i || z1.i === z2.j ? z1.i : z1.j;
  const other = (z: Zone) => (z.i === common ? z.j : z.i);
  const [a, b, c] = [common, other(z1), other(z2)].map((i) => qObs[i] as number) as [
    number,
    number,
    number,
  ];
  const limit = 2 * Math.sqrt(b * c);
  for (const e of [z2.r, -z2.r]) {
    const f = z1.r;
    const ds = new Set<number>();
    for (const q of qObs.slice(0, 20))
      for (const h of [-1, 0, 1])
        for (const k of [-1, 1]) {
          const d = (q - a * h * h - b - c - f * h * k - e * h) / k;
          if (Math.abs(d) < limit) ds.add(d);
        }
    for (const d of ds) emit([a, b, c, d, e, f]);
  }
}

/**
 * Monoclinic parameters (b unique) of a triclinic cell whose metric has two right angles
 * (|cos| ≤ 0.01, about 0.6°), the axis between them becoming b; null otherwise.
 */
function monoclinicOf(p: number[]): number[] | null {
  const { a, b, c, alpha, beta, gamma } = cellParams('triclinic', p);
  const right = (x: number) => Math.abs(Math.cos(x * RAD)) <= 0.01;
  if (right(alpha) && right(gamma)) return paramsOf('monoclinic', [a, b, c, 90, beta, 90]);
  if (right(alpha) && right(beta)) return paramsOf('monoclinic', [a, c, b, 90, gamma, 90]);
  if (right(beta) && right(gamma)) return paramsOf('monoclinic', [b, a, c, 90, alpha, 90]);
  return null;
}

/**
 * Reduces a monoclinic or triclinic cell: lattice vectors (rows of integer combinations of the
 * axes) are shortened by subtracting other vectors (v_k + s_i v_i + s_j v_j, s ∈ {−1, 0, 1}, and
 * the nearest-integer multiple of each other vector) until none gets shorter, then sorted by
 * length (monoclinic: only a and c, in the plane normal to b). Signs are then chosen so that β ≥
 * 90° (monoclinic) or the three angles are all acute or all obtuse (triclinic). The lattice and
 * every Q are unchanged; only its description is.
 */
function reduceCell(system: IndexSystem, p: number[]): number[] {
  if (!lowSymmetry(system)) return p;
  const g = inverse3(reciprocalMetric(system, p));
  const dot = (u: number[], v: number[]) => {
    let s = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        s += (u[i] as number) * (g[i * 3 + j] as number) * (v[j] as number);
    return s;
  };
  const add = (u: number[], v: number[], f: number) => u.map((x, i) => x + f * (v[i] as number));
  let t = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const free = system === 'monoclinic' ? [0, 2] : [0, 1, 2];
  for (let pass = 0, changed = true; changed && pass < 100; pass++) {
    changed = false;
    for (const k of free)
      for (const i of free) {
        if (i === k) continue;
        const r = Math.round(
          dot(t[k] as number[], t[i] as number[]) / dot(t[i] as number[], t[i] as number[]),
        );
        if (r !== 0) {
          t[k] = add(t[k] as number[], t[i] as number[], -r);
          changed = true;
        }
      }
    if (system === 'triclinic')
      for (const k of free) {
        const [i, j] = free.filter((x) => x !== k) as [number, number];
        for (const si of [-1, 1])
          for (const sj of [-1, 1]) {
            const v = add(add(t[k] as number[], t[i] as number[], si), t[j] as number[], sj);
            if (dot(v, v) < dot(t[k] as number[], t[k] as number[]) * (1 - 1e-9)) {
              t[k] = v;
              changed = true;
            }
          }
      }
  }
  const len = (v: number[]) => dot(v, v);
  if (system === 'monoclinic') {
    if (len(t[0] as number[]) > len(t[2] as number[])) t = [t[2], t[1], t[0]] as number[][];
    if (dot(t[0] as number[], t[2] as number[]) > 0) t[0] = (t[0] as number[]).map((x) => -x);
  } else {
    t.sort((u, v) => len(u) - len(v));
    const flip = (i: number) => (t[i] = (t[i] as number[]).map((x) => -x));
    const cos = (i: number, j: number) => dot(t[i] as number[], t[j] as number[]);
    const acute = cos(0, 1) * cos(0, 2) * cos(1, 2) > 0;
    if (acute ? cos(0, 1) < 0 : cos(0, 1) > 0) flip(1);
    if (acute ? cos(0, 2) < 0 : cos(0, 2) > 0) flip(2);
  }
  const gNew = [0, 1, 2].flatMap((i) =>
    [0, 1, 2].map((j) => dot(t[i] as number[], t[j] as number[])),
  );
  return paramsOfMetric(system, inverse3(gNew));
}

/**
 * True when a cell's metric belongs to a higher symmetry, so the higher-symmetry search covers it:
 * a tetragonal cell with c/a = 1 or √2 (the second is a face-centred cubic lattice described as
 * body-centred tetragonal); an orthorhombic cell with two edges in the ratio 1, √2 (a tetragonal
 * lattice) or √3 (the orthohexagonal description of a hexagonal lattice); a monoclinic cell with β
 * = 90°; a triclinic cell with all angles 90°. Ratios and cosines are compared to 0.2 %.
 */
function higherMetric(system: IndexSystem, p: number[]): boolean {
  const { a, b, c, alpha, beta, gamma } = cellParams(system, p);
  const ratio = (u: number, v: number, r: number) =>
    Math.abs(Math.max(u, v) / Math.min(u, v) - r) <= 2e-3 * r;
  const special = (u: number, v: number, list: number[]) => list.some((r) => ratio(u, v, r));
  const right = (angle: number) => Math.abs(Math.cos(angle * RAD)) <= 2e-3;
  if (system === 'tetragonal') return special(a, c, [1, Math.SQRT2]);
  if (system === 'orthorhombic') {
    const list = [1, Math.SQRT2, Math.sqrt(3)];
    return special(a, b, list) || special(b, c, list) || special(a, c, list);
  }
  if (system === 'monoclinic') return right(beta);
  if (system === 'triclinic') return right(alpha) && right(beta) && right(gamma);
  return false;
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  return permutations(n - 1).flatMap((p) =>
    Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]),
  );
}

const close = (x: number, y: number, rel = 2e-3) => Math.abs(x - y) <= rel * Math.max(x, y);
const sameCell = (s: IndexSolution, t: IndexSolution) => {
  const e1 = [s.a, s.b, s.c].sort((x, y) => x - y);
  const e2 = [t.a, t.b, t.c].sort((x, y) => x - y);
  return close(s.volume, t.volume) && e1.every((v, i) => close(v, e2[i] as number));
};

const SYMMETRY: IndexSystem[] = [
  'triclinic',
  'monoclinic',
  'orthorhombic',
  'tetragonal',
  'hexagonal',
  'cubic',
];
/** See rank. */
const SYMMETRY_MARGIN = 2;
const POINTS: Record<Centring, number> = { P: 1, A: 2, C: 2, I: 2, F: 4 };
/**
 * Two solutions describe one lattice when their volumes per lattice point agree to 0.2 % and the
 * lines both index have the same calculated 2θ (to 0.02°), at most two lines being indexed by only
 * one of them; for example a monoclinic C cell and the triclinic primitive cell of its lattice.
 */
function sameLattice(s: IndexSolution, t: IndexSolution): boolean {
  if (!close(s.volume / POINTS[s.centring], t.volume / POINTS[t.centring])) return false;
  let differ = 0;
  for (const [i, l] of s.lines.entries()) {
    const o = t.lines[i]?.calc ?? null;
    if (l.calc === null || o === null) differ += l.calc === o ? 0 : 1;
    else if (Math.abs(l.calc - o) > 0.02) return false;
  }
  return differ <= 2;
}

/**
 * Best first by fewest unindexed lines, then M20. Duplicates (the same cell edges in any order
 * and the same volume) keep the best. One lattice found in several systems is reported in the
 * highest of them (a lower-symmetry cell fits slightly better only because it has more
 * parameters), at the place of its best description. Finally a cell of higher symmetry moves
 * above a lower-symmetry one with as many unindexed lines unless that one's M20 is at least
 * SYMMETRY_MARGIN times higher: lower-symmetry cells, with more parameters, can index noisy lines
 * of a high-symmetry pattern by chance (a ranking choice of this app, not a published rule).
 */
function rank(all: IndexSolution[]): IndexSolution[] {
  const sorted = [...all].sort((x, y) => x.unindexed - y.unindexed || y.m20 - x.m20);
  const kept: IndexSolution[] = [];
  for (const s of sorted) {
    const twin = kept.findIndex((k) => sameCell(k, s) || sameLattice(k, s));
    if (twin >= 0) {
      const k = kept[twin] as IndexSolution;
      if (SYMMETRY.indexOf(s.system) > SYMMETRY.indexOf(k.system)) kept[twin] = s;
      continue;
    }
    kept.push(s);
    if (kept.length >= 10) break;
  }
  const level = (x: IndexSolution) => SYMMETRY.indexOf(x.system);
  for (let i = 1; i < kept.length; i++)
    for (let j = i; j > 0; j--) {
      const [up, down] = [kept[j] as IndexSolution, kept[j - 1] as IndexSolution];
      if (
        up.unindexed !== down.unindexed ||
        level(up) <= level(down) ||
        down.m20 >= SYMMETRY_MARGIN * up.m20
      )
        break;
      [kept[j - 1], kept[j]] = [up, down];
    }
  return kept;
}

/**
 * Reciprocal parameters p of a cell: edges (Å) and, for monoclinic and triclinic, angles
 * (degrees; defaults 90°, hexagonal γ = 120°), through G* = G⁻¹.
 */
function paramsOf(system: IndexSystem, cell: number[]): number[] {
  const [a, b, c] = cell as [number, number, number];
  const hex = system === 'hexagonal';
  const [al, be, ga] = [cell[3] ?? 90, cell[4] ?? 90, cell[5] ?? (hex ? 120 : 90)].map(
    (x) => x * RAD,
  ) as [number, number, number];
  const g = [
    a * a,
    a * b * Math.cos(ga),
    a * c * Math.cos(be),
    a * b * Math.cos(ga),
    b * b,
    b * c * Math.cos(al),
    a * c * Math.cos(be),
    b * c * Math.cos(al),
    c * c,
  ];
  return paramsOfMetric(system, inverse3(g));
}

/**
 * Indexes the lines with a given cell (no refinement) and returns its figures of merit, for
 * checking a cell from elsewhere: edges a, b, c (Å) and, for monoclinic and triclinic, α, β, γ
 * (degrees). Null when no line is indexed.
 */
export function evaluateCell(
  system: IndexSystem,
  centring: Centring,
  cell: number[],
  positions: readonly number[],
  options: Pick<IndexOptions, 'wavelength' | 'tolerance'> = DEFAULT_INDEXING,
): IndexSolution | null {
  const twoTheta = [...positions].sort((x, y) => x - y);
  const qObs = twoTheta.map((t) => qOf(t, options.wavelength));
  const tolQ = twoTheta.map(
    (t, i) => ((qObs[i] as number) / Math.tan((t * RAD) / 2)) * options.tolerance * RAD,
  );
  return evaluate(
    system,
    centring,
    paramsOf(system, cell),
    twoTheta,
    qObs,
    tolQ,
    options.wavelength,
  );
}
