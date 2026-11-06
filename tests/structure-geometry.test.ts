// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { cifNumber, loopWith, parseCif } from '../src/core/xrd/reference/cif';
import {
  crystalFromCif,
  expandAtoms,
  type Crystal,
  type FormFactors,
} from '../src/core/xrd/reference/powder';
import { formatSymop, parseSymop } from '../src/core/xrd/reference/symmetry';
import {
  angle,
  applySymop,
  bonds,
  cartesianMatrix,
  cellAtoms,
  crystalFromStored,
  directMetric,
  distance,
  storeStructure,
  toCartesian,
  type Vec3,
} from '../src/core/xrd/structure/geometry';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, root), 'utf8');
const factors = (
  JSON.parse(text('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;
const radii = (
  JSON.parse(text('data/reference/covalent-radii.json')) as { radii: Record<string, number> }
).radii;

const cubic = (a: number) => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });

describe('metric tensor geometry (known answers)', () => {
  it('cubic cell: edge, face diagonal, body diagonal and the tetrahedral angle', () => {
    const cell = cubic(4);
    expect(distance(cell, [0, 0, 0], [1, 0, 0])).toBeCloseTo(4, 12);
    expect(distance(cell, [0, 0, 0], [1, 1, 0])).toBeCloseTo(4 * Math.SQRT2, 12);
    expect(distance(cell, [0, 0, 0], [1, 1, 1])).toBeCloseTo(4 * Math.sqrt(3), 12);
    // Angle between two body diagonals from the cell centre: arccos(−1/3) = 109.4712°.
    expect(angle(cell, [0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 0])).toBeCloseTo(
      (Math.acos(-1 / 3) * 180) / Math.PI,
      10,
    );
  });

  it('hexagonal cell: |a + b| = a because γ = 120°, and the angle between a and b is 120°', () => {
    const cell = { a: 3, b: 3, c: 5, alpha: 90, beta: 90, gamma: 120 };
    expect(distance(cell, [0, 0, 0], [1, 1, 0])).toBeCloseTo(3, 12);
    expect(angle(cell, [1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(120, 10);
  });

  it('Cartesian coordinates give the same lengths and angles as the metric tensor (triclinic)', () => {
    const cell = { a: 5.1, b: 6.3, c: 7.7, alpha: 81, beta: 103, gamma: 95 };
    const m = cartesianMatrix(cell);
    const p: Vec3[] = [
      [0.1, 0.2, 0.3],
      [0.7, -0.4, 1.2],
      [0.35, 0.9, 0.05],
    ];
    const [r0, r1, r2] = p.map((x) => toCartesian(m, x)) as [Vec3, Vec3, Vec3];
    const len = (u: Vec3, v: Vec3) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    expect(len(r0, r1)).toBeCloseTo(distance(cell, p[0] as Vec3, p[1] as Vec3), 12);
    const u = r0.map((v, i) => v - (r1[i] as number));
    const w = r2.map((v, i) => v - (r1[i] as number));
    const cos =
      u.reduce((s, v, i) => s + v * (w[i] as number), 0) / (Math.hypot(...u) * Math.hypot(...w));
    expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(
      angle(cell, p[0] as Vec3, p[1] as Vec3, p[2] as Vec3),
      10,
    );
    // Mᵀ M = G.
    const g = directMetric(cell);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += (m[k * 3 + i] as number) * (m[k * 3 + j] as number);
        expect(s).toBeCloseTo(g[i * 3 + j] as number, 10);
      }
  });
});

describe('symmetry operators and the drawn cell', () => {
  it('formatSymop round-trips through parseSymop', () => {
    for (const t of [
      'x,y,z',
      '-x+1/2,y,z+1/4',
      'x-y,x,z+1/6',
      '-y+2/3,x-y+1/3,z+1/3',
      '-x,-y,-z',
    ]) {
      const op = parseSymop(t);
      expect(parseSymop(formatSymop(op))).toEqual(op);
    }
  });

  it('rock salt NaCl (Fm-3m) draws 14 Na and 13 Cl in one cell, 4 + 4 inside it', () => {
    const cif = readdirSync(new URL('scripts/cif-cache/', root));
    expect(cif.length).toBeGreaterThan(0);
    const halides = JSON.parse(
      text('tests/fixtures/cod-reference/alkali-halides.json'),
    ) as ReferenceFamilyFile;
    const nacl = halides.phases.find((p) => p.formula === 'NaCl');
    expect(nacl?.structure).toBeDefined();
    if (!nacl?.structure) return;
    const crystal = crystalFromStored(nacl.cell, nacl.structure);
    const atoms = cellAtoms(crystal);
    const count = (el: string) => atoms.filter((a) => a.element === el).length;
    const corners = atoms.filter((a) => a.element === nacl.structure?.atoms[0]?.element);
    // Na at 0,0,0 (8 corners + 6 faces = 14); Cl at ½,½,½ (12 edges + 1 centre = 13).
    expect([count('Na'), count('Cl')].sort()).toEqual([13, 14]);
    expect(corners.length === 14 || corners.length === 13).toBe(true);
    expect(expandAtoms(crystal).length).toBe(8);
    // Each Na–Cl bond is a/2; with covalent radii every Na has bonds only to Cl.
    const list = bonds(nacl.cell, atoms, radii);
    for (const [i, j] of list) {
      const a = atoms[i];
      const b = atoms[j];
      expect(a?.element).not.toBe(b?.element);
      expect(distance(nacl.cell, a?.x as Vec3, b?.x as Vec3)).toBeCloseTo(nacl.cell.a / 2, 6);
    }
    expect(list.length).toBeGreaterThan(0);
  });

  it('every stored library structure rebuilds the same unit cell as the CIF', () => {
    const files = readdirSync(new URL('tests/fixtures/cod-reference/', root)).filter(
      (f) => f !== 'index.json',
    );
    let checked = 0;
    for (const file of files) {
      const family = JSON.parse(
        text(`tests/fixtures/cod-reference/${file}`),
      ) as ReferenceFamilyFile;
      for (const phase of family.phases) {
        if (!phase.structure || phase.codId === null) continue;
        const original = crystalFromCif(
          parseCif(text(`scripts/cif-cache/${phase.codId}.cif`)),
          factors,
        );
        const stored = crystalFromStored(phase.cell, phase.structure);
        expect(stored.ops).toEqual(original.ops);
        expect(expandAtoms(stored).length).toBe(expandAtoms(original).length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

/**
 * A position named by a CIF symmetry code "n_klm": operator n of the list, then translation
 * (k−5, l−5, m−5). Codes with three-digit n follow the GSAS numbering (100 × centring + operator),
 * not the list order, and negative n (SHELX-style inversion) is not defined by the CIF
 * dictionary; both are skipped.
 */
function placed(crystal: Crystal, x: Vec3, code: string | undefined): Vec3 | null {
  if (!code || code === '.' || code === '?') return x;
  const m = /^(\d{1,2})_(\d)(\d)(\d)$/.exec(code);
  const op = m ? crystal.ops[Number(m[1]) - 1] : undefined;
  if (!m || !op) return null;
  return applySymop(op, x, [Number(m[2]) - 5, Number(m[3]) - 5, Number(m[4]) - 5]);
}

/** Standard uncertainty of a CIF number such as 3.5316(2) → 0.0002. */
function esd(value: string): number {
  const m = /\.(\d*)\((\d+)\)/.exec(value);
  if (!m) return 0;
  return Number(m[2]) * 10 ** -(m[1] as string).length;
}

describe('distances and angles against the geometry tables printed in COD CIFs', () => {
  const files = readdirSync(new URL('scripts/cif-cache/', root)).filter((f) =>
    text(`scripts/cif-cache/${f}`).includes('_geom_bond_distance'),
  );

  let checkedRows = 0;
  it('finds the CIFs with geometry tables', () => expect(files.length).toBeGreaterThanOrEqual(10));

  for (const file of files) {
    it(`${file}: every bond and angle with a positive symmetry code`, () => {
      const block = parseCif(text(`scripts/cif-cache/${file}`));
      const crystal = crystalFromCif(block, factors);
      const at = new Map(crystal.atoms.map((a) => [a.label, a.x]));
      let n = 0;
      for (const row of loopWith(block, '_geom_bond_distance')) {
        const x1 = at.get(row.get('_geom_bond_atom_site_label_1') ?? '');
        const x2 = at.get(row.get('_geom_bond_atom_site_label_2') ?? '');
        const value = row.get('_geom_bond_distance') ?? '';
        const p1 = x1 && placed(crystal, x1, row.get('_geom_bond_site_symmetry_1') ?? undefined);
        const p2 = x2 && placed(crystal, x2, row.get('_geom_bond_site_symmetry_2') ?? undefined);
        if (!p1 || !p2) continue;
        // Coordinates in the file are rounded to their own uncertainty, so allow 3σ + 0.002 Å.
        expect(
          Math.abs(distance(crystal.cell, p1, p2) - (cifNumber(value) as number)),
        ).toBeLessThan(3 * esd(value) + 0.002);
        n++;
      }
      for (const row of loopWith(block, '_geom_angle')) {
        const label = (k: number) => at.get(row.get(`_geom_angle_atom_site_label_${k}`) ?? '');
        const [x1, x2, x3] = [label(1), label(2), label(3)];
        const value = row.get('_geom_angle') ?? '';
        const p1 = x1 && placed(crystal, x1, row.get('_geom_angle_site_symmetry_1') ?? undefined);
        const p2 = x2 && placed(crystal, x2, row.get('_geom_angle_site_symmetry_2') ?? undefined);
        const p3 = x3 && placed(crystal, x3, row.get('_geom_angle_site_symmetry_3') ?? undefined);
        if (!p1 || !p2 || !p3) continue;
        expect(
          Math.abs(angle(crystal.cell, p1, p2, p3) - (cifNumber(value) as number)),
        ).toBeLessThan(3 * esd(value) + 0.1);
        n++;
      }
      checkedRows += n;
    });
  }
  it('checked enough rows in total', () => expect(checkedRows).toBeGreaterThan(200));
});

describe('invariance', () => {
  it('a symmetry-equivalent pair gives the same distance, and a lattice shift changes nothing', () => {
    const block = parseCif(text('scripts/cif-cache/1513300.cif'));
    const crystal = crystalFromCif(block, factors);
    const [a, b] = crystal.atoms;
    if (!a || !b) throw new Error('need two atoms');
    const d0 = distance(crystal.cell, a.x, b.x);
    for (const op of crystal.ops) {
      expect(distance(crystal.cell, applySymop(op, a.x), applySymop(op, b.x))).toBeCloseTo(d0, 10);
      expect(
        distance(crystal.cell, applySymop(op, a.x, [1, -2, 3]), applySymop(op, b.x, [1, -2, 3])),
      ).toBeCloseTo(d0, 10);
    }
  });

  it('storeStructure keeps operators and atoms', () => {
    const crystal = crystalFromCif(parseCif(text('scripts/cif-cache/1513300.cif')), factors);
    const back = crystalFromStored(crystal.cell, storeStructure(crystal));
    expect(back.ops).toEqual(crystal.ops);
    expect(back.atoms.map((x) => x.label)).toEqual(crystal.atoms.map((x) => x.label));
  });
});
