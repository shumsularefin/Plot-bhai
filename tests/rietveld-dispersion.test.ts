// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactor, FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { applySymop } from '../src/core/xrd/structure/geometry';
import { dispersionFor, type DispersionFile } from '../src/core/xrd/rietveld/dispersion';
import type { Hkl } from '../src/core/xrd/rietveld/reflections';
import { cylinderAbsorption } from '../src/core/xrd/rietveld/sample';
import {
  structureFactorSquared,
  structureModel,
  type Dispersion,
  type StructureModel,
} from '../src/core/xrd/rietveld/structure';

/*
 * Invariance and round-trip checks of anomalous dispersion and cylinder absorption (the comparison
 * with GSAS-II is in validation-gsas2-dispersion.test.ts).
 */
const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const table = json('data/reference/anomalous-dispersion.json') as DispersionFile;
const cu = dispersionFor(table, 'Cu') as Dispersion;
const phase = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;
const zno = phase('zno', 'zno-wurtzite');
const ceo2 = phase('ceo2', 'ceo2');
const RAD = Math.PI / 180;

const hexD = ({ a, c }: ReferencePhase['cell'], [h, k, l]: Hkl) =>
  1 / Math.sqrt((4 * (h * h + h * k + k * k)) / (3 * a * a) + (l * l) / (c * c));
const cubicD = ({ a }: ReferencePhase['cell'], [h, k, l]: Hkl) =>
  a / Math.sqrt(h * h + k * k + l * l);

function model(p: ReferencePhase, dispersion?: Dispersion): StructureModel {
  // Isotropic atoms, so the direct sum below can use B alone.
  const stored = p.structure as NonNullable<ReferencePhase['structure']>;
  const s = { ...stored, atoms: stored.atoms.map((a) => ({ ...a, uAniso: null })) };
  return structureModel(p.cell, s, factors, {}, false, [], dispersion);
}
const states = (m: StructureModel) =>
  m.atoms.map((a) => ({ x: a.x0, occupancy: a.occupancy0, b: a.b0 }));
const f2 = (m: StructureModel, hkl: Hkl, d: number) => structureFactorSquared(m, states(m), hkl, d);

/** F(h) as a complex number, summed directly with f = f0 + f′ + i f″. */
function complexF(m: StructureModel, [h, k, l]: Hkl, d: number): [number, number] {
  const s2 = 1 / (4 * d * d);
  const f0 = (f: FormFactor) => {
    let v = f[8];
    for (let i = 0; i < 4; i++) v += f[i] * Math.exp(-f[i + 4] * s2);
    return v;
  };
  let re = 0;
  let im = 0;
  for (const atom of m.atoms) {
    const fr = f0(atom.factor) + atom.dispersion[0];
    const fi = atom.dispersion[1];
    const w = atom.occupancy0 * Math.exp(-atom.b0 * s2);
    for (const image of atom.images) {
      const x = applySymop(image.op, atom.x0);
      const p = 2 * Math.PI * (h * x[0] + k * x[1] + l * x[2]);
      // (fr + i fi)(cos p + i sin p)
      re += w * (fr * Math.cos(p) - fi * Math.sin(p));
      im += w * (fr * Math.sin(p) + fi * Math.cos(p));
    }
  }
  return [re, im];
}
const abs2 = ([re, im]: [number, number]) => re * re + im * im;

const ZNO_HKL: Hkl[] = [
  [1, 0, 0],
  [0, 0, 2],
  [1, 0, 1],
  [1, 0, 2],
  [1, 0, 3],
  [2, 0, 1],
  [1, 1, 4],
];

