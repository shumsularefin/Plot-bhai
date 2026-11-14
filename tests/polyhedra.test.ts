import { describe, expect, it } from 'vitest';
import { hullFaces, outsideNeighbours } from '../src/core/xrd/structure/polyhedra';
import type { Vec3 } from '../src/core/xrd/structure/geometry';

const sorted = (faces: number[][]) => faces.map((f) => f.length).sort((a, b) => a - b);

describe('hullFaces', () => {
  it('gives the 4 triangles of a tetrahedron', () => {
    const t: Vec3[] = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    expect(sorted(hullFaces(t))).toEqual([3, 3, 3, 3]);
  });

  it('gives the 8 triangles of an octahedron, not the inner square planes', () => {
    const o: Vec3[] = [
      [2, 0, 0],
      [-2, 0, 0],
      [0, 2, 0],
      [0, -2, 0],
      [0, 0, 2],
      [0, 0, -2],
    ];
    expect(sorted(hullFaces(o))).toEqual(Array(8).fill(3));
  });

  it('merges coplanar points: a cube has 6 square faces', () => {
    const cube: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
    const faces = hullFaces(cube);
    expect(sorted(faces)).toEqual([4, 4, 4, 4, 4, 4]);
    // Each square is ordered around its edge: neighbours in the list are 1 Å apart.
    for (const f of faces)
      f.forEach((m, k) => {
        const a = cube[m] as Vec3;
        const b = cube[f[(k + 1) % f.length] as number] as Vec3;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(1, 9);
      });
  });

  it('gives no solid for flat or too few points', () => {
    const square: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0],
    ];
    expect(hullFaces(square)).toEqual([]);
    expect(hullFaces(square.slice(0, 3))).toEqual([]);
  });

  it('does not depend on the order of the points (invariance)', () => {
    const o: Vec3[] = [
      [0, 0, -2],
      [0, 2, 0],
      [2, 0, 0],
      [0, 0, 2],
      [-2, 0, 0],
      [0, -2, 0],
    ];
    expect(sorted(hullFaces(o))).toEqual(Array(8).fill(3));
  });
});

describe('outsideNeighbours', () => {
  // Cubic cell a = 4 Å, M at the origin and X half way along each axis: M–X = 2 Å, a bond for
  // radii 1 + 1 (+ 0.45). The drawing holds only the three X on the positive axes.
  const cell = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
  const atom = (label: string, element: string, x: Vec3) => ({
    site: 0,
    label,
    element,
    occupancy: 1,
    x,
  });
  const atoms = [
    atom('M1', 'M', [0, 0, 0]),
    atom('X1', 'X', [0.5, 0, 0]),
    atom('X1', 'X', [0, 0.5, 0]),
    atom('X1', 'X', [0, 0, 0.5]),
  ];
  const radii = { M: 1, X: 1 };

  it('adds the three X from the neighbouring cells, completing the octahedron', () => {
    const extra = outsideNeighbours(cell, atoms, 'M', radii);
    expect(extra.map((a) => a.x).sort()).toEqual(
      [
        [-0.5, 0, 0],
        [0, -0.5, 0],
        [0, 0, -0.5],
      ].sort(),
    );
    const ring = [...atoms.slice(1), ...extra].map((a) => a.x.map((v) => v * 4) as Vec3);
    expect(sorted(hullFaces(ring))).toEqual(Array(8).fill(3));
  });

  it('adds nothing for a centre element that is absent, and nothing twice', () => {
    expect(outsideNeighbours(cell, atoms, 'Q', radii)).toEqual([]);
    const extra = outsideNeighbours(cell, atoms, 'M', radii);
    expect(outsideNeighbours(cell, [...atoms, ...extra], 'M', radii)).toEqual([]);
  });
});
