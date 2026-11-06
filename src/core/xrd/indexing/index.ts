/*
 * Indexing a powder pattern: suggests unit cells (cubic, tetragonal, hexagonal, orthorhombic)
 * that explain 10–20 measured line positions.
 *
 * Every line is written as Q = 1/d² (Å⁻²), which is linear in the cell's reciprocal parameters p:
 *   cubic         Q = A (h² + k² + l²),              A = 1/a²
 *   tetragonal    Q = A (h² + k²) + C l²,            A = 1/a², C = 1/c²
 *   hexagonal     Q = A (h² + hk + k²) + C l²,       A = 4/(3a²), C = 1/c²
 *   orthorhombic  Q = A h² + B k² + C l²,            A = 1/a², B = 1/b², C = 1/c²
 * Trial cells come from assigning small indices to one, two or three of the first lines and
 * solving for p; each trial then indexes all lines within a 2θ tolerance and is refined by linear
 * least squares. Solutions are ranked by de Wolff's M20 (J. Appl. Cryst. 1 (1968) 108–113):
 *   M_N = Q_N / (2 ε̄ N_calc),
 * Q_N the Q of the N-th observed line, ε̄ the mean |Q_obs − Q_calc| of the N lines and N_calc the
 * number of different calculated Q values up to Q_N; and by Smith and Snyder's F_N (J. Appl.
 * Cryst. 12 (1979) 60–65):
 *   F_N = (1 / mean|Δ2θ|) · N / N_poss,
 * mean|Δ2θ| in degrees and N_poss the number of possible lines up to the N-th observed line.
 * Mean discrepancies below PRECISION (0.001° in 2θ) are raised to it. A solution is a
 * suggestion: several cells can index the same lines.
 */

export type IndexSystem = 'cubic' | 'tetragonal' | 'hexagonal' | 'orthorhombic';
/** Lattice centring: P primitive, I body, F all faces, C the ab face. */
export type Centring = 'P' | 'I' | 'F' | 'C';
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
  systems: ['cubic', 'tetragonal', 'hexagonal', 'orthorhombic'],
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
  /** Cell edges in Å (angles follow from the system). */
  a: number;
  b: number;
  c: number;
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
  }
}

const allowed = (centring: Centring, [h, k, l]: Hkl) =>
  centring === 'P' ||
  (centring === 'I' && (h + k + l) % 2 === 0) ||
  (centring === 'C' && (h + k) % 2 === 0) ||
  (centring === 'F' && (h + k) % 2 === 0 && (k + l) % 2 === 0);

const CENTRINGS: Record<IndexSystem, Centring[]> = {
  cubic: ['P', 'I', 'F'],
  tetragonal: ['P', 'I'],
  hexagonal: ['P'],
  orthorhombic: ['P', 'C', 'I', 'F'],
};

/** Cell edges (Å) from the reciprocal parameters p. */
function cellOf(system: IndexSystem, p: number[]): [number, number, number] {
  const [x, y, z] = p as [number, number, number];
  switch (system) {
    case 'cubic':
      return [1 / Math.sqrt(x), 1 / Math.sqrt(x), 1 / Math.sqrt(x)];
    case 'tetragonal':
      return [1 / Math.sqrt(x), 1 / Math.sqrt(x), 1 / Math.sqrt(y)];
    case 'hexagonal':
      return [2 / Math.sqrt(3 * x), 2 / Math.sqrt(3 * x), 1 / Math.sqrt(y)];
    case 'orthorhombic':
      return [1 / Math.sqrt(x), 1 / Math.sqrt(y), 1 / Math.sqrt(z)];
  }
}