describe('Anomalous dispersion in |F|²', () => {
  it('a table of zeros gives exactly the result without one', () => {
    const zeros = Object.fromEntries(Object.keys(factors).map((el) => [el, [0, 0] as const]));
    const plain = model(zno);
    const zero = model(zno, zeros);
    for (const hkl of ZNO_HKL) {
      const d = hexD(zno.cell, hkl);
      expect(f2(zero, hkl, d)).toBe(f2(plain, hkl, d));
    }
  });

  it('is the mean of |F(h)|² and |F(−h)|² summed with complex f (non-centrosymmetric ZnO)', () => {
    const m = model(zno, cu);
    let friedel = 0;
    for (const hkl of ZNO_HKL) {
      const d = hexD(zno.cell, hkl);
      const minus: Hkl = [-hkl[0], -hkl[1], -hkl[2]];
      const plus = abs2(complexF(m, hkl, d));
      const neg = abs2(complexF(m, minus, d));
      friedel = Math.max(friedel, Math.abs(plus - neg) / plus);
      expect(f2(m, hkl, d)).toBeCloseTo((plus + neg) / 2, 8);
    }
    // f″ breaks Friedel's law for ZnO, which is why the mean is needed.
    expect(friedel).toBeGreaterThan(1e-3);
  });

  it('obeys Friedel’s law for centrosymmetric CeO₂, and equivalent reflections agree', () => {
    const m = model(ceo2, cu);
    const sets: Hkl[][] = [
      [
        [1, 1, 1],
        [-1, 1, 1],
        [1, -1, -1],
      ],
      [
        [2, 0, 0],
        [0, 2, 0],
        [0, 0, -2],
      ],
      [
        [3, 1, 1],
        [1, 3, 1],
        [-1, 1, -3],
      ],
    ];
    for (const set of sets) {
      const d = cubicD(ceo2.cell, set[0] as Hkl);
      const ref = f2(m, set[0] as Hkl, d);
      for (const hkl of set) {
        expect(f2(m, hkl, d) / ref).toBeCloseTo(1, 10);
        const minus: Hkl = [-hkl[0], -hkl[1], -hkl[2]];
        expect(abs2(complexF(m, minus, d)) / abs2(complexF(m, hkl, d))).toBeCloseTo(1, 10);
      }
    }
  });

  it('fills H and He, which have no Cromer–Liberman orbitals, with zeros as GSAS-II does', () => {
    expect(cu.H).toEqual([0, 0]);
    expect(cu.He).toEqual([0, 0]);
    expect(dispersionFor(table, 'Xx' as never)).toBeUndefined();
  });

  it('refuses an element with no values rather than using zero silently', () => {
    const { Zn: _, ...withoutZn } = cu;
    expect(() => model(zno, withoutZn)).toThrow(/Zn/);
  });
});

describe('Cylinder absorption', () => {
  const thetas = [2.5, 10, 22.5, 45, 60, 75, 87.5].map((t) => t * RAD);

  it('is 1 without absorption', () => {
    for (const t of thetas) expect(cylinderAbsorption(0, t)).toBe(1);
  });

  it('falls as μR grows and rises with 2θ (less path through the capillary at high angle)', () => {
    const mus = [0, 0.5, 1, 2, 3, 4, 6, 10];
    for (const t of thetas) {
      for (let i = 1; i < mus.length; i++) {
        expect(cylinderAbsorption(mus[i] as number, t)).toBeLessThan(
          cylinderAbsorption(mus[i - 1] as number, t),
        );
      }
    }
    for (const mu of [0.5, 2, 5]) {
      for (let i = 1; i < thetas.length; i++) {
        expect(cylinderAbsorption(mu, thetas[i] as number)).toBeGreaterThan(
          cylinderAbsorption(mu, thetas[i - 1] as number),
        );
      }
    }
  });

  it('has the step of GSAS-II’s two-branch fit at μR = 3, at most 3 % (largest 2.7 % on 0.5–89.5°)', () => {
    // The fit is not continuous there; the site keeps GSAS-II's formulas, so the step is the same.
    let largest = 0;
    for (let t = 0.5; t < 90; t += 0.5) {
      const below = cylinderAbsorption(3 - 1e-12, t * RAD);
      const above = cylinderAbsorption(3 + 1e-12, t * RAD);
      largest = Math.max(largest, Math.abs(above - below) / below);
    }
    expect(largest).toBeLessThan(0.03);
  });
});
