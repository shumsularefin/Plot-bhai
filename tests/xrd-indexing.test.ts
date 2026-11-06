// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INDEXING,
  evaluateCell,
  indexPattern,
  type Centring,
  type IndexSolution,
  type IndexSystem,
} from '../src/core/xrd/indexing/index';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';

// Searching monoclinic cells by default makes each search take seconds, more on a CI runner.
vi.setConfig({ testTimeout: 120_000 });

const CU = 1.5405929;
const phase = (file: string, id: string): ReferencePhase => {
  const path = file.startsWith('data/') ? `../${file}` : `fixtures/cod-reference/${file}`;
  const family = JSON.parse(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
  ) as ReferenceFamilyFile;
  const p = family.phases.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

/** Seeded uniform random numbers (mulberry32), so noisy tests repeat exactly. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The first `count` lines (2θ, Cu Kα1) of a reference phase with at least 1 % intensity, lines
 * closer than 0.06° merged as a measurement would; optional Gaussian noise (σ, degrees) and
 * lines removed (indices into the list).
 */
function lines(p: ReferencePhase, count = 20, sigma = 0, drop: number[] = [], seed = 1): number[] {
  const rnd = random(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const all = p.peaks
    .filter((x) => x.i >= 1)
    .map((x) => (2 * Math.asin(CU / (2 * x.d)) * 180) / Math.PI)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const merged: number[] = [];
  for (const t of all)
    if (!merged.length || t - (merged[merged.length - 1] as number) > 0.06) merged.push(t);
  return merged
    .slice(0, count)
    .filter((_, i) => !drop.includes(i))
    .map((t) => t + sigma * gauss());
}

const edges = (s: { a: number; b: number; c: number }) => [s.a, s.b, s.c].sort((x, y) => x - y);
/** True when the solution has the reference cell's edges (any order) to the relative tolerance. */
const matches = (s: IndexSolution, p: ReferencePhase, rel: number) => {
  const e = edges(s);
  return edges(p.cell).every((v, i) => Math.abs((e[i] as number) - v) <= rel * v);
};

const CASES: [string, string, string][] = [
  ['ceo2.json', 'ceo2', 'cubic'],
  ['in2o3.json', 'in2o3', 'cubic'],
  ['lab6.json', 'lab6', 'cubic'],
  ['tio2.json', 'rutile', 'tetragonal'],
  ['tio2.json', 'anatase', 'tetragonal'],
  ['zno.json', 'zno-wurtzite', 'hexagonal'],
  ['bn.json', 'h-bn', 'hexagonal'],
  ['caco3.json', 'aragonite', 'orthorhombic'],
  ['tio2.json', 'brookite', 'orthorhombic'],
];

describe('indexing patterns calculated from known COD cells', { timeout: 60_000 }, () => {
  for (const [file, id, system] of CASES) {
    it(`${id}: exact positions give the true cell first`, () => {
      const p = phase(file, id);
      const best = indexPattern(lines(p))[0];
      expect(best?.system).toBe(system);
      expect(best && matches(best, p, 1e-4)).toBe(true);
      expect(best?.unindexed).toBe(0);
    });

    it(`${id}: noise (σ = 0.01°) and two missing lines still give the true cell first`, () => {
      const p = phase(file, id);
      const best = indexPattern(lines(p, 20, 0.01, [3, 8], 7))[0];
      expect(best?.system).toBe(system);
      expect(best && matches(best, p, 2e-3)).toBe(true);
    });
  }
});

interface PythonFom {
  id: string;
  system: IndexSystem;
  centring: Centring;
  cell: number[];
  positions: number[];
  indexed: number;
  nCalc: number;
  m20: number;
  fN: number;
  meanDelta: number;
}

describe('figures of merit against an independent implementation', () => {
  const cases = JSON.parse(
    readFileSync(new URL('fixtures/indexing-fom-python.json', import.meta.url), 'utf8'),
  ) as PythonFom[];
  for (const c of cases) {
    it(`${c.id} (${c.system} ${c.centring}): M20, F_N, N_calc and indexed count as Python gives`, () => {
      const s = evaluateCell(c.system, c.centring, c.cell, c.positions);
      expect(s).not.toBeNull();
      if (!s) return;
      expect(s.lines.slice(0, s.n).filter((l) => l.hkl).length).toBe(c.indexed);
      expect(s.nPossible).toBe(c.nCalc);
      expect(Math.abs(s.m20 / c.m20 - 1)).toBeLessThan(1e-6);
      expect(Math.abs(s.fN / c.fN - 1)).toBeLessThan(1e-6);
      expect(Math.abs(s.meanDelta / c.meanDelta - 1)).toBeLessThan(1e-6);
    });
  }
});

describe('invariance', () => {
  const p = phase('tio2.json', 'rutile');

  it('the order of the input lines does not matter', () => {
    const t = lines(p, 20, 0.005, [], 3);
    const a = indexPattern(t)[0];
    const b = indexPattern([...t].reverse())[0];
    expect(b?.a).toBe(a?.a);
    expect(b?.c).toBe(a?.c);
    expect(b?.m20).toBe(a?.m20);
  });

  it('the same d-spacings measured with Co Kα1 give the same cell', () => {
    const co = 1.788996;
    const t = lines(p, 20, 0.005, [], 3);
    const d = t.map((x) => CU / (2 * Math.sin((x * Math.PI) / 360)));
    const tCo = d.map((x) => (2 * Math.asin(co / (2 * x)) * 180) / Math.PI);
    const a = indexPattern(t)[0];
    // A tolerance scaled with the wavelength keeps the same lines inside it.
    const b = indexPattern(tCo, { ...DEFAULT_INDEXING, wavelength: co })[0];
    expect(b?.system).toBe(a?.system);
    expect(b?.a).toBeCloseTo(a?.a as number, 3);
    expect(b?.c).toBeCloseTo(a?.c as number, 3);
  });

  it('every listed hkl reproduces its calculated 2θ from the reported cell', () => {
    const s = indexPattern(lines(phase('caco3.json', 'aragonite'), 20, 0.005, [], 5))[0];
    if (!s) throw new Error('no solution');
    for (const line of s.lines) {
      if (!line.hkl || line.calc === null) continue;
      const [h, k, l] = line.hkl;
      const q = (h * h) / s.a ** 2 + (k * k) / s.b ** 2 + (l * l) / s.c ** 2;
      expect((2 * Math.asin((CU * Math.sqrt(q)) / 2) * 180) / Math.PI).toBeCloseTo(line.calc, 8);
      expect(Math.abs(line.calc - line.twoTheta)).toBeLessThanOrEqual(DEFAULT_INDEXING.tolerance);
    }
  });
});

const cell6 = (c: ReferencePhase['cell']) => [c.a, c.b, c.c, c.alpha, c.beta, c.gamma];
/**
 * True when a suggested cell describes the reference lattice (in any setting): the same volume
 * and the same calculated 2θ for every line the reference cell indexes.
 */
function sameLattice(s: IndexSolution, p: ReferencePhase, positions: number[], tol: number) {
  const ref = evaluateCell(s.system, 'P', cell6(p.cell), positions);
  const own = evaluateCell(s.system, 'P', [s.a, s.b, s.c, s.alpha, s.beta, s.gamma], positions);
  if (!ref || !own || Math.abs(s.volume / ref.volume - 1) > tol) return false;
  return ref.lines.every((l, i) => {
    const o = own.lines[i]?.calc;
    return (
      l.calc === null ||
      (o !== null && o !== undefined && Math.abs(o - l.calc) < (tol > 1e-3 ? 0.05 : 0.002))
    );
  });
}

const LOW: [string, string, IndexSystem, Centring][] = [
  ['zro2.json', 'baddeleyite', 'monoclinic', 'P'],
  ['bi2o3.json', 'bismite', 'monoclinic', 'P'],
  ['wo3.json', 'wo3-monoclinic', 'monoclinic', 'P'],
  ['copper-oxides.json', 'tenorite', 'monoclinic', 'C'],
  ['data/reference/polymers.json', 'pet', 'triclinic', 'P'],
];

describe('monoclinic and triclinic indexing', { timeout: 120_000 }, () => {
  // Monoclinic is searched by default with the higher systems; triclinic only on request.
  const optionsFor = (system: IndexSystem) =>
    system === 'triclinic' ? { ...DEFAULT_INDEXING, systems: [system] } : DEFAULT_INDEXING;
  for (const [file, id, system, centring] of LOW) {
    it(`${id}: exact positions give the reference lattice first`, () => {
      const p = phase(file, id);
      const t = lines(p);
      const best = indexPattern(t, optionsFor(system))[0];
      if (!best) throw new Error('no solution');
      expect(best.system).toBe(system);
      expect(best.centring).toBe(centring);
      expect(best.unindexed).toBe(0);
      expect(sameLattice(best, p, t, 1e-4)).toBe(true);
    });

    it(`${id}: noise (σ = 0.01°) and missing lines keep the reference lattice in the first three`, () => {
      const p = phase(file, id);
      // The triclinic search needs its first lines (the zone axes), so none are removed there.
      const t = lines(p, 20, 0.01, system === 'triclinic' ? [] : [3, 8], 7);
      // Noise can make a pseudo-symmetric cell (bismite is metrically close to orthorhombic C,
      // 2c + a ⟂ a to 0.03°) rank first, so the reference must be among the first three.
      const top = indexPattern(t, optionsFor(system)).slice(0, 3);
      expect(top.some((s) => s.system === system && sameLattice(s, p, t, 3e-3))).toBe(true);
    });
  }

  it('reports a reduced cell: β ≥ 90° and a ≤ c (monoclinic), all angles on one side of 90° (triclinic)', () => {
    for (const [file, id, system] of LOW) {
      const s = indexPattern(lines(phase(file, id)), optionsFor(system))[0];
      if (!s) throw new Error(id);
      if (s.system === 'monoclinic') {
        expect(s.beta).toBeGreaterThanOrEqual(90);
        expect(s.a).toBeLessThanOrEqual(s.c);
        expect([s.alpha, s.gamma]).toEqual([90, 90]);
      } else {
        const side = [s.alpha, s.beta, s.gamma].map((x) => Math.sign(x - 90));
        expect(new Set(side).size).toBe(1);
      }
    }
  });

  it('reports a monoclinic lattice as monoclinic when triclinic is searched too', () => {
    const p = phase('zro2.json', 'baddeleyite');
    const t = lines(p);
    const best = indexPattern(t, { ...DEFAULT_INDEXING, systems: ['monoclinic', 'triclinic'] })[0];
    expect(best?.system).toBe('monoclinic');
    expect(best && sameLattice(best, p, t, 1e-4)).toBe(true);
  });

  it('gives the same figures of merit for a cell in another setting of the same lattice', () => {
    // Bismite with c′ = c + a: the same lattice, so the same calculated lines (invariance).
    const p = phase('bi2o3.json', 'bismite');
    const { a, c, beta } = p.cell;
    const cb = Math.cos((beta * Math.PI) / 180);
    const c2 = Math.sqrt(a * a + c * c + 2 * a * c * cb);
    const beta2 = (Math.acos((a + c * cb) / c2) * 180) / Math.PI;
    const t = lines(p);
    const one = evaluateCell('monoclinic', 'P', cell6(p.cell), t);
    const two = evaluateCell('monoclinic', 'P', [a, p.cell.b, c2, 90, beta2, 90], t);
    expect(two?.nPossible).toBe(one?.nPossible);
    expect(two?.m20).toBeCloseTo(one?.m20 as number, 6);
    // The same cell written as triclinic gives the same lines too.
    const tri = evaluateCell('triclinic', 'P', cell6(p.cell), t);
    expect(tri?.nPossible).toBe(one?.nPossible);
    expect(tri?.m20).toBeCloseTo(one?.m20 as number, 6);
  });

  it('every listed hkl reproduces its calculated 2θ from the reported triclinic cell', () => {
    const s = indexPattern(lines(phase('data/reference/polymers.json', 'pet'), 20, 0.005, [], 5), {
      ...DEFAULT_INDEXING,
      systems: ['triclinic'],
    })[0];
    if (!s) throw new Error('no solution');
    const r = Math.PI / 180;
    const [ca, cb, cg] = [s.alpha, s.beta, s.gamma].map((x) => Math.cos(x * r)) as [
      number,
      number,
      number,
    ];
    for (const line of s.lines) {
      if (!line.hkl || line.calc === null) continue;
      const [h, k, l] = line.hkl;
      // 1/d² = hᵀ G⁻¹ h with the direct metric G written out from the cell (independent of the code).
      const g = [
        [s.a * s.a, s.a * s.b * cg, s.a * s.c * cb],
        [s.a * s.b * cg, s.b * s.b, s.b * s.c * ca],
        [s.a * s.c * cb, s.b * s.c * ca, s.c * s.c],
      ];
      const v = [h, k, l];
      // Solve G x = v, then Q = vᵀ x (avoids writing the inverse out).
      const x = solve3(g, v);
      const q = v.reduce((sum, vi, i) => sum + vi * (x[i] as number), 0);
      expect((2 * Math.asin((CU * Math.sqrt(q)) / 2) * 180) / Math.PI).toBeCloseTo(line.calc, 8);
    }
  });
});

/** Cramer's rule for a 3×3 system. */
function solve3(m: number[][], v: number[]): number[] {
  const at = (a: number[][], i: number, j: number) => (a[i] as number[])[j] as number;
  const det = (a: number[][]) =>
    at(a, 0, 0) * (at(a, 1, 1) * at(a, 2, 2) - at(a, 1, 2) * at(a, 2, 1)) -
    at(a, 0, 1) * (at(a, 1, 0) * at(a, 2, 2) - at(a, 1, 2) * at(a, 2, 0)) +
    at(a, 0, 2) * (at(a, 1, 0) * at(a, 2, 1) - at(a, 1, 1) * at(a, 2, 0));
  const d = det(m);
  return [0, 1, 2].map(
    (j) => det(m.map((row, i) => row.map((x, c) => (c === j ? (v[i] as number) : x)))) / d,
  );
}

describe('indexing worker', { timeout: 120_000 }, () => {
  it('posts progress and then the same solutions as a direct call', async () => {
    const posted: unknown[] = [];
    const scope = globalThis as unknown as { self?: unknown };
    scope.self = { postMessage: (m: unknown) => posted.push(m) };
    await import('../src/workers/indexing.worker');
    const worker = scope.self as { onmessage: (e: { data: unknown }) => void };
    const t = lines(phase('zno.json', 'zno-wurtzite'), 20, 0.005, [], 2);
    worker.onmessage({ data: { id: 4, positions: t, options: DEFAULT_INDEXING } });
    const done = posted.at(-1) as { id: number; kind: string; solutions: IndexSolution[] };
    expect(done.kind).toBe('done');
    expect(done.id).toBe(4);
    expect(done.solutions[0]?.m20).toBe(indexPattern(t)[0]?.m20);
    expect(posted.some((m) => (m as { kind: string }).kind === 'progress')).toBe(true);
  });
});
