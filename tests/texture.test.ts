import { describe, expect, it } from 'vitest';
import {
  crystalAngles,
  plmpsi,
  qlmn,
  textureBasis,
  textureCorrection,
  textureIndex,
  textureSymmetry,
  textureTerms,
} from '../src/core/xrd/rietveld/texture';
import type { Cell } from '../src/core/xrd/reference/powder';

/**
 * Normalised associated Legendre function by the standard three-term recurrence (an independent
 * implementation: no Fourier series), P̄_l^m(cos ψ) = √((2l+1)/2 · (l−m)!/(l+m)!) P_l^m(cos ψ),
 * without the Condon–Shortley phase, m ≥ 0.
 */
function legendre(l: number, m: number, psiDeg: number): number {
  const x = Math.cos((psiDeg * Math.PI) / 180);
  const s = Math.sqrt(1 - x * x);
  let pmm = 1;
  for (let i = 1; i <= m; i++) pmm *= (2 * i - 1) * s;
  let p = pmm;
  if (l > m) {
    let prev = pmm;
    let cur = x * (2 * m + 1) * pmm;
    for (let ll = m + 2; ll <= l; ll++) {
      const next = ((2 * ll - 1) * x * cur - (ll + m - 1) * prev) / (ll - m);
      prev = cur;
      cur = next;
    }
    p = cur;
  }
  let ratio = 1;
  for (let i = l - m + 1; i <= l + m; i++) ratio /= i;
  return Math.sqrt(((2 * l + 1) / 2) * ratio) * p;
}

describe('spherical-harmonic texture functions', () => {
  it('P̄_l^m from the Fourier series matches the Legendre recurrence (|value|, all l ≤ 16)', () => {
    for (let l = 0; l <= 16; l += 2)
      for (let m = 0; m <= l; m++)
        for (const psi of [0, 13, 37.5, 61, 90, 118, 166])
          expect(Math.abs(plmpsi(l, m, psi))).toBeCloseTo(Math.abs(legendre(l, m, psi)), 4);
  });

  it('P̄_l^0 has the standard sign and P̄_l^m is normalised over 0…π', () => {
    for (let l = 2; l <= 16; l += 2) {
      expect(plmpsi(l, 0, 0)).toBeCloseTo(Math.sqrt((2 * l + 1) / 2), 4);
      for (const m of [0, 1, l]) {
        let sum = 0;
        const n = 4000;
        for (let i = 0; i < n; i++) {
          const psi = ((i + 0.5) * 180) / n;
          sum += plmpsi(l, m, psi) ** 2 * Math.sin((psi * Math.PI) / 180) * (Math.PI / n);
        }
        expect(sum).toBeCloseTo(1, 4);
      }
    }
  });

  it('Q_l^{0 0} is P_l(0) (Legendre polynomial at zero)', () => {
    // P_2(0) = −1/2, P_4(0) = 3/8, P_6(0) = −5/16.
    expect(qlmn(2, 0, 0)).toBeCloseTo(-0.5, 10);
    expect(qlmn(4, 0, 0)).toBeCloseTo(0.375, 10);
    expect(qlmn(6, 0, 0)).toBeCloseTo(-0.3125, 10);
  });

  it('lists the coefficients GSAS-II lists for common Laue classes', () => {
    const names = (laue: Parameters<typeof textureTerms>[0], order: number) =>
      textureTerms(laue, order).map(([l, n]) => `C(${l},${n})`);
    expect(names('m3m', 8)).toEqual(['C(4,1)', 'C(6,1)', 'C(8,1)']);
    expect(names('m3m', 12)).toEqual([
      'C(4,1)',
      'C(6,1)',
      'C(8,1)',
      'C(10,1)',
      'C(12,1)',
      'C(12,2)',
    ]);
    expect(names('6/mmm', 8)).toEqual(['C(2,0)', 'C(4,0)', 'C(6,0)', 'C(6,6)', 'C(8,0)', 'C(8,6)']);
    expect(names('4/mmm', 4)).toEqual(['C(2,0)', 'C(4,0)', 'C(4,4)']);
    expect(names('mmm', 2)).toEqual(['C(2,0)', 'C(2,2)']);
    expect(names('-1', 2)).toHaveLength(5);
  });
});

