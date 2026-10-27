// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTION, detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitPeaks } from '../src/core/xrd/peaks/fit';
import { ANODES } from '../src/core/xrd/radiation';
import { assignPeaks, uniqueHkl, type AssignPhase } from '../src/core/xrd/reference/assign';
import {
  cellVolume,
  latticeSystemOf,
  reciprocalTerms,
  refineLattice,
  type LatticeSystem,
} from '../src/core/xrd/reference/lattice';
import { matchPhase, referenceLines } from '../src/core/xrd/reference/match';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types';
import { generatePattern } from '../src/core/xrd/synthetic';

const dir = new URL('./fixtures/cod-reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const index = read<ReferenceIndex>('index.json');
const phases = index.families.flatMap((f) => read<ReferenceFamilyFile>(f.file).phases);
const phase = (id: string) => phases.find((p) => p.id === id) as ReferencePhase;
const CU = ANODES.Cu.kAlpha1;
const DEG = Math.PI / 180;

/** 2θ in degrees of reflection hkl in a cell with the given edges (Å) — Bragg's law on 1/d². */
function twoThetaOf(system: LatticeSystem, edges: number[], hkl: [number, number, number]) {
  const q = reciprocalTerms(system, hkl).reduce((s, g, j) => s + g / (edges[j] as number) ** 2, 0);
  return (2 * Math.asin((CU * Math.sqrt(q)) / 2)) / DEG;
}

const edgesOf = (p: ReferencePhase, system: LatticeSystem) =>
  ({
    cubic: [p.cell.a],
    tetragonal: [p.cell.a, p.cell.c],
    hexagonal: [p.cell.a, p.cell.c],
    orthorhombic: [p.cell.a, p.cell.b, p.cell.c],
  })[system];

describe('lattice formulas', () => {
  it('gives the textbook volumes', () => {
    expect(cellVolume('cubic', [5])).toBeCloseTo(125, 10);
    expect(cellVolume('tetragonal', [3, 5])).toBeCloseTo(45, 10);
    expect(cellVolume('hexagonal', [3, 5])).toBeCloseTo((Math.sqrt(3) / 2) * 45, 10);
    expect(cellVolume('orthorhombic', [3, 4, 5])).toBeCloseTo(60, 10);
  });

  it('knows which library cells it can refine', () => {
    const right = { alpha: 90, beta: 90, gamma: 90 };
    expect(latticeSystemOf('cubic', right)).toBe('cubic');
    expect(latticeSystemOf('trigonal', { alpha: 90, beta: 90, gamma: 120 })).toBe('hexagonal');
    expect(latticeSystemOf('trigonal', { alpha: 55, beta: 55, gamma: 55 })).toBeNull();
    expect(latticeSystemOf('monoclinic', { alpha: 90, beta: 99.5, gamma: 90 })).toBeNull();
  });

  it('recovers exact cells from noiseless positions, with and without a zero shift', () => {
    const edges = [3.2, 5.2];
    const hkls: [number, number, number][] = [
      [1, 0, 0],
      [0, 0, 2],
      [1, 0, 1],
      [1, 0, 2],
      [1, 1, 0],
      [1, 0, 3],
    ];
    const exact = hkls.map((hkl) => ({ twoTheta: twoThetaOf('hexagonal', edges, hkl), hkl }));
    const plain = refineLattice('hexagonal', exact, CU, false);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.fit.edges[0]?.a.value).toBeCloseTo(3.2, 8);
    expect(plain.fit.edges[1]?.a.value).toBeCloseTo(5.2, 8);
    expect(plain.fit.volume.value).toBeCloseTo(cellVolume('hexagonal', edges), 7);

    const shifted = refineLattice(
      'hexagonal',
      exact.map((p) => ({ ...p, twoTheta: p.twoTheta + 0.07 })),
      CU,
      true,
    );
    expect(shifted.ok).toBe(true);
    if (!shifted.ok) return;
    expect(shifted.fit.zeroShift?.value).toBeCloseTo(0.07, 7);
    expect(shifted.fit.edges[0]?.a.value).toBeCloseTo(3.2, 6);
    expect(shifted.fit.edges[1]?.a.value).toBeCloseTo(5.2, 6);
  });

  it('refuses when there are too few peaks, or the indices cannot fix a parameter', () => {
    const edges = [4, 6];
    const at = (hkl: [number, number, number]) => ({
      twoTheta: twoThetaOf('tetragonal', edges, hkl),
      hkl,
    });
    const tooFew = refineLattice('tetragonal', [at([1, 0, 1])], CU, false);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.reason).toMatch(/2 indexed peaks are needed.*only 1 is/);
    const noL = refineLattice(
      'tetragonal',
      [at([1, 1, 0]), at([2, 0, 0]), at([2, 1, 0])],
      CU,
      false,
    );
    expect(noL.ok).toBe(false);
    if (!noL.ok) expect(noL.reason).toMatch(/do not fix every parameter/);
    const withShift = refineLattice('tetragonal', [at([1, 0, 1]), at([0, 0, 2])], CU, true);
    expect(withShift.ok).toBe(false);
    if (!withShift.ok) expect(withShift.reason).toMatch(/3 indexed peaks/);
  });
});

