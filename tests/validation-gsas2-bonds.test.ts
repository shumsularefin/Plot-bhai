// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import {
  findAngles,
  findBonds,
  type GeometryAtom,
  type StructureGeometry,
} from '../src/core/xrd/structure/bonds';
import { bondValenceSums, type BondValenceFile } from '../src/core/xrd/structure/bondValence';
import type { Vec3 } from '../src/core/xrd/structure/geometry';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/bonds.py (run by
 * .github/workflows/validation.yml) simulates a baddeleyite (ZrO2, COD 9007448) pattern, refines
 * it in GSAS-II, and stores GSAS-II's interatomic distances and angles with their s.u.
 * (GSASIIstrMain.RetDistAngle, which uses only the covariance of the atom coordinates), the bond-
 * valence sums GSAS-II prints, and a separate Python reading of bvparm2020.cif with sums and s.u.
 * from GSAS-II's own distance derivatives. Here the same numbers are calculated from GSAS-II's
 * refined structure and covariance, and from this site's own refinement of the same data.
 */
interface Fixture {
  gsas2: {
    Rwp: number;
    cell: number[];
    atoms: { label: string; element: string; x: number[]; occupancy: number }[];
    xyzCovariance: number[][];
  };
  distances: { from: string; to: string; distance: number; su: number }[];
  angles: {
    at: string;
    retDistAngle: { angle: number; su: number };
    first: { to: string; distance: number };
    second: { to: string; distance: number };
    angle: number;
    su: number;
  }[];
  bvsGsas2: Record<string, Record<string, number>>;
  bvparm: Record<string, { state: number; sum: number; su: number; refs: string[] }>;
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/zro2-bonds.json') as Fixture;
const table = json('data/reference/bond-valence.json') as BondValenceFile;
const reference = (
  json('tests/fixtures/cod-reference/zro2.json') as ReferenceFamilyFile
).phases.find((p) => p.id === 'baddeleyite');
if (!reference?.structure) throw new Error('baddeleyite missing');
const ops = reference.structure.ops;
const stored = reference.structure;

// GSAS-II's controls: bond radii Zr 1.4, O 1.0 Å, factor 1, so only Zr–O bonds up to 2.4 Å.
const limit = (a: GeometryAtom, b: GeometryAtom) => (a.element !== b.element ? 2.4 : 0);
const states = (atoms: readonly GeometryAtom[]) => atoms.map((a) => (a.element === 'Zr' ? 4 : -2));

/** GSAS-II's refined structure, with its coordinate covariance and no cell covariance. */
function gsasGeometry(): StructureGeometry {
  const g = fixture.gsas2;
  const n = g.atoms.length;
  const m = 6 + 3 * n;
  const covariance = new Array<number>(m * m).fill(0);
  g.xyzCovariance.forEach((row, i) => row.forEach((v, j) => (covariance[(6 + i) * m + 6 + j] = v)));
  const [a, b, c, alpha, beta, gamma] = g.cell as [number, number, number, number, number, number];
  return {
    cell: { a, b, c, alpha, beta, gamma },
    ops,
    atoms: g.atoms.map((atom) => ({ ...atom, x: [...atom.x] as Vec3 })),
    covariance,
  };
}

describe('GSAS-II bond lengths, angles and bond-valence sums (baddeleyite ZrO2)', () => {
  const geometry = gsasGeometry();
  const bonds = findBonds(geometry, limit);
  const angles = findAngles(geometry, bonds);
  const label = (i: number) => geometry.atoms[i]?.label as string;

  it('gives the same distances and s.u. as GSAS-II RetDistAngle', () => {
    const theirs = [...fixture.distances].sort((p, q) =>
      p.from < q.from ? -1 : p.from > q.from ? 1 : p.distance - q.distance,
    );
    const ours = [...bonds].sort((p, q) =>
      label(p.from) < label(q.from) ? -1 : label(p.from) > label(q.from) ? 1 : p.length - q.length,
    );
    expect(ours.length).toBe(theirs.length);
    ours.forEach((b, i) => {
      const t = theirs[i] as (typeof theirs)[number];
      expect(label(b.from)).toBe(t.from);
      expect(label(b.to)).toBe(t.to);
      expect(b.length).toBeCloseTo(t.distance, 8);
      // GSAS-II differentiates numerically (step 1e-5): agreement to 1e-7 Å.
      expect(Math.abs(b.su - t.su)).toBeLessThan(1e-7);
    });
  });

  it("gives the same angles and s.u. as GSAS-II's getAngSig", () => {
    // RetDistAngle itself passes the transposed orthogonalisation matrix to getAngSig, which
    // gives angles off by up to about 0.8° in this monoclinic cell; bonds.py checks that and
    // stores getAngSig's values with the matrix RetDistAngle uses for the distances.
    expect(angles.length).toBe(fixture.angles.length);
    for (const t of fixture.angles) {
      const lengths = [t.first.distance, t.second.distance].sort();
      const match = angles.filter((a) => {
        const pair = [bonds[a.first], bonds[a.second]];
        const ours = pair.map((b) => b?.length as number).sort();
        return (
          label(a.at) === t.at &&
          ours.every((d, k) => Math.abs(d - (lengths[k] as number)) < 1e-6) &&
          Math.abs(a.value - t.angle) < 1e-4
        );
      });
      expect(match.length).toBe(1);
      const ours = match[0] as (typeof angles)[number];
      expect(ours.value).toBeCloseTo(t.angle, 6);
      // GSAS-II reports s.u. below 0.01° as 0.
      if (t.su > 0) expect(Math.abs(ours.su - t.su)).toBeLessThan(1e-5);
      else expect(ours.su).toBeLessThan(0.01);
    }
  });

  it('gives the bond-valence sums and s.u. of an independent reading of bvparm2020', () => {
    const sums = bondValenceSums(
      table,
      geometry.atoms,
      states(geometry.atoms),
      bonds,
      geometry.covariance,
    );
    for (const site of sums) {
      const t = fixture.bvparm[label(site.site)];
      if (!t) throw new Error(`no ${label(site.site)}`);
      expect(site.sum).toBeCloseTo(t.sum, 8);
      expect(Math.abs(site.su - t.su)).toBeLessThan(1e-7);
      expect(site.refs).toEqual(t.refs);
    }
  });

  it("gives GSAS-II's own sum for Zr when given GSAS-II's R₀ (atmdata.BVScoeff, b = 0.37)", () => {
    // GSAS-II's Zr4+–O2− R₀ is 1.937 Å (Brese and O'Keeffe 1991, the table's ref b entry).
    const own: BondValenceFile = { ...table, params: [['Zr', 4, 'O', -2, 1.937, 0.37, 'b']] };
    const zr = bondValenceSums(
      own,
      geometry.atoms,
      states(geometry.atoms),
      bonds,
      geometry.covariance,
    )[0];
    expect(Math.abs((zr?.sum as number) - (fixture.bvsGsas2.Zr?.['Zr+4'] as number))).toBeLessThan(
      0.005,
    );
  });
});

describe("this site's refinement of the same pattern", () => {
  const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
    .factors;
  const atomicWeights = Object.fromEntries(
    (
      json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
    ).elements.map((e) => [e.symbol, e.weight]),
  );
  const rows = read('tests/fixtures/validation/zro2-bonds.xy')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  // bonds.py simulates with the same cu.instprm as structure.py, whose fixture records its Kα lines.
  const { wavelengths } = json('tests/fixtures/validation/anatase-tch.json') as {
    wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  };
  const result = refineRietveld({
    x: Float64Array.from(rows, (r) => r[0] as number),
    y: Float64Array.from(rows, (r) => r[1] as number),
    wavelengths,
    phases: [
      {
        id: 'baddeleyite',
        name: 'baddeleyite',
        crystalSystem: reference.crystalSystem,
        cell: reference.cell,
        peaks: reference.peaks,
        orientation: null,
        structure: {
          ...stored,
          atoms: stored.atoms.map((a) => ({ ...a, uIso: 0.01, uAniso: null })),
        },
      },
    ],
    choices: { ...DEFAULT_CHOICES, tch: true, positions: true, biso: true },
    backgroundTerms: 6,
    atomicWeights,
    factors,
  });
  if (!result.ok) throw new Error(result.error);
  const phase = result.phases[0];
  const geometry = phase?.geometry;
  const refinedAtoms = phase?.atoms;
  if (!geometry || !refinedAtoms) throw new Error('no geometry');

  it('reports a covariance whose diagonal gives the cell and coordinate s.u. of the results', () => {
    const m = 6 + 3 * geometry.atoms.length;
    const sd = (i: number) => Math.sqrt(geometry.covariance[i * m + i] as number);
    (['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const).forEach((key, i) =>
      expect(sd(i)).toBeCloseTo((phase as NonNullable<typeof phase>).cell[key].esd, 9),
    );
    refinedAtoms.forEach((atom, a) =>
      atom.x.forEach((e, i) => expect(sd(6 + 3 * a + i)).toBeCloseTo(e.esd, 9)),
    );
  });

  it("finds GSAS-II's bonds with lengths within 3 combined s.u., and similar s.u.", () => {
    const ours = findBonds(geometry, limit);
    const theirs = findBonds(gsasGeometry(), limit);
    expect(ours.length).toBe(theirs.length);
    // Coordinate-only s.u. as GSAS-II reports them: the cell block of the covariance set to zero.
    const m = 6 + 3 * geometry.atoms.length;
    const coordinatesOnly = geometry.covariance.map((v, k) =>
      Math.floor(k / m) < 6 || k % m < 6 ? 0 : v,
    );
    const bare = findBonds({ ...geometry, covariance: coordinatesOnly }, limit);
    ours.forEach((b, i) => {
      const t = theirs.find((q) => q.from === b.from && q.to === b.to && q.symmetry === b.symmetry);
      if (!t) throw new Error('bond missing');
      expect(Math.abs(b.length - t.length)).toBeLessThan(3 * Math.hypot(b.su, t.su));
      const ratio = (bare[i]?.su as number) / t.su;
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.4);
    });
  });
});