const CELLS: { kind: Parameters<typeof textureSymmetry>[0]; sg: number; cell: Cell }[] = [
  {
    kind: 'cubic',
    sg: 225,
    cell: { a: 5.411, b: 5.411, c: 5.411, alpha: 90, beta: 90, gamma: 90 },
  },
  { kind: 'cubic', sg: 206, cell: { a: 10.6, b: 10.6, c: 10.6, alpha: 90, beta: 90, gamma: 90 } },
  {
    kind: 'hexagonal',
    sg: 186,
    cell: { a: 3.25, b: 3.25, c: 5.207, alpha: 90, beta: 90, gamma: 120 },
  },
  {
    kind: 'hexagonal',
    sg: 167,
    cell: { a: 4.76, b: 4.76, c: 12.99, alpha: 90, beta: 90, gamma: 120 },
  },
  { kind: 'hexagonal', sg: 162, cell: { a: 5.1, b: 5.1, c: 4.7, alpha: 90, beta: 90, gamma: 120 } },
  {
    kind: 'tetragonal',
    sg: 136,
    cell: { a: 4.594, b: 4.594, c: 2.959, alpha: 90, beta: 90, gamma: 90 },
  },
  { kind: 'tetragonal', sg: 88, cell: { a: 5.2, b: 5.2, c: 11.4, alpha: 90, beta: 90, gamma: 90 } },
  {
    kind: 'orthorhombic',
    sg: 62,
    cell: { a: 3.96, b: 13.86, c: 3.7, alpha: 90, beta: 90, gamma: 90 },
  },
  {
    kind: 'monoclinic-beta',
    sg: 14,
    cell: { a: 7.3, b: 7.54, c: 7.69, alpha: 90, beta: 90.9, gamma: 90 },
  },
  {
    kind: 'rhombohedral',
    sg: 166,
    cell: { a: 5.1, b: 5.1, c: 5.1, alpha: 55.3, beta: 55.3, gamma: 55.3 },
  },
];

/** Symmetry-equivalent h k l of each Laue class (Laue operations applied by hand). */
function equivalents(
  laue: string,
  [h, k, l]: [number, number, number],
): [number, number, number][] {
  const i = -h - k;
  switch (laue) {
    case 'm3m':
      return [
        [h, k, l],
        [k, h, l],
        [l, h, k],
        [-h, k, -l],
        [k, -l, h],
        [-l, -k, -h],
      ];
    case 'm3':
      return [
        [h, k, l],
        [l, h, k],
        [k, l, h],
        [-h, -k, l],
        [h, -k, -l],
        [-l, h, -k],
      ];
    case '6/mmm':
      return [
        [h, k, l],
        [k, i, l],
        [i, h, l],
        [k, h, l],
        [-h, -k, -l],
        [h, i, -l],
      ];
    case '3m1':
      return [
        [h, k, l],
        [k, i, l],
        [i, h, l],
        [-k, -h, l],
        [-h, -k, -l],
      ];
    case '31m':
      return [
        [h, k, l],
        [k, i, l],
        [i, h, l],
        [k, h, l],
        [-h, -k, -l],
      ];
    case '4/mmm':
      return [
        [h, k, l],
        [-k, h, l],
        [k, h, l],
        [h, -k, -l],
        [-h, -k, -l],
      ];
    case '4/m':
      return [
        [h, k, l],
        [-k, h, l],
        [-h, -k, l],
        [h, k, -l],
      ];
    case 'mmm':
      return [
        [h, k, l],
        [-h, k, l],
        [h, -k, -l],
        [-h, -k, -l],
      ];
    case '2/m':
      return [
        [h, k, l],
        [-h, k, -l],
        [-h, -k, -l],
      ];
    case '3mR':
      return [
        [h, k, l],
        [k, l, h],
        [l, h, k],
        [k, h, l],
        [-h, -k, -l],
      ];
    default:
      return [
        [h, k, l],
        [-h, -k, -l],
      ];
  }
}