/**
 * A scan of a phase whose cell edges are all scaled by 1 + strain, with a zero shift and
 * counting noise, taken through the real detect and fit code. Only lines at least 3 % as
 * strong and at least 1° from every other such line are drawn, so each fitted peak belongs to
 * one reflection and the true index of every peak is known.
 */
function strainedScan(id: string, system: LatticeSystem, strain: number, shift: number) {
  const p = phase(id);
  const edges = edgesOf(p, system).map((e) => e * (1 + strain));
  const lines = referenceLines(p, CU).filter((l) => l.intensity >= 3 && l.twoTheta < 75);
  const truth = lines
    .map((l) => ({
      hkl: l.hkl[0] as [number, number, number],
      twoTheta: twoThetaOf(system, edges, l.hkl[0] as [number, number, number]) + shift,
      intensity: l.intensity,
    }))
    .filter((t, i, all) => all.every((o, j) => j === i || Math.abs(o.twoTheta - t.twoTheta) > 1));
  const { twoTheta, intensity } = generatePattern({
    start: 10,
    end: 80,
    step: 0.02,
    peaks: truth.map((t) => ({
      center: t.twoTheta,
      fwhm: 0.15,
      height: Math.max(300, (t.intensity / 100) * 4000),
      eta: 0.5,
    })),
    background: { constant: 100, amplitude: 0, decay: 1 },
    noiseSeed: 11,
  });
  const guesses = detectPeaks(twoTheta, intensity, DEFAULT_DETECTION).map((d) => ({
    center: d.center,
    width: d.width,
  }));
  const fitted = fitPeaks(twoTheta, intensity, guesses, { profile: 'pseudo-voigt', fixedEta: null })
    .flatMap((r) => r.peaks)
    .sort((a, b) => a.center - b.center);
  return { phase: p, edges, truth, fitted };
}

const CASES: { id: string; system: LatticeSystem; label: string }[] = [
  { id: 'si', system: 'cubic', label: 'cubic Si' },
  { id: 'anatase', system: 'tetragonal', label: 'tetragonal anatase' },
  { id: 'zno-wurtzite', system: 'hexagonal', label: 'hexagonal ZnO' },
  { id: 'brookite', system: 'orthorhombic', label: 'orthorhombic brookite' },
];

