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
import { refinementReflections, type Hkl } from '../src/core/xrd/rietveld/reflections';
import { parseSymop } from '../src/core/xrd/reference/symmetry';
import { applySymop } from '../src/core/xrd/structure/geometry';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import {
  structureFactorSquared,
  specialPosition,
  structureModel,
  substitutedContents,
  type Substitution,
} from '../src/core/xrd/rietveld/structure';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
  (p) => p.id === 'zno-wurtzite',
) as ReferencePhase;
const structure = zno.structure as NonNullable<ReferencePhase['structure']>;
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };
const INSTRUMENT = { u: 0.004, v: -0.002, w: 0.003, x: 0.02, y: 0.01 };
const mg = (fraction: number, refine = true): Substitution[] => [
  { site: 'Zn', element: 'Mg', fraction, refine },
];
const HKL: Hkl[] = [
  [1, 0, 0],
  [0, 0, 2],
  [1, 0, 1],
  [1, 0, 2],
  [1, 1, 0],
  [1, 0, 3],
  [2, 0, 1],
  [2, 0, 4],
];
const dOf = ([h, k, l]: Hkl) => {
  // Hexagonal: 1/d² = 4(h² + hk + k²)/(3a²) + l²/c².
  const { a, c } = zno.cell;
  return 1 / Math.sqrt((4 * (h * h + h * k + k * k)) / (3 * a * a) + (l * l) / (c * c));
};

function f2(subs: Substitution[], fraction?: number, element?: string) {
  const s = element
    ? {
        ...structure,
        atoms: structure.atoms.map((a) => (a.label === 'Zn' ? { ...a, element } : a)),
      }
    : structure;
  const model = structureModel(zno.cell, s, factors, {}, false, subs);
  const states = model.atoms.map((atom) => ({
    x: atom.x0,
    occupancy: atom.occupancy0,
    b: atom.b0,
    ...(fraction !== undefined && { fraction }),
  }));
  return HKL.map((hkl) => structureFactorSquared(model, states, hkl, dOf(hkl)));
}

describe('Special positions', () => {
  const ops = structure.ops.map(parseSymop);
  it('moves a CIF coordinate given to 3 or 4 decimals onto the exact special position', () => {
    for (const given of [0.3333, 0.333, 0.33337]) {
      const x = specialPosition(ops, [given, 1 - given, 0]);
      expect(x[0]).toBeCloseTo(1 / 3, 14);
      expect(x[1]).toBeCloseTo(2 / 3, 14);
      // Every operator of the stabiliser now maps it exactly onto itself (invariance).
      for (const g of ops) {
        const y = applySymop(g, x);
        const d = y.map((v, i) => v - (x[i] as number) - Math.round(v - (x[i] as number)));
        if (d.every((v) => Math.abs(v) < 2e-3))
          d.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-14));
      }
    }
  });

  it('leaves a coordinate the site symmetry leaves free, and a general position, unchanged', () => {
    // O in ZnO at (1/3, 2/3, z): z is free on the 3m axis.
    expect(specialPosition(ops, [1 / 3, 2 / 3, 0.3823])[2]).toBeCloseTo(0.3823, 14);
    const general: [number, number, number] = [0.1234, 0.3456, 0.2789];
    expect(specialPosition(ops, general)).toEqual(general);
  });
});

describe('Shared-site substitution: structure factor', () => {
  it('x = 0 is the host structure, x = 1 is the dopant on the site (invariance)', () => {
    const host = f2([]);
    f2(mg(0), 0).forEach((v, i) => expect(v).toBeCloseTo(host[i] as number, 8));
    const allMg = f2([], undefined, 'Mg');
    f2(mg(1), 1).forEach((v, i) => expect(v / (allMg[i] as number)).toBeCloseTo(1, 12));
  });

  it('a dopant of the host element changes nothing for any x', () => {
    const host = f2([]);
    for (const x of [0.1, 0.5, 0.9])
      f2([{ site: 'Zn', element: 'Zn', fraction: x, refine: true }], x).forEach((v, i) =>
        expect(v).toBeCloseTo(host[i] as number, 8),
      );
  });

  it('the site factor is (1 − x) f_host + x f_dopant: F is linear in x', () => {
    // F(x) = F(0) + x (F(1) − F(0)) for real F of this centrosymmetric-in-projection structure is
    // not guaranteed, so check |F|² against the quadratic through x = 0, 0.5 and 1 instead.
    const at = (x: number) => f2(mg(x), x);
    const [f0, fh, f1] = [at(0), at(0.5), at(1)];
    for (const x of [0.15, 0.3, 0.8]) {
      const fx = at(x);
      fx.forEach((v, i) => {
        // Lagrange quadratic through (0, f0), (0.5, fh), (1, f1).
        const q =
          (f0[i] as number) * 2 * (x - 0.5) * (x - 1) -
          (fh[i] as number) * 4 * x * (x - 1) +
          (f1[i] as number) * 2 * x * (x - 0.5);
        expect(v).toBeCloseTo(q, 6);
      });
    }
  });

  it('refuses an unknown site or an element without a scattering factor', () => {
    expect(() =>
      structureModel(zno.cell, structure, factors, {}, false, [
        { site: 'Q9', element: 'Mg', fraction: 0.1, refine: true },
      ]),
    ).toThrow(/no site labelled Q9/);
    expect(() =>
      structureModel(zno.cell, structure, factors, {}, false, [
        { site: 'Zn', element: 'Xx', fraction: 0.1, refine: true },
      ]),
    ).toThrow(/no scattering factor for Xx/);
  });

  it('moves (multiplicity × occupancy × x) atoms from host to dopant in the cell contents', () => {
    const model = structureModel(zno.cell, structure, factors, {}, false, mg(0.15));
    const contents = substitutedContents(
      { Zn: 2, O: 2 },
      model,
      model.atoms.map(() => ({ occupancy: 1, fraction: 0.15 })),
    );
    expect(contents['Zn']).toBeCloseTo(1.7, 12);
    expect(contents['Mg']).toBeCloseTo(0.3, 12);
    expect(contents['O']).toBe(2);
  });
});

