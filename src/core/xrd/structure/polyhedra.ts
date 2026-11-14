import type { Cell } from '../reference/powder.ts';
import { BOND_TOLERANCE, distance, type CellAtom, type Vec3 } from './geometry';

/**
 * Faces of the convex hull of a small set of points (the neighbours of one atom), for drawing a
 * coordination polyhedron. Every plane through three points with all other points on one side is
 * a face; points lying in the same face plane are merged into one polygon, ordered around the
 * face centre. Positions are Cartesian (Å); `tolerance` (Å) decides when a point lies in a plane.
 * Returns each face as indices into `points`. Fewer than four points, or points that all lie in
 * one plane, have no hull and give an empty list. Brute force, O(n⁴), meant for n ≤ 16.
 */
export function hullFaces(points: readonly Vec3[], tolerance = 0.05): number[][] {
  const n = points.length;
  if (n < 4) return [];
  const p = (i: number) => points[i] as Vec3;
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const centre = points
    .reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0])
    .map((v) => v / n) as Vec3;

  const faces: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const c = cross(sub(p(j), p(i)), sub(p(k), p(i)));
        const len = Math.hypot(...c);
        if (len < 1e-9) continue;
        let normal: Vec3 = [c[0] / len, c[1] / len, c[2] / len];
        // Outward: away from the centre of all points.
        if (dot(normal, sub(p(i), centre)) < 0) normal = [-normal[0], -normal[1], -normal[2]];
        const side = points.map((v) => dot(normal, sub(v, p(i))));
        if (side.some((s) => s > tolerance)) continue;
        const onPlane = side.flatMap((s, m) => (Math.abs(s) <= tolerance ? [m] : []));
        const key = onPlane.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push(orderAround(onPlane, points, normal));
      }
  // All points in one plane: both sides pass the test, which is no solid.
  return faces.length >= 4 ? faces : [];
}

/** Orders the points of one face anticlockwise seen from outside (along `normal`). */
function orderAround(face: number[], points: readonly Vec3[], normal: Vec3): number[] {
  const c = face
    .reduce<Vec3>(
      (s, m) => {
        const v = points[m] as Vec3;
        return [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
      },
      [0, 0, 0],
    )
    .map((v) => v / face.length) as Vec3;
  const first = points[face[0] as number] as Vec3;
  const u0: Vec3 = [first[0] - c[0], first[1] - c[1], first[2] - c[2]];
  const ul = Math.hypot(...u0) || 1;
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const w: Vec3 = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  const angleOf = (m: number) => {
    const v = points[m] as Vec3;
    const d: Vec3 = [v[0] - c[0], v[1] - c[1], v[2] - c[2]];
    return Math.atan2(
      d[0] * w[0] + d[1] * w[1] + d[2] * w[2],
      d[0] * u[0] + d[1] * u[1] + d[2] * u[2],
    );
  };
  return [...face].sort((a, b) => angleOf(a) - angleOf(b));
}

/**
 * Neighbours that a coordination polyhedron needs but the cell drawing lacks: for every drawn
 * atom of `centre`, each atom of another element in a neighbouring cell (lattice translations
 * −1, 0, +1 along each axis) bonded to it by the same rule as `bonds` (0.5 Å < d ≤ r₁ + r₂ +
 * tolerance, covalent radii in Å). Returns those copies (fractional positions outside the drawn
 * set, so a coordinate may lie outside [0, 1]), each once.
 */
export function outsideNeighbours(
  cell: Cell,
  atoms: readonly CellAtom[],
  centre: string,
  radii: Readonly<Record<string, number>>,
  tolerance = BOND_TOLERANCE,
): CellAtom[] {
  const key = (x: Vec3) => x.map((v) => Math.round(v * 1e4)).join(',');
  const have = new Set(atoms.map((a) => key(a.x)));
  const out: CellAtom[] = [];
  const shifts: Vec3[] = [];
  for (const i of [-1, 0, 1])
    for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) shifts.push([i, j, k]);
  for (const c of atoms) {
    const rc = radii[c.element];
    if (c.element !== centre || rc === undefined) continue;
    for (const a of atoms) {
      const ra = radii[a.element];
      if (a.element === centre || ra === undefined) continue;
      for (const n of shifts) {
        const x: Vec3 = [a.x[0] + n[0], a.x[1] + n[1], a.x[2] + n[2]];
        if (have.has(key(x))) continue;
        const d = distance(cell, c.x, x);
        if (d > 0.5 && d <= rc + ra + tolerance) {
          have.add(key(x));
          out.push({ ...a, x });
        }
      }
    }
  }
  return out;
}
