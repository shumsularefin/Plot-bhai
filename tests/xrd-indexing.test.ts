// @vitest-environment node
import { describe, expect, it } from 'vitest';
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

const CU = 1.5405929;
const phase = (file: string, id: string): ReferencePhase => {
  const family = JSON.parse(
    readFileSync(new URL(`fixtures/cod-reference/${file}`, import.meta.url), 'utf8'),
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
  cell: [number, number, number];
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

describe('indexing worker', () => {
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
