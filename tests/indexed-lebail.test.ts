// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Centring, IndexSolution } from '../src/core/xrd/indexing/index';
import { centringAllows, indexedPhase, latticePeaks } from '../src/core/xrd/indexing/latticePhase';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { phaseReference } from '../src/core/xrd/reference/source';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const library = readdirSync(join(process.cwd(), 'tests/fixtures/cod-reference'))
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .flatMap((f) => (json(`tests/fixtures/cod-reference/${f}`) as ReferenceFamilyFile).phases);
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
/** The lattice centring named by a Hermann–Mauguin symbol; R (obverse) is checked as P. */
const centringOf = (phase: ReferencePhase): Centring => {
  const letter = phase.spaceGroup.hm.trim().charAt(0);
  return (['I', 'F', 'C', 'A'].includes(letter) ? letter : 'P') as Centring;
};
/** Total multiplicity of the lattice families within 2e-5 (relative) of d. */
const near = (list: readonly { d: number; m: number }[], d: number) =>
  list.filter((q) => Math.abs(q.d - d) <= 2e-5 * d).reduce((sum, q) => sum + q.m, 0);

describe('Lattice centring conditions', () => {
  it.each([
    ['I', [1, 1, 0], true],
    ['I', [1, 0, 0], false],
    ['F', [1, 1, 1], true],
    ['F', [2, 0, 0], true],
    ['F', [2, 1, 0], false],
    ['C', [1, 1, 3], true],
    ['C', [1, 0, 0], false],
    ['A', [1, 1, 1], true],
    ['A', [0, 1, 0], false],
    ['P', [1, 0, 0], true],
  ] as const)('%s allows %j: %s', (c, hkl, allowed) => {
    expect(centringAllows(c, [...hkl])).toBe(allowed);
  });
});

describe('Reflections of a lattice against the COD-derived line lists', () => {
  // The library lines come from the full space-group operators (reference/powder.ts), which is
  // independent of the centring rules: every line must be among the lattice reflections, with
  // a multiplicity no larger than the lattice's.
  it.each(library.map((p) => [p.id, p] as const))('%s: library lines ⊂ lattice', (_, phase) => {
    const kind = cellKind(phase.crystalSystem, phase.cell);
    const lattice = latticePeaks(phase.cell, kind, centringOf(phase), 0.8);
    for (const { d, m } of phase.peaks) {
      const total = near(lattice, d);
      expect(total, `line at d = ${d} Å missing`).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(total);
    }
  });

  it('equals the library list where the centring is the only condition (Fm-3m)', () => {
    for (const id of ['ceo2', 'halite', 'au', 'periclase', 'fluorite']) {
      const phase = library.find((p) => p.id === id) as ReferencePhase;
      // Families of equal d in every cubic cell (600 and 442) are one family, one library line.
      const lattice = latticePeaks(phase.cell, 'cubic', 'F', 0.8);
      expect(lattice.length).toBe(phase.peaks.length);
      lattice.forEach((q, n) => {
        expect(q.m).toBe(phase.peaks[n]?.m);
        expect(Math.abs(q.d - (phase.peaks[n]?.d ?? 0))).toBeLessThan(1e-5);
      });
    }
  });
});

const ceria = library.find((p) => p.id === 'ceo2') as ReferencePhase;
const solution = (centring: Centring, a = ceria.cell.a): IndexSolution => ({
  system: 'cubic',
  centring,
  a,
  b: a,
  c: a,
  alpha: 90,
  beta: 90,
  gamma: 90,
  volume: a ** 3,
  m20: 50,
  fN: 100,
  meanDelta: 0.005,
  nPossible: 20,
  n: 20,
  lines: [],
  unindexed: 0,
});