const volumeOf = (system: IndexSystem, [a, , c]: number[], b: number) =>
  system === 'hexagonal'
    ? ((a as number) ** 2 * (c as number) * Math.sqrt(3)) / 2
    : (a as number) * b * (c as number);

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
  // 1/d ≥ h / a for these orthogonal-axis forms (and ≥ h·√3/2 / a for hexagonal), so h ≤ a √Qmax / (√3/2).
  const lim = (edge: number) =>
    Math.floor((edge * Math.sqrt(qMax)) / (system === 'hexagonal' ? Math.sqrt(3) / 2 : 1)) + 1;
  const [hm, km, lm] = [lim(a), lim(b), Math.floor(c * Math.sqrt(qMax)) + 1];
  const out: CalcLine[] = [];
  for (let h = 0; h <= hm; h++)
    for (let k = 0; k <= km; k++)
      for (let l = 0; l <= lm; l++) {
        if (h + k + l === 0) continue;
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
  return p && p.every((v) => v > 0) ? p : null;
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
  const [a, b, c] = cellOf(system, p);
  return {
    system,
    centring,
    a,
    b,
    c,
    volume: volumeOf(system, [a, b, c], b),
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
    const lines = combinations(
      Math.min(system === 'cubic' ? 3 : system === 'orthorhombic' ? 5 : 6, qObs.length),
      nPar,
    );
    return { system, nPar, lines, basis: trialBasis(system) };
  });
  const total = jobs.reduce((s, j) => s + j.lines.length, 0);
  let done = 0;

  for (const { system, nPar, lines, basis } of jobs) {
    const seen = new Set<string>();
    for (const chosen of lines) {
      onProgress?.(done++ / total);
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
          if (!p || p.some((v) => !(v > 0))) continue;
          const [a, b, c] = cellOf(system, p);
          if (Math.min(a, b, c) < 1.5 || volumeOf(system, [a, b, c], b) > options.maxVolume)
            continue;
          const key = p.map((v) => v.toPrecision(3)).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          // Quick test on the first lines before refining.
          let misses = 0;
          for (let i = 0; i < first && misses <= options.maxUnindexed; i++)
            if (!indexable(system, p, qObs[i] as number, tolQ[i] as number)) misses++;
          if (misses > options.maxUnindexed) continue;
          if (higherMetric(system, [a, b, c])) continue;
          let refined: number[] | null = p;
          for (let pass = 0; pass < 3 && refined; pass++) {
            const calc = calculated(system, refined, 'P', (qObs[qObs.length - 1] as number) * 1.02);
            refined = refine(system, qObs, assign(qObs, tolQ, calc));
          }
          if (!refined || higherMetric(system, cellOf(system, refined))) continue;
          for (const centring of CENTRINGS[system]) {
            const s = evaluate(system, centring, refined, twoTheta, qObs, tolQ, lambda);
            if (
              s &&
              s.lines.slice(0, first).filter((l) => l.hkl === null).length <= options.maxUnindexed
            )
              solutions.push(s);
          }
        }
      }
    }
  }
  onProgress?.(1);
  return rank(solutions);
}

/** True when some hkl (primitive lattice) has |Q_calc − q| ≤ tol; no allocation, for the trial loop. */
function indexable(system: IndexSystem, p: number[], q: number, tol: number): boolean {
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
 * True when a cell's edges are in a ratio that makes its lattice one of higher symmetry, so the
 * higher-symmetry search covers it: a tetragonal cell with c/a = 1 or √2 (the second is a
 * face-centred cubic lattice described as body-centred tetragonal); an orthorhombic cell with two
 * edges in the ratio 1, √2 (a tetragonal lattice) or √3 (the orthohexagonal description of a
 * hexagonal lattice). Ratios are compared to 0.2 %.
 */
function higherMetric(system: IndexSystem, [a, b, c]: number[]): boolean {
  const ratio = (u: number, v: number, r: number) =>
    Math.abs(Math.max(u, v) / Math.min(u, v) - r) <= 2e-3 * r;
  const special = (u: number, v: number, list: number[]) => list.some((r) => ratio(u, v, r));
  if (system === 'tetragonal') return special(a as number, c as number, [1, Math.SQRT2]);
  if (system === 'orthorhombic') {
    const list = [1, Math.SQRT2, Math.sqrt(3)];
    return (
      special(a as number, b as number, list) ||
      special(b as number, c as number, list) ||
      special(a as number, c as number, list)
    );
  }
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

/**
 * Best first by fewest unindexed lines, then M20. Duplicates (the same cell edges in any order
 * and the same volume) keep the best; a lower-symmetry cell equal to a higher-symmetry one is
 * dropped (for example a tetragonal cell with a = c).
 */
function rank(all: IndexSolution[]): IndexSolution[] {
  const sorted = [...all].sort((x, y) => x.unindexed - y.unindexed || y.m20 - x.m20);
  const kept: IndexSolution[] = [];
  for (const s of sorted) {
    if (kept.some((k) => sameCell(k, s))) continue;
    kept.push(s);
    if (kept.length >= 10) break;
  }
  return kept;
}

/** Reciprocal parameters p of a cell (inverse of cellOf). */
function paramsOf(system: IndexSystem, [a, b, c]: [number, number, number]): number[] {
  switch (system) {
    case 'cubic':
      return [1 / (a * a)];
    case 'tetragonal':
      return [1 / (a * a), 1 / (c * c)];
    case 'hexagonal':
      return [4 / (3 * a * a), 1 / (c * c)];
    case 'orthorhombic':
      return [1 / (a * a), 1 / (b * b), 1 / (c * c)];
  }
}

/**
 * Indexes the lines with a given cell (no refinement) and returns its figures of merit, for
 * checking a cell from elsewhere. Null when no line is indexed.
 */
export function evaluateCell(
  system: IndexSystem,
  centring: Centring,
  cell: [number, number, number],
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
