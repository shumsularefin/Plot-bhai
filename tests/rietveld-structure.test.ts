// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import {
  atomStates,
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  type PhaseModel,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import {
  DEFAULT_CHOICES,
  refineRietveld,
  type RefineChoices,
} from '../src/core/xrd/rietveld/refine';
import {
  nullSpace,
  restraintResiduals,
  structureFactorSquared,
  structureModel,
} from '../src/core/xrd/rietveld/structure';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const phase = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const radii = (json('data/reference/covalent-radii.json') as { radii: Record<string, number> })
  .radii;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };

const modelOf = (ref: ReferencePhase) =>
  structureModel(
    ref.cell,
    ref.structure as NonNullable<ReferencePhase['structure']>,
    factors,
    radii,
  );

describe('Free coordinates from the site symmetry', () => {
  it('finds the null space of R − I', () => {
    expect(nullSpace([])).toHaveLength(3);
    // Inversion at the origin: −2I has no null space.
    expect(
      nullSpace([
        [-2, 0, 0],
        [0, -2, 0],
        [0, 0, -2],
      ]),
    ).toHaveLength(0);
    // 3-fold axis along [111] (x,y,z → z,x,y): one direction, (1, 1, 1).
    const three = nullSpace([
      [-1, 0, 1],
      [1, -1, 0],
      [0, 1, -1],
    ]);
    expect(three).toEqual([[1, 1, 1]]);
  });

  it('frees only the coordinates the site symmetry allows', () => {
    const rutile = modelOf(phase('tio2', 'rutile'));
    expect(rutile.atoms[0]?.basis).toHaveLength(0); // Ti at 0, 0, 0 (mmm)
    const o = rutile.atoms[1]?.basis ?? [];
    expect(o).toHaveLength(1); // O at x, x, 0
    expect(Math.abs(o[0]?.[0] ?? 0)).toBeCloseTo(Math.abs(o[0]?.[1] ?? 1), 12);
    expect(o[0]?.[2]).toBeCloseTo(0, 12);
    const anatase = modelOf(phase('tio2', 'anatase'));
    expect(anatase.atoms[0]?.basis).toHaveLength(0);
    expect(anatase.atoms[1]?.basis.map((v) => v.map(Math.abs))).toEqual([[0, 0, 1]]); // O at 0, 0, z
    expect(modelOf(phase('tio2', 'brookite')).atoms.map((a) => a.basis.length)).toEqual([3, 3, 3]);
  });

  it('keeps the atom on its site for any shift along the free directions (invariance)', () => {
    const ref = phase('tio2', 'rutile');
    const model = modelOf(ref);
    const states = model.atoms.map((a) => ({
      x: a.x0.map((v, i) => v + 0.01 * (a.basis[0]?.[i] ?? 0)) as [number, number, number],
      occupancy: 1,
      b: 0,
    }));
    // Systematic absences stay absent: rutile (P4_2/mnm) 0 0 1 and 1 0 0.
    expect(structureFactorSquared(model, states, [0, 0, 1], ref.cell.c)).toBeLessThan(1e-12);
    expect(structureFactorSquared(model, states, [1, 0, 0], ref.cell.a)).toBeLessThan(1e-12);
  });
});