describe.each(CASES)('$label with a +0.3 % cell and a zero shift', ({ id, system }) => {
  const TOLERANCE = 0.25;
  const { phase: p, edges, truth, fitted } = strainedScan(id, system, 0.003, 0.05);
  const lines = referenceLines(p, CU);
  const centres = fitted.map((f) => f.center);
  const match = matchPhase(lines, centres, [10, 80], {
    toleranceDeg: TOLERANCE,
    maxShiftDeg: 0.3,
    shiftStepDeg: 0.01,
    minIntensity: 5,
  });
  const assignPhase: AssignPhase = { id, lines, shift: match.shift };
  const assignments = assignPeaks(centres, [assignPhase], {
    toleranceDeg: TOLERANCE,
    minIntensity: 1,
  });

  it('finds every drawn reflection as a fitted peak', () => {
    expect(fitted).toHaveLength(truth.length);
  });

  it('gives the right hkl to every peak', () => {
    fitted.forEach((f, i) => {
      const expected = truth.reduce((a, b) =>
        Math.abs(b.twoTheta - f.center) < Math.abs(a.twoTheta - f.center) ? b : a,
      );
      const a = assignments[i];
      expect(a?.phaseId).toBe(id);
      const hkls = a?.candidates.flatMap((c) => c.hkl.map((h) => h.join(','))) ?? [];
      expect(hkls).toContain(expected.hkl.join(','));
    });
  });

  it('returns the strained cell and the zero shift within 3 sigma', () => {
    const usable = fitted.flatMap((f, i) => {
      const hkl = uniqueHkl(assignments[i] as never, system);
      return hkl ? [{ twoTheta: f.center, sigma: f.sigma.center, hkl }] : [];
    });
    const outcome = refineLattice(system, usable, CU, true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    outcome.fit.edges.forEach((edge, j) => {
      const truthEdge = edges[j] as number;
      expect(Math.abs(edge.a.value - truthEdge)).toBeLessThan(3 * edge.a.sigma);
      // The answer is also a useful one: within 0.05 % of the truth.
      expect(Math.abs(edge.a.value / truthEdge - 1)).toBeLessThan(5e-4);
    });
    const z = outcome.fit.zeroShift;
    expect(Math.abs((z?.value ?? NaN) - 0.05)).toBeLessThan(3 * (z?.sigma ?? 0));
    expect(Math.abs(outcome.fit.volume.value - cellVolume(system, edges))).toBeLessThan(
      3 * outcome.fit.volume.sigma,
    );
  });
});

describe('assignPeaks', () => {
  const anatase = phase('anatase');
  const lines = referenceLines(anatase, CU);

  it('leaves a peak with no reference line nearby unassigned', () => {
    const [result] = assignPeaks([5], [{ id: 'anatase', lines, shift: 0 }]);
    expect(result?.phaseId).toBeNull();
    expect(result?.candidates).toEqual([]);
  });

  it('lists overlapping reflections of one phase together, nearest first', () => {
    const a = lines[0] as (typeof lines)[number];
    const b = { ...a, twoTheta: a.twoTheta + 0.1, hkl: [[0, 0, 4]] as [number, number, number][] };
    const [result] = assignPeaks([a.twoTheta + 0.04], [{ id: 'x', lines: [a, b], shift: 0 }]);
    expect(result?.candidates.map((c) => c.hkl[0])).toEqual([a.hkl[0], [0, 0, 4]]);
  });

  it('ignores a much weaker neighbouring line and names a competing phase', () => {
    const strong = { ...(lines[0] as (typeof lines)[number]), intensity: 100 };
    const weak = { ...strong, twoTheta: strong.twoTheta + 0.05, intensity: 5 };
    const other = { ...strong, twoTheta: strong.twoTheta + 0.1 };
    const [result] = assignPeaks(
      [strong.twoTheta],
      [
        { id: 'a', lines: [strong, weak], shift: 0 },
        { id: 'b', lines: [other], shift: 0 },
      ],
    );
    expect(result?.phaseId).toBe('a');
    expect(result?.candidates).toHaveLength(1);
    expect(result?.competing).toEqual(['b']);
    expect(uniqueHkl(result as never, 'tetragonal')).toBeNull();
  });
});
