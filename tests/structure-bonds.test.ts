// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCif } from '../src/core/xrd/reference/cif';
import { crystalFromCif, type FormFactors } from '../src/core/xrd/reference/powder';
import { formatSymop, parseSymop } from '../src/core/xrd/reference/symmetry';
import { applySymop, type Vec3 } from '../src/core/xrd/structure/geometry';
import {
  covalentLimit,
  findAngles,
  findBonds,
  symmetryCode,
  type Bond,
  type StructureGeometry,
} from '../src/core/xrd/structure/bonds';
import {
  bondValenceParameter,
  bondValenceSums,
  offeredStates,
  suggestStates,
  type BondValenceFile,
} from '../src/core/xrd/structure/bondValence';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, root), 'utf8');
const factors = (
  JSON.parse(text('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;
const radii = (
  JSON.parse(text('data/reference/covalent-radii.json')) as { radii: Record<string, number> }
).radii;
const table = JSON.parse(text('data/reference/bond-valence.json')) as BondValenceFile;

const CELL_KEYS = ['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const;

/** A COD structure with a given covariance (zero by default). */
function fromCod(cod: string, covariance?: number[]): StructureGeometry {
  const crystal = crystalFromCif(parseCif(text(`scripts/cif-cache/${cod}.cif`)), factors);
  const m = 6 + 3 * crystal.atoms.length;
  return {
    cell: crystal.cell,
    ops: crystal.ops.map(formatSymop),
    atoms: crystal.atoms.map((a) => ({
      label: a.label,
      element: a.element,
      x: [...a.x] as Vec3,
      occupancy: a.occupancy,
    })),
    covariance: covariance ?? new Array<number>(m * m).fill(0),
  };
}

const params = (g: StructureGeometry) => [
  ...CELL_KEYS.map((k) => g.cell[k]),
  ...g.atoms.flatMap((a) => a.x),
];
function withParams(g: StructureGeometry, p: readonly number[]): StructureGeometry {
  return {
    ...g,
    cell: Object.fromEntries(
      CELL_KEYS.map((k, i) => [k, p[i] as number]),
    ) as unknown as StructureGeometry['cell'],
    atoms: g.atoms.map((a, i) => ({ ...a, x: p.slice(6 + 3 * i, 9 + 3 * i) as Vec3 })),
  };
}

/** A random positive-definite covariance with the given standard deviations (Å, °, fractions). */
function randomCovariance(sd: readonly number[], seed: number): number[] {
  const m = sd.length;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  // C = D (L Lᵀ / scale) D with a random lower-triangular L: correlated, positive definite.
  const l = Array.from({ length: m * m }, (_, k) => (k % m <= Math.floor(k / m) ? rand() : 0));
  const c = new Array<number>(m * m).fill(0);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < m; j++) {
      let v = 0;
      for (let k = 0; k < m; k++) v += (l[i * m + k] as number) * (l[j * m + k] as number);
      c[i * m + j] = v;
    }
  const diag = Array.from({ length: m }, (_, i) => Math.sqrt(c[i * m + i] as number));
  return c.map((v, k) => {
    const i = Math.floor(k / m);
    const j = k % m;
    return (
      (v / ((diag[i] as number) * (diag[j] as number))) * (sd[i] as number) * (sd[j] as number)
    );
  });
}

/** Cholesky factor of a positive-definite matrix (row-major, lower triangle). */
function cholesky(c: readonly number[], m: number): number[] {
  const l = new Array<number>(m * m).fill(0);
  for (let i = 0; i < m; i++)
    for (let j = 0; j <= i; j++) {
      let s = c[i * m + j] as number;
      for (let k = 0; k < j; k++) s -= (l[i * m + k] as number) * (l[j * m + k] as number);
      l[i * m + j] = i === j ? Math.sqrt(Math.max(s, 0)) : s / (l[j * m + j] as number);
    }
  return l;
}

const pymatgen = JSON.parse(text('tests/fixtures/validation/pymatgen.json')) as {
  cases: { cod: string; sites: { label: string; distances: number[] }[] }[];
};

describe('bond search', () => {
  it.each(pymatgen.cases)('finds the same distances up to 3.2 Å as pymatgen (COD $cod)', (c) => {
    const bonds = findBonds(fromCod(c.cod), () => 3.2);
    const g = fromCod(c.cod);
    for (const site of c.sites) {
      const i = g.atoms.findIndex((a) => a.label === site.label);
      const ours = bonds.filter((b) => b.from === i).map((b) => b.length);
      expect(ours.length).toBe(site.distances.length);
      ours.forEach((d, k) => expect(d).toBeCloseTo(site.distances[k] as number, 4));
    }
  });

  it('writes CIF symmetry codes and places each target where its code says', () => {
    expect(symmetryCode(0, [0, 0, 0])).toBe('.');
    expect(symmetryCode(1, [1, 0, -1])).toBe('2_654');
    const g = fromCod('9007448');
    for (const bond of findBonds(g, covalentLimit(radii))) {
      const x = applySymop(
        parseSymop(g.ops[bond.op] as string),
        (g.atoms[bond.to] as { x: Vec3 }).x,
        bond.n,
      );
      expect(x.every(Number.isFinite)).toBe(true);
    }
  });

  it('gives zero uncertainty without a covariance', () => {
    const bonds = findBonds(fromCod('9007448'), covalentLimit(radii));
    expect(bonds.length).toBeGreaterThan(0);
    expect(bonds.every((b) => b.su === 0)).toBe(true);
  });
});

describe('uncertainty of lengths and angles', () => {
  // Baddeleyite (monoclinic ZrO2, P2₁/c, COD 9007448): every atom on a general position.
  const g0 = fromCod('9007448');
  const p0 = params(g0);
  const limit = covalentLimit(radii);
  const zrO = (b: Bond) => g0.atoms[b.from]?.element === 'Zr' && g0.atoms[b.to]?.element === 'O';

  it('analytic gradients equal central finite differences (cell and coordinates)', () => {
    const bonds = findBonds(g0, limit).filter(zrO);
    const h = 1e-6;
    for (const bond of bonds.slice(0, 7)) {
      for (let k = 0; k < p0.length; k++) {
        const plus = p0.slice();
        const minus = p0.slice();
        plus[k] = (plus[k] as number) + h;
        minus[k] = (minus[k] as number) - h;
        const at = (p: number[]) =>
          findBonds(withParams(g0, p), () => 2.6).find(
            (b) => b.from === bond.from && b.to === bond.to && b.symmetry === bond.symmetry,
          )?.length as number;
        const fd = (at(plus) - at(minus)) / (2 * h);
        expect(bond.gradient[k]).toBeCloseTo(fd, 5);
      }
    }
  });

  it('propagated s.u. match the scatter of Monte Carlo samples from the covariance', () => {
    // s.d. 0.0005 Å, 0.02° and 0.0008 for the cell, angles and coordinates, correlated.
    const sd = p0.map((_, k) => (k < 3 ? 5e-4 : k < 6 ? 0.02 : 8e-4));
    const cov = randomCovariance(sd, 7);
    const g = { ...g0, covariance: cov };
    const bonds = findBonds(g, limit).filter(zrO);
    const angles = findAngles(g, bonds)
      .filter((a) => a.at === 0)
      .slice(0, 6);
    const m = p0.length;
    const l = cholesky(cov, m);
    let s = 3;
    const gauss = () => {
      // Box–Muller with a small linear congruential generator (reproducible).
      s = (s * 1103515245 + 12345) % 2147483648;
      const u1 = (s + 1) / 2147483649;
      s = (s * 1103515245 + 12345) % 2147483648;
      const u2 = s / 2147483648;
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const samples = 4000;
    const lengths = bonds.map(() => [] as number[]);
    const values = angles.map(() => [] as number[]);
    for (let t = 0; t < samples; t++) {
      const z = Array.from({ length: m }, gauss);
      const p = p0.map((v, i) => {
        let d = 0;
        for (let k = 0; k <= i; k++) d += (l[i * m + k] as number) * (z[k] as number);
        return v + d;
      });
      const gs = withParams(g0, p);
      const bs = findBonds(gs, () => 2.6);
      const same = bonds.map(
        (b) =>
          bs.find((q) => q.from === b.from && q.to === b.to && q.symmetry === b.symmetry) as Bond,
      );
      same.forEach((b, k) => (lengths[k] as number[]).push(b.length));
      const as = findAngles(gs, same);
      angles.forEach((a, k) => {
        const match = as.find((q) => q.first === a.first && q.second === a.second);
        (values[k] as number[]).push(match?.value as number);
      });
    }
    const sdOf = (v: number[]) => {
      const mean = v.reduce((x, y) => x + y, 0) / v.length;
      return Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / (v.length - 1));
    };
    // 4000 samples: the s.d. of a sample s.d. is about 1/√(2·4000) ≈ 1.1 %; allow 5 %.
    bonds.forEach((b, k) =>
      expect(Math.abs(sdOf(lengths[k] as number[]) / b.su - 1)).toBeLessThan(0.05),
    );
    angles.forEach((a, k) =>
      expect(Math.abs(sdOf(values[k] as number[]) / a.su - 1)).toBeLessThan(0.05),
    );
  });

  it('closed form in an orthorhombic cell: d = a(x₂ − x₁), σ² = (x₂ − x₁)² σ_a² + a²(σ²₁ + σ²₂)', () => {
    const m = 6 + 6;
    const cov = new Array<number>(m * m).fill(0);
    const set = (i: number, v: number) => (cov[i * m + i] = v * v);
    set(0, 0.002); // σ(a) Å
    set(6, 0.001); // σ(x₁)
    set(9, 0.0015); // σ(x₂)
    const g: StructureGeometry = {
      cell: { a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 90 },
      ops: ['x,y,z'],
      atoms: [
        { label: 'A', element: 'Ti', x: [0.1, 0.5, 0.5], occupancy: 1 },
        { label: 'B', element: 'O', x: [0.5, 0.5, 0.5], occupancy: 1 },
      ],
      covariance: cov,
    };
    const bond = findBonds(g, () => 2.1).find((b) => b.from === 0 && b.to === 1) as Bond;
    expect(bond.length).toBeCloseTo(2, 12);
    const expected = Math.sqrt(0.4 ** 2 * 0.002 ** 2 + 25 * (0.001 ** 2 + 0.0015 ** 2));
    expect(bond.su).toBeCloseTo(expected, 12);
  });

  it('closed form for an angle: 90° between a and b bonds, σ²(φ) from the two perpendicular shifts', () => {
    // Atom at the origin, neighbours at (d_a, 0, 0) and (0, d_b, 0) in a cubic cell; only the
    // central atom moves (σ_x along a, σ_y along b): φ changes by −δy/d_a − δx/d_b (radians).
    const m = 6 + 9;
    const cov = new Array<number>(m * m).fill(0);
    cov[6 * m + 6] = 0.001 ** 2;
    cov[7 * m + 7] = 0.002 ** 2;
    const a = 10;
    const g: StructureGeometry = {
      cell: { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 },
      ops: ['x,y,z'],
      atoms: [
        { label: 'M', element: 'Ti', x: [0.5, 0.5, 0.5], occupancy: 1 },
        { label: 'O1', element: 'O', x: [0.7, 0.5, 0.5], occupancy: 1 },
        { label: 'O2', element: 'O', x: [0.5, 0.75, 0.5], occupancy: 1 },
      ],
      covariance: cov,
    };
    const bonds = findBonds(g, (f) => (f.label === 'M' ? 2.6 : 0)).filter((b) => b.from === 0);
    const [angle] = findAngles(g, bonds);
    expect(angle?.value).toBeCloseTo(90, 10);
    const sx = 0.001 * a;
    const sy = 0.002 * a;
    const expected = (Math.sqrt((sy / 2) ** 2 + (sx / 2.5) ** 2) * 180) / Math.PI;
    expect(angle?.su).toBeCloseTo(expected, 10);
  });

  it('symmetry-equivalent bonds have equal lengths and s.u. (rutile Ti–O, COD 9007531)', () => {
    const g = fromCod('9007531');
    const m = 6 + 3 * g.atoms.length;
    // O on 4f (x, x, 0): x and y move together, z fixed. a = b in a tetragonal cell.
    const cov = new Array<number>(m * m).fill(0);
    const put = (i: number, j: number, v: number) => {
      cov[i * m + j] = v;
      cov[j * m + i] = v;
    };
    [0, 1].forEach((i) => [0, 1].forEach((j) => put(i, j, 4e-6)));
    put(2, 2, 9e-6);
    put(0, 2, 1e-6);
    put(1, 2, 1e-6);
    const o = 6 + 3 * g.atoms.findIndex((a) => a.element === 'O');
    [o, o + 1].forEach((i) => [o, o + 1].forEach((j) => put(i, j, 1e-6)));
    const bonds = findBonds({ ...g, covariance: cov }, covalentLimit(radii)).filter(
      (b) => g.atoms[b.from]?.element === 'Ti' && g.atoms[b.to]?.element === 'O',
    );
    expect(bonds.length).toBe(6);
    const short = bonds.slice(0, 4);
    const long = bonds.slice(4);
    for (const set of [short, long])
      for (const b of set) {
        expect(b.length).toBeCloseTo((set[0] as Bond).length, 10);
        expect(b.su).toBeCloseTo((set[0] as Bond).su, 12);
      }
    expect((short[0] as Bond).su).toBeGreaterThan(0);
  });

  it('moving an atom to a symmetry-equivalent position (with its covariance) changes nothing', () => {
    // α and γ stay 90° (monoclinic): otherwise the 2-fold axis would not be a symmetry of the cell.
    const sd = p0.map((_, k) => (k < 3 ? 5e-4 : k === 4 ? 0.02 : k < 6 ? 0 : 8e-4));
    const cov = randomCovariance(sd, 11);
    const g = { ...g0, covariance: cov };
    // O1 replaced by its image under operator 2 plus a translation: x' = R x + t + n, C' = R C Rᵀ.
    const op = parseSymop(g.ops[1] as string);
    const k = g.atoms.findIndex((a) => a.label === 'O1');
    const moved = applySymop(op, (g.atoms[k] as { x: Vec3 }).x, [1, 0, 0]);
    const m = p0.length;
    const t = Array.from({ length: m * m }, (_, q): number =>
      Math.floor(q / m) === q % m ? 1 : 0,
    );
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        t[(6 + 3 * k + i) * m + 6 + 3 * k + j] = op.rot[i * 3 + j] as number;
    const c2 = new Array<number>(m * m).fill(0);
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let v = 0;
        for (let p = 0; p < m; p++)
          for (let q = 0; q < m; q++)
            v += (t[i * m + p] as number) * (cov[p * m + q] as number) * (t[j * m + q] as number);
        c2[i * m + j] = v;
      }
    const g2: StructureGeometry = {
      ...g,
      atoms: g.atoms.map((a, i) => (i === k ? { ...a, x: moved } : a)),
      covariance: c2,
    };
    const key = (b: Bond) => `${b.from} ${b.to} ${b.length.toFixed(8)}`;
    const one = findBonds(g, limit);
    const two = findBonds(g2, limit);
    expect(two.map(key).sort()).toEqual(one.map(key).sort());
    const su = (list: Bond[]) =>
      list.map((b) => [key(b), b.su] as const).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    su(two).forEach(([, s], i) =>
      expect(s).toBeCloseTo((su(one)[i] as readonly [string, number])[1], 12),
    );
  });
});

describe('bond-valence sums', () => {
  it('reads the bundled table: first entry of each pair, unchecked rows left out', () => {
    expect(bondValenceParameter(table, 'Zr', 4, 'O', -2)).toEqual({
      r0: 1.928,
      b: 0.37,
      ref: 'a',
      unspecified: false,
    });
    expect(bondValenceParameter(table, 'Ti', 4, 'O', -2)?.r0).toBe(1.815);
    // Ti2+–F is only listed "unchecked" in bvparm2020.
    expect(bondValenceParameter(table, 'Ti', 2, 'F', -1)).toBeNull();
    // Ag–Br has only a valence-9 ("not specified") entry.
    expect(bondValenceParameter(table, 'Ag', 1, 'Br', -1)).toEqual({
      r0: 2.22,
      b: 0.37,
      ref: 'b',
      unspecified: true,
    });
    expect(table.notice).toContain('COPYRIGHT NOTICE');
    expect(table.refs.a).toContain('Brown and Altermatt');
  });

  it('a site with n equal bonds at R = R₀ + b ln(n/V) has the sum V (synthetic)', () => {
    // Octahedron of O around Ti at R = R₀ − b ln(4/6): six bonds of s = 4/6 each.
    const p = bondValenceParameter(table, 'Ti', 4, 'O', -2) as { r0: number; b: number };
    const r = p.r0 - p.b * Math.log(4 / 6);
    const a = 10;
    const f = r / a;
    const g: StructureGeometry = {
      cell: { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 },
      ops: ['x,y,z'],
      atoms: [
        { label: 'Ti', element: 'Ti', x: [0.5, 0.5, 0.5], occupancy: 1 },
        ...(
          [
            [f, 0, 0],
            [-f, 0, 0],
            [0, f, 0],
            [0, -f, 0],
            [0, 0, f],
            [0, 0, -f],
          ] as Vec3[]
        ).map((d, i) => ({
          label: `O${i + 1}`,
          element: 'O',
          x: d.map((v) => 0.5 + v) as Vec3,
          occupancy: 1,
        })),
      ],
      covariance: new Array<number>((6 + 21) ** 2).fill(0),
    };
    const bonds = findBonds(g, covalentLimit(radii));
    const [ti] = bondValenceSums(table, g.atoms, [4, -2, -2, -2, -2, -2, -2], bonds, g.covariance);
    expect(ti?.bonds).toBe(6);
    expect(ti?.sum).toBeCloseTo(4, 12);
    expect(ti?.refs).toEqual(['a']);
  });

  it('rutile: Σ over the cell of the cation sums equals that of the anion sums (2 Ti, 4 O)', () => {
    const g = fromCod('9007531');
    const bonds = findBonds(g, covalentLimit(radii));
    const states = g.atoms.map((a) => (a.element === 'Ti' ? 4 : -2));
    const sums = bondValenceSums(table, g.atoms, states, bonds, g.covariance);
    const ti = sums.find((s) => g.atoms[s.site]?.element === 'Ti')?.sum as number;
    const o = sums.find((s) => g.atoms[s.site]?.element === 'O')?.sum as number;
    expect(2 * ti).toBeCloseTo(4 * o, 10);
    expect(ti).toBeGreaterThan(3.5);
    expect(ti).toBeLessThan(4.5);
  });

  it('BVS s.u.: finite differences of the sum agree with the propagated gradient', () => {
    const g0 = fromCod('9007448');
    const p0 = params(g0);
    const sd = p0.map((_, k) => (k < 3 ? 5e-4 : k < 6 ? 0.02 : 8e-4));
    const cov = randomCovariance(sd, 5);
    const states = g0.atoms.map((a) => (a.element === 'Zr' ? 4 : -2));
    const sumAt = (p: number[]) => {
      const g = withParams(g0, p);
      return bondValenceSums(
        table,
        g.atoms,
        states,
        findBonds(g, covalentLimit(radii)),
        g.covariance,
      )[0]?.sum as number;
    };
    // σ² = gᵀ C g with g from finite differences of the whole sum.
    const h = 1e-6;
    const grad = p0.map((_, k) => {
      const plus = p0.slice();
      const minus = p0.slice();
      plus[k] = (plus[k] as number) + h;
      minus[k] = (minus[k] as number) - h;
      return (sumAt(plus) - sumAt(minus)) / (2 * h);
    });
    const m = p0.length;
    let v = 0;
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++)
        v += (grad[i] as number) * (cov[i * m + j] as number) * (grad[j] as number);
    const g = { ...g0, covariance: cov };
    const [zr] = bondValenceSums(table, g.atoms, states, findBonds(g, covalentLimit(radii)), cov);
    expect(zr?.su).toBeCloseTo(Math.sqrt(v), 6);
  });

  it('offers and suggests oxidation states from the table (ZrO2: Zr 4+, O 2−; ZnS: S 2−)', () => {
    const g = fromCod('9007448');
    const bonds = findBonds(g, covalentLimit(radii));
    expect(suggestStates(table, g.atoms, bonds, g.covariance)).toEqual([4, -2, -2]);
    const offered = offeredStates(table, ['Zn', 'S']);
    expect(offered[1]).toMatchObject({ element: 'S', anion: true, states: [-2] });
    const sulfate = offeredStates(table, ['S', 'O']);
    expect(sulfate[0]?.anion).toBe(false);
    expect(sulfate[1]?.anion).toBe(true);
  });
});
