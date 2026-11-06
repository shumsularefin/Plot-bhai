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
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import {
  positiveDefinite,
  rotateTensor,
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
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };
const modelOf = (ref: ReferencePhase, all = false) =>
  structureModel(
    ref.cell,
    ref.structure as NonNullable<ReferencePhase['structure']>,
    factors,
    {},
    all,
  );

describe('Site-symmetry constraints on U_ij', () => {
  // Free U_ij per site (International Tables / Peterse–Palm rules): rutile 2a (mmm) and 4f (m.mm):
  // U11 = U22, U33, U12; anatase 4a (-4m2) and 8e (2mm.): U11, U22, U33 with U11 = U22 for 4a;
  // CeO2 Ce 4a (m-3m) and O 8c (-43m): U11 = U22 = U33 only.
  it.each([
    ['tio2', 'rutile', [3, 3]],
    ['tio2', 'anatase', [2, 3]],
    ['ceo2', 'ceo2', [1, 1]],
    ['tio2', 'brookite', [6, 6, 6]],
  ])('%s %s has %j free U terms', (file, id, counts) => {
    const model = modelOf(phase(file, id), true);
    expect(model.atoms.map((a) => a.uBasisCif.length)).toEqual(counts);
  });

  it('leaves the file values unchanged by every operator of the site (invariance)', () => {
    for (const id of ['rutile', 'anatase']) {
      const model = modelOf(phase('tio2', id));
      for (const atom of model.atoms) {
        const u0 = atom.u0 as number[];
        for (const image of atom.images.filter((im) =>
          im.op.rot.every((v, i) => v === [1, 0, 0, 0, 1, 0, 0, 0, 1][i]),
        ))
          expect(rotateTensor(image.op.rot, u0)).toEqual(u0);
        // Every allowed direction keeps the stabiliser symmetry: R v Rᵀ = v.
        for (const v of atom.uBasis)
          for (const image of atom.images)
            if (
              image.op.trans.every((t) => t === 0) &&
              image.op.rot.every((r, i) => r === [-1, 0, 0, 0, -1, 0, 0, 0, -1][i])
            )
              rotateTensor(image.op.rot, v).forEach((c, i) =>
                expect(c).toBeCloseTo(v[i] as number, 12),
              );
      }
    }
  });

  it('gives the same structure factors for an isotropic atom written as a tensor', () => {
    const ref = phase('tio2', 'brookite');
    const structure = ref.structure as NonNullable<ReferencePhase['structure']>;
    const iso = { ...structure, atoms: structure.atoms.map((a) => ({ ...a, uIso: 0.008 })) };
    const m1 = structureModel(ref.cell, iso, factors, {});
    const m2 = structureModel(ref.cell, iso, factors, {}, true);
    const st = (m: typeof m1) =>
      m.atoms.map((a) => ({
        x: a.x0,
        occupancy: 1,
        b: a.b0,
        ...(a.u0 && { uImages: a.images.map((im) => rotateTensor(im.op.rot, a.u0 as number[])) }),
      }));
    for (const hkl of [
      [1, 1, 1],
      [2, 0, 0],
      [1, 2, 3],
      [4, 1, 2],
    ] as [number, number, number][]) {
      const d =
        1 /
        Math.sqrt(
          hkl[0] ** 2 / ref.cell.a ** 2 +
            hkl[1] ** 2 / ref.cell.b ** 2 +
            hkl[2] ** 2 / ref.cell.c ** 2,
        );
      const a = structureFactorSquared(m1, st(m1), hkl, d);
      const b = structureFactorSquared(m2, st(m2), hkl, d);
      expect(Math.abs(a - b) / a).toBeLessThan(1e-10);
    }
  });

  it('detects tensors that are not positive definite', () => {
    expect(positiveDefinite([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true);
    expect(positiveDefinite([1, 2, 0, 2, 1, 0, 0, 0, 1])).toBe(false);
  });
});

describe('Anisotropic refinement of a synthetic pattern', () => {
  it('recovers perturbed U_ij of rutile', () => {
    const ref = phase('tio2', 'rutile');
    const kind = cellKind(ref.crystalSystem, ref.cell);
    const structure = modelOf(ref, true);
    const model: PhaseModel = {
      id: ref.id,
      name: ref.name,
      kind,
      cell: ref.cell,
      reflections: refinementReflections(ref.peaks, ref.cell, kind, 0.8),
      orientation: null,
      structure,
    };
    const x = Float64Array.from({ length: 6501 }, (_, i) => 20 + i * 0.02);
    const layout = makeLayout([model], 3);
    const p = new Float64Array(layout.size);
    p[layout.background[0] as number] = 100;
    const pl = layout.phases[0] as (typeof layout.phases)[number];
    p[pl.cell[0] as number] = ref.cell.a;
    p[pl.cell[1] as number] = ref.cell.c;
    p[pl.scale] = 3e-4;
    p[pl.w] = 0.006;
    p[pl.eta] = 0.4;
    p[pl.orientation] = 1;
    const shifts = [0.004, -0.002, 0.003, 0.006, 0.004, -0.003];
    let s = 0;
    for (const al of pl.atoms) {
      p[al.occupancy] = 1;
      for (const j of al.aniso) p[j] = shifts[s++] ?? 0;
    }
    expect(
      atomStates(model, pl, p).every((st) => st.uImages?.[0] && positiveDefinite(st.uImages[0])),
    ).toBe(true);
    const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
    const curve = phaseCurve(x, [model], layout, 0, p, CU);
    // Strong, noise-free data: the least squares alone is tested here.
    const y = x.map((_, i) => (bg[i] as number) + (curve[i] as number));
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
          ...(ref.structure && { structure: ref.structure }),
        },
      ],
      choices: { ...DEFAULT_CHOICES, zero: false, widthSlope: false, aniso: true },
      backgroundTerms: 3,
      atomicWeights,
      factors,
    });
    if (!result.ok) throw new Error(result.error);
    const atoms = result.phases[0]?.atoms ?? [];
    atoms.forEach((atom, a) => {
      const truth = structure.atoms[a];
      if (!truth?.uCif0 || !atom.u) throw new Error('no U');
      const al = pl.atoms[a] as (typeof pl.atoms)[number];
      truth.uCif0.forEach((u0, q) => {
        const want =
          u0 +
          al.aniso.reduce(
            (sum, j, k) => sum + (p[j] as number) * ((truth.uBasisCif[k] as number[])[q] as number),
            0,
          );
        expect(Math.abs((atom.u?.[q]?.value ?? 0) - want)).toBeLessThan(2e-4);
      });
      expect(atom.positiveDefinite).toBe(true);
    });
    expect(result.stages.map((st) => st.name)).toContain('Anisotropic displacement (U_ij)');
  }, 120_000);
});