describe('Le Bail fit of an indexed cell', () => {
  it('builds a phase that names its origin and has no structure', () => {
    const phase = indexedPhase(solution('F'));
    expect(phase.origin?.kind).toBe('indexed');
    expect(phase.structure).toBeUndefined();
    expect(phaseReference(phase)).toBe('cell from indexing (cubic F, M20 = 50.0)');
    expect(phase.spaceGroup.hm).toContain('space group unknown');
  });

  // The CeO2 pattern GSAS-II simulated (scripts/validation/gsas2/sample.py), with GSAS-II's own Le
  // Bail fit that also refines the transparency.
  const fixture = json('tests/fixtures/validation/ceria-sample.json') as {
    wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
    instrument: Record<string, number>;
    goniometerRadius: number;
    gsas2LeBailTransparency: { cell: { length_a: number }; esd: Record<string, number> };
  };
  const rows = read('tests/fixtures/validation/ceria-sample.xy')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ip = fixture.instrument as Record<'U' | 'V' | 'W' | 'X' | 'Y' | 'Polariz.', number>;
  const G = 8 * Math.LN2 * 1e-4;
  const fit = (phase: ReferencePhase) => {
    const result = refineRietveld({
      x: Float64Array.from(rows, (r) => r[0] as number),
      y: Float64Array.from(rows, (r) => r[1] as number),
      wavelengths: { ...fixture.wavelengths, polarisation: ip['Polariz.'] },
      phases: [
        {
          id: phase.id,
          name: phase.name,
          crystalSystem: phase.crystalSystem,
          cell: phase.cell,
          peaks: phase.peaks,
          orientation: null,
          leBail: true,
        },
      ],
      choices: { ...DEFAULT_CHOICES, zero: false, size: true, strain: true, transparency: true },
      backgroundTerms: 6,
      atomicWeights,
      instrument: { u: ip.U * G, v: ip.V * G, w: ip.W * G, x: ip.X / 100, y: ip.Y / 100 },
    });
    if (!result.ok) throw new Error(result.error);
    return result;
  };

  it('gives the same fit as the library phase, and GSAS-II’s Le Bail cell', () => {
    // Indexing would give a slightly different a; start 0.05 % off.
    const indexed = fit(indexedPhase(solution('F', ceria.cell.a * 1.0005)));
    const library = fit(ceria);
    const a = indexed.phases[0]?.cell.a;
    if (!a) throw new Error('no cell');
    expect(Math.abs(a.value - (library.phases[0]?.cell.a.value ?? 0))).toBeLessThan(1e-6);
    expect(indexed.stats.rwp).toBeCloseTo(library.stats.rwp, 5);
    const g = fixture.gsas2LeBailTransparency;
    const esd = ((g.esd['0::A0'] as number) * g.cell.length_a ** 3) / 2;
    expect(Math.abs(a.value - g.cell.length_a)).toBeLessThan(3 * Math.hypot(a.esd, esd) + 2e-6);
  }, 120_000);

  it('still finds the cell when the centring is not known (P: extra reflections stay empty)', () => {
    const f = fit(indexedPhase(solution('F')));
    const p = fit(indexedPhase(solution('P')));
    expect(p.converged).toBe(true);
    const a = p.phases[0]?.cell.a;
    if (!a) throw new Error('no cell');
    expect(Math.abs(a.value - (f.phases[0]?.cell.a.value ?? 0))).toBeLessThan(a.esd);
    const size = (r: typeof f) => r.phases[0]?.size?.value ?? NaN;
    expect(Math.abs(size(p) / size(f) - 1)).toBeLessThan(0.01);
    // The reflections the F lattice forbids carry almost no extracted intensity...
    const rows = p.phases[0]?.reflections ?? [];
    const strongest = Math.max(...rows.map((r) => r.iCalc));
    const forbidden = rows.filter((r) => !centringAllows('F', r.hkl));
    expect(forbidden.length).toBeGreaterThan(10);
    for (const r of forbidden) expect(r.iCalc / strongest).toBeLessThan(0.005);
    // ...and the fit is nearly as good (Le Bail's partition is not a least-squares estimate, so
    // the many empty reflections cost a little R_wp).
    expect(p.stats.rwp).toBeLessThan(1.05 * (f.stats.rwp ?? 0));
  }, 120_000);
});