describe('Structure factors of the refinement', () => {
  // Independent route: the library Σ|F|² from reference/powder.ts (whole cell expanded at build time).
  it.each([
    ['tio2', 'rutile'],
    ['tio2', 'anatase'],
    ['tio2', 'brookite'],
    ['ceo2', 'ceo2'],
    ['zno', 'zno-wurtzite'],
  ])('reproduces the library Σ|F|² of %s %s', (file, id) => {
    const ref = phase(file, id);
    const model = modelOf(ref);
    const states = model.atoms.map((a) => ({ x: a.x0, occupancy: a.occupancy0, b: a.b0 }));
    const reflections = refinementReflections(
      ref.peaks,
      ref.cell,
      cellKind(ref.crystalSystem, ref.cell),
      0.8,
    );
    const strongest = Math.max(...reflections.map((r) => r.mf2));
    let compared = 0;
    for (const r of reflections) {
      if (r.mf2 < 0.01 * strongest) continue;
      const d = ref.peaks.find((p) =>
        p.hkl.some((h) => r.members.some((m) => m.join() === h.join())),
      )?.d;
      if (d === undefined) continue;
      const sum = r.members.reduce((s, m) => s + structureFactorSquared(model, states, m, d), 0);
      // Library values are stored to 5 significant figures; lines split between families share Σ|F|².
      expect(Math.abs(sum - r.mf2) / r.mf2).toBeLessThan(2e-3);
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
  });

  it('has zero restraint residuals at the start', () => {
    const ref = phase('tio2', 'brookite');
    const model = modelOf(ref);
    expect(model.restraints.length).toBeGreaterThan(5);
    const states = model.atoms.map((a) => ({ x: a.x0, occupancy: 1, b: 0 }));
    expect(Math.max(...restraintResiduals(ref.cell, model, states).map(Math.abs))).toBeLessThan(
      1e-9,
    );
  });
});

/** Deterministic normal deviates (Park–Miller generator, Box–Muller transform). */
function noise(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Brookite with every coordinate moved by up to ±0.004 and B = 0.5 Å², with counting noise. */
function brookitePattern(shift: number[], b: number, occupancy = [1, 1, 1], step = 0.02) {
  const ref = phase('tio2', 'brookite');
  const kind = cellKind(ref.crystalSystem, ref.cell);
  const structure = modelOf(ref);
  const model: PhaseModel = {
    id: ref.id,
    name: ref.name,
    kind,
    cell: ref.cell,
    reflections: refinementReflections(ref.peaks, ref.cell, kind, 0.8),
    orientation: null,
    structure,
  };
  const x = Float64Array.from({ length: Math.round(70 / step) + 1 }, (_, i) => 20 + i * step);
  const layout = makeLayout([model], 3);
  const p = new Float64Array(layout.size);
  p[layout.background[0] as number] = 200;
  p[layout.background[1] as number] = -40;
  const pl = layout.phases[0] as (typeof layout.phases)[number];
  ['a', 'b', 'c'].forEach((k, i) => (p[pl.cell[i] as number] = ref.cell[k as 'a' | 'b' | 'c']));
  p[pl.scale] = 2e-4;
  p[pl.w] = 0.01;
  p[pl.eta] = 0.5;
  p[pl.orientation] = 1;
  let s = 0;
  pl.atoms.forEach((al) => {
    for (const j of al.coords) p[j] = shift[s++] ?? 0;
    p[al.occupancy] = occupancy[pl.atoms.indexOf(al)] ?? 1;
    p[al.b] = b;
  });
  const truth = atomStates(model, pl, p);
  const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
  const curve = phaseCurve(x, [model], layout, 0, p, CU);
  const gauss = noise(777);
  const y = x.map((_, i) => {
    const mean = (bg[i] as number) + (curve[i] as number);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  });
  return { ref, x, y, truth };
}

const refineBrookite = (
  x: Float64Array,
  y: Float64Array,
  ref: ReferencePhase,
  extra: Partial<RefineChoices>,
) =>
  refineRietveld({
    x,
    y,
    wavelengths: CU,
    phases: [
      {
        id: ref.id,
        name: ref.name,
        crystalSystem: ref.crystalSystem,
        cell: ref.cell,
        peaks: ref.peaks,
        orientation: null,
        ...(ref.structure && { structure: ref.structure }),
      },
    ],
    choices: { ...DEFAULT_CHOICES, zero: false, widthSlope: false, ...extra },
    backgroundTerms: 3,
    atomicWeights,
    factors,
    radii,
  });

describe('Structure refinement of a synthetic pattern', () => {
  const shift = [0.004, -0.003, 0.002, -0.004, 0.003, 0.001, 0.002, 0.004, -0.003];

  it('moves perturbed atoms back to the true positions and recovers B', () => {
    const { ref, x, y, truth } = brookitePattern(shift, 0.5);
    const result = refineBrookite(x, y, ref, { positions: true, biso: true });
    if (!result.ok) throw new Error(result.error);
    const atoms = result.phases[0]?.atoms ?? [];
    expect(atoms).toHaveLength(3);
    atoms.forEach((atom, a) =>
      atom.x.forEach((c, i) => {
        expect(c.refined).toBe(true);
        const err = Math.abs(c.value - (truth[a]?.x[i] as number));
        expect(err).toBeLessThan(4 * c.esd + 2e-4);
      }),
    );
    for (const atom of atoms)
      expect(Math.abs(atom.b.value - 0.5)).toBeLessThan(4 * atom.b.esd + 0.1);
    expect(result.stats.chi2).toBeLessThan(1.2);
    expect(result.stages.map((s) => s.name)).toContain('Atom positions');
    expect(result.warnings.some((w) => w.includes('rarely well determined'))).toBe(true);
  }, 60_000);

  it('recovers a partly filled site and keeps full sites fixed', () => {
    const { ref, x, y } = brookitePattern(new Array(9).fill(0), 0, [1, 1, 0.8]);
    // The file says O2 is 0.9 filled (start); the data were made with 0.8.
    const structure = ref.structure as NonNullable<ReferencePhase['structure']>;
    const start: ReferencePhase = {
      ...ref,
      structure: {
        ...structure,
        atoms: structure.atoms.map((a, i) => (i === 2 ? { ...a, occupancy: 0.9 } : a)),
      },
    };
    const result = refineBrookite(x, y, start, { occupancy: true });
    if (!result.ok) throw new Error(result.error);
    const atoms = result.phases[0]?.atoms ?? [];
    expect(atoms[0]?.occupancy).toEqual({ value: 1, esd: 0, refined: false });
    const o2 = atoms[2]?.occupancy;
    expect(o2?.refined).toBe(true);
    expect(Math.abs((o2?.value ?? 0) - 0.8)).toBeLessThan(4 * (o2?.esd ?? 0) + 0.005);
  }, 60_000);

  it('warns that full sites are not refined', () => {
    const { ref, x, y } = brookitePattern(new Array(9).fill(0), 0);
    const result = refineBrookite(x, y, ref, { occupancy: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings.some((w) => w.includes('No site is partly filled'))).toBe(true);
  }, 60_000);

  it('keeps bond lengths near the start with restraints', () => {
    const { ref, x, y } = brookitePattern(shift, 0);
    const result = refineBrookite(x, y, ref, { positions: true, restraints: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.stages.map((s) => s.name)).toContain('Atom positions (with bond restraints)');
    const model = modelOf(ref);
    const states = (result.phases[0]?.atoms ?? []).map((a) => ({
      x: a.x.map((c) => c.value) as [number, number, number],
      occupancy: 1,
      b: 0,
    }));
    const cell = {
      ...ref.cell,
      a: result.phases[0]?.cell.a.value ?? 0,
      b: result.phases[0]?.cell.b.value ?? 0,
      c: result.phases[0]?.cell.c.value ?? 0,
    };
    // Residuals are in units of σ = 0.02 Å; the true shifts change bonds by up to ~0.05 Å.
    const worst = Math.max(...restraintResiduals(cell, model, states).map(Math.abs));
    expect(worst).toBeLessThan(4);
  }, 60_000);

  it('leaves a structure with no data change unchanged (invariance)', () => {
    const { ref, x, y } = brookitePattern(new Array(9).fill(0), 0);
    const result = refineBrookite(x, y, ref, { positions: true });
    if (!result.ok) throw new Error(result.error);
    const start = ref.structure?.atoms ?? [];
    result.phases[0]?.atoms?.forEach((atom, a) =>
      atom.x.forEach((c, i) =>
        expect(Math.abs(c.value - (start[a]?.x[i] as number))).toBeLessThan(4 * c.esd + 1e-4),
      ),
    );
  }, 60_000);

  it('does not refine the structure without stored atoms', () => {
    const ref = phase('tio2', 'brookite');
    const { x, y } = brookitePattern(new Array(9).fill(0), 0);
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [
        {
          id: ref.id,
          name: ref.name,
          crystalSystem: ref.crystalSystem,
          cell: ref.cell,
          peaks: ref.peaks,
          orientation: null,
        },
      ],
      choices: { ...DEFAULT_CHOICES, positions: true },
      backgroundTerms: 3,
      atomicWeights,
      factors,
      radii,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.phases[0]?.atoms).toBeNull();
    expect(result.warnings.some((w) => w.includes('No atom positions are stored'))).toBe(true);
  }, 60_000);
});