describe('spherical-harmonic texture correction', () => {
  it('gives the same correction for symmetry-equivalent reflections (all Laue classes here)', () => {
    for (const { kind, sg, cell } of CELLS) {
      const symmetry = textureSymmetry(kind, sg);
      const terms = textureTerms(symmetry.laue, 10);
      const coefficients = terms.map((_, i) => 0.3 * Math.sin(1.7 * i + 0.4));
      for (const hkl of [
        [1, 2, 3],
        [2, 0, 1],
        [3, 1, 4],
        [1, 1, 0],
      ] as [number, number, number][]) {
        const ref = textureCorrection(coefficients, textureBasis(terms, hkl, cell, symmetry, 90));
        for (const eq of equivalents(symmetry.laue, hkl))
          expect(
            textureCorrection(coefficients, textureBasis(terms, eq, cell, symmetry, 90)),
            `${symmetry.laue} ${hkl.join(' ')} vs ${eq.join(' ')}`,
          ).toBeCloseTo(ref, 8);
      }
    }
  });

  it('averages to 1 over all directions (texture keeps the total intensity), 6/mmm and m3m', () => {
    for (const { kind, sg, cell } of [CELLS[0], CELLS[2]] as (typeof CELLS)[number][]) {
      const symmetry = textureSymmetry(kind, sg);
      const terms = textureTerms(symmetry.laue, 8);
      const coefficients = terms.map((_, i) => 0.2 * Math.cos(i + 1));
      // A Cartesian sampling of reciprocal directions for a fixed sample direction ψ = 37°:
      // average of A over the sphere of crystal directions (uniform in cos φ and β).
      let sum = 0;
      let count = 0;
      const n = 120;
      for (let a = 0; a < n; a++)
        for (let b = 0; b < 2 * n; b++) {
          const cp = -1 + (2 * (a + 0.5)) / n;
          const beta = (Math.PI * (b + 0.5)) / n;
          const sp = Math.sqrt(1 - cp * cp);
          // Direction in a Cartesian frame with c* along z: convert to h k l of that cell.
          const v = [sp * Math.cos(beta), sp * Math.sin(beta), cp];
          const hkl = cartesianToHkl(v as [number, number, number], cell);
          sum += textureCorrection(coefficients, textureBasis(terms, hkl, cell, symmetry, 37));
          count++;
        }
      expect(sum / count).toBeCloseTo(1, 2);
    }
  });

  it('places the polar angle against c* and β = 0 along a* for hexagonal and tetragonal cells', () => {
    const zno = CELLS[2] as (typeof CELLS)[number];
    expect(crystalAngles([0, 0, 1], zno.cell, textureSymmetry('hexagonal', 186))[0]).toBeCloseTo(
      0,
      8,
    );
    expect(crystalAngles([1, 0, 0], zno.cell, textureSymmetry('hexagonal', 186))).toEqual([
      expect.closeTo(90, 8),
      expect.closeTo(30, 8),
    ]);
    const rutile = CELLS[5] as (typeof CELLS)[number];
    expect(
      crystalAngles([1, 0, 0], rutile.cell, textureSymmetry('tetragonal', 136))[1],
    ).toBeCloseTo(0, 8);
  });

  it('texture index: 1 for no texture, 1 + Σ C²/(2l+1) otherwise', () => {
    const terms: [number, number][] = [
      [2, 0],
      [4, 0],
    ];
    expect(textureIndex(terms, [0, 0], [0, 0]).value).toBe(1);
    const j = textureIndex(terms, [0.5, -0.3], [0.1, 0.05]);
    expect(j.value).toBeCloseTo(1 + 0.25 / 5 + 0.09 / 9, 12);
    expect(j.esd).toBeCloseTo(Math.hypot((2 * 0.5 * 0.1) / 5, (2 * 0.3 * 0.05) / 9), 12);
  });
});

/** h k l (real, unnormalised) of a Cartesian reciprocal direction, c* along z, a* in xz. */
function cartesianToHkl(v: [number, number, number], cell: Cell): [number, number, number] {
  // Only used for cells with α = β = 90°: a* ⟂ c*, and b* at 180° − γ from a* in the plane.
  const g = (cell.gamma * Math.PI) / 180;
  const astar = [1, 0, 0];
  const bstar = [Math.cos(Math.PI - g), Math.sin(Math.PI - g), 0];
  // v = h a*/|a*|·… : solve in the plane for the in-plane part, lengths drop out of the direction
  // only up to the ratio of |a*|, |b*|, |c*|.
  const as = 1 / (cell.a * Math.sin(g));
  const bs = 1 / (cell.b * Math.sin(g));
  const cs = 1 / cell.c;
  const det =
    (astar[0] as number) * (bstar[1] as number) - (astar[1] as number) * (bstar[0] as number);
  const x = (v[0] * (bstar[1] as number) - v[1] * (bstar[0] as number)) / det;
  const y = ((astar[0] as number) * v[1] - (astar[1] as number) * v[0]) / det;
  return [x / as, y / bs, v[2] / cs];
}