/** A Zn(1−x)Mg(x)O pattern from the model itself, with noise. */
function pattern(x: number, seed: number) {
  const kind = cellKind(zno.crystalSystem, zno.cell);
  const model: PhaseModel = {
    id: zno.id,
    name: zno.name,
    kind,
    cell: zno.cell,
    reflections: refinementReflections(zno.peaks, zno.cell, kind, 0.8),
    orientation: null,
    tch: true,
    structure: structureModel(zno.cell, structure, factors, {}, false, mg(x)),
  };
  const xs = Float64Array.from({ length: 5001 }, (_, i) => 20 + i * 0.02);
  const layout = makeLayout([model], 3);
  const p = new Float64Array(layout.size);
  p[layout.background[0] as number] = 150;
  const pl = layout.phases[0] as (typeof layout.phases)[number];
  p[pl.cell[0] as number] = zno.cell.a;
  p[pl.cell[1] as number] = zno.cell.c;
  p[pl.scale] = 0.02;
  p[pl.u] = INSTRUMENT.u;
  p[pl.v] = INSTRUMENT.v;
  p[pl.w] = INSTRUMENT.w;
  p[pl.lx] = INSTRUMENT.x;
  p[pl.ly] = INSTRUMENT.y;
  p[pl.orientation] = 1;
  model.structure?.atoms.forEach((atom, a) => {
    const al = pl.atoms[a] as (typeof pl.atoms)[number];
    p[al.occupancy] = atom.occupancy0;
    p[al.b] = atom.b0;
    p[al.fraction] = atom.substitute ? x : 0;
  });
  expect(atomStates(model, pl, p)[0]?.fraction).toBe(x);
  const bg = backgroundCurve(chebyshevBasis(xs, 3), layout, p, xs.length);
  const curve = phaseCurve(xs, [model], layout, 0, p, CU);
  let state = seed;
  const uniform = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  const y = xs.map((_, i) => {
    const mean = (bg[i] as number) + (curve[i] as number);
    const g = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * g));
  });
  return { x: xs, y };
}

function refine(data: { x: Float64Array; y: Float64Array }, subs: Substitution[]) {
  const result = refineRietveld({
    ...data,
    wavelengths: CU,
    phases: [
      {
        id: zno.id,
        name: zno.name,
        crystalSystem: zno.crystalSystem,
        cell: zno.cell,
        peaks: zno.peaks,
        orientation: null,
        structure,
        cellContents: { Zn: 2, O: 2 },
        substitutions: subs,
      },
    ],
    choices: { ...DEFAULT_CHOICES, zero: false },
    backgroundTerms: 3,
    atomicWeights,
    factors,
    instrument: INSTRUMENT,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('Shared-site substitution: refinement', () => {
  it('recovers x = 0.15 of Mg on the Zn site from a start of 0.05', () => {
    const result = refine(pattern(0.15, 41), mg(0.05));
    const zn = result.phases[0]?.atoms?.find((a) => a.label === 'Zn');
    const x = zn?.substitute?.fraction;
    if (!x) throw new Error('no fraction');
    expect(zn?.substitute?.element).toBe('Mg');
    expect(x.refined).toBe(true);
    expect(Math.abs(x.value - 0.15)).toBeLessThan(4 * x.esd);
    expect(x.esd).toBeGreaterThan(0);
    expect(x.esd).toBeLessThan(0.02);
    expect(result.stats.chi2).toBeLessThan(1.15);
    expect(result.stages.some((s) => s.name === 'Substitution fractions on shared sites')).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.includes('cannot tell a dopant from vacancies'))).toBe(
      true,
    );
  }, 120_000);

  it('keeps a fixed fraction at its value', () => {
    const result = refine(pattern(0.15, 43), mg(0.1, false));
    const x = result.phases[0]?.atoms?.find((a) => a.label === 'Zn')?.substitute?.fraction;
    expect(x?.value).toBe(0.1);
    expect(x?.refined).toBe(false);
  }, 120_000);

  it('warns when the two elements differ by three electrons or fewer (Co on Zn)', () => {
    const result = refine(pattern(0, 47), [
      { site: 'Zn', element: 'Co', fraction: 0.05, refine: true },
    ]);
    expect(result.warnings.some((w) => w.includes('differ by only 3 electrons'))).toBe(true);
  }, 120_000);

  it('refuses a substitution on a site the structure does not have', () => {
    const result = refineRietveld({
      ...pattern(0, 49),
      wavelengths: CU,
      phases: [
        {
          id: zno.id,
          name: zno.name,
          crystalSystem: zno.crystalSystem,
          cell: zno.cell,
          peaks: zno.peaks,
          orientation: null,
          structure,
          substitutions: [{ site: 'Zn9', element: 'Mg', fraction: 0.1, refine: true }],
        },
      ],
      choices: DEFAULT_CHOICES,
      backgroundTerms: 3,
      atomicWeights,
      factors,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no site labelled Zn9/);
  });
});
