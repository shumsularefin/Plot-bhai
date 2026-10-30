import { lineAngle, type Point, type Rect } from '../geometry';

/**
 * A particle is stored as runs of pixels, three numbers per run: row y, first column x0 and
 * one past the last column x1, sorted by y then x0. This is compact (about as many runs as the
 * particle has rows) and exact, so area and shape can be recomputed after merging or splitting.
 */
export type Runs = Int32Array;

export interface Bounds {
  x0: number;
  y0: number;
  /** One past the last column and row. */
  x1: number;
  y1: number;
}

/** Runs of every label of a label image; entry k holds label k + 1. */
export function labelsToRuns(
  labels: Int32Array,
  width: number,
  height: number,
  count: number,
): Runs[] {
  const lists: number[][] = Array.from({ length: count }, () => []);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const label = labels[y * width + x] as number;
      if (!label) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < width && labels[y * width + end] === label) end++;
      (lists[label - 1] as number[]).push(y, x, end);
      x = end;
    }
  }
  return lists.map((list) => Int32Array.from(list));
}

export function runsArea(runs: Runs): number {
  let area = 0;
  for (let i = 0; i < runs.length; i += 3)
    area += (runs[i + 2] as number) - (runs[i + 1] as number);
  return area;
}

export function runsBounds(runs: Runs): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < runs.length; i += 3) {
    const y = runs[i] as number;
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y + 1);
    x0 = Math.min(x0, runs[i + 1] as number);
    x1 = Math.max(x1, runs[i + 2] as number);
  }
  return { x0, y0, x1, y1 };
}

/** True when the pixel (x, y) belongs to the runs. */
export function runsContain(runs: Runs, x: number, y: number): boolean {
  for (let i = 0; i < runs.length; i += 3) {
    if (runs[i] === y && x >= (runs[i + 1] as number) && x < (runs[i + 2] as number)) return true;
  }
  return false;
}

/** Sorts runs and joins those that overlap or touch in the same row. */
export function normaliseRuns(runs: ArrayLike<number>): Runs {
  const triples: [number, number, number][] = [];
  for (let i = 0; i < runs.length; i += 3) {
    triples.push([runs[i] as number, runs[i + 1] as number, runs[i + 2] as number]);
  }
  triples.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: number[] = [];
  let current: [number, number, number] | null = null;
  for (const t of triples) {
    if (current && current[0] === t[0] && t[1] <= current[2]) {
      current[2] = Math.max(current[2], t[2]);
    } else {
      if (current) out.push(...current);
      current = [t[0], t[1], t[2]];
    }
  }
  if (current) out.push(...current);
  return Int32Array.from(out);
}

/** The pixels of both particles together. */
export function mergeRuns(a: Runs, b: Runs): Runs {
  return normaliseRuns([...a, ...b]);
}

/** True when the runs reach the edge of `area` (a particle cut by the image or crop edge). */
export function touchesEdge(runs: Runs, area: Rect): boolean {
  const left = Math.round(area.x);
  const top = Math.round(area.y);
  const right = Math.round(area.x + area.width);
  const bottom = Math.round(area.y + area.height);
  for (let i = 0; i < runs.length; i += 3) {
    const y = runs[i] as number;
    if (y <= top || y >= bottom - 1) return true;
    if ((runs[i + 1] as number) <= left || (runs[i + 2] as number) >= right) return true;
  }
  return false;
}

/** A closed outline as vertices (x, y) in pixel-edge coordinates. */
export type Loop = Point[];

/**
 * Outlines along pixel edges. Each exposed pixel edge is followed with the particle on the right
 * hand (y points down); at a vertex where two pixels meet only at a corner the path turns left,
 * so such pixels count as connected (8-connectivity, as in the labelling). Returns closed loops
 * with a vertex only where the direction changes: the outer boundary and any holes.
 */
export function outlineLoops(runs: Runs): Loop[] {
  if (runs.length === 0) return [];
  const b = runsBounds(runs);
  const w = b.x1 - b.x0 + 2;
  const h = b.y1 - b.y0 + 2;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < runs.length; i += 3) {
    const y = (runs[i] as number) - b.y0 + 1;
    for (let x = (runs[i + 1] as number) - b.x0 + 1; x < (runs[i + 2] as number) - b.x0 + 1; x++) {
      mask[y * w + x] = 1;
    }
  }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // Directions: 0 right, 1 down, 2 left, 3 up.
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const stride = w + 1;
  const outgoing = new Map<number, number[]>();
  const add = (vx: number, vy: number, dir: number) => {
    const key = vy * stride + vx;
    const list = outgoing.get(key);
    if (list) list.push(dir);
    else outgoing.set(key, [dir]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  }
  const loops: Loop[] = [];
  for (const [startKey, dirs] of outgoing) {
    while (dirs.length > 0) {
      // Follow unused edges until none leaves the current vertex: that closes the loop.
      const vertices: Point[] = [];
      let key = startKey;
      let dir = dirs.pop() as number;
      for (;;) {
        const vx = key % stride;
        const vy = (key - vx) / stride;
        vertices.push({ x: vx + b.x0 - 1, y: vy + b.y0 - 1 });
        key = (vy + (DY[dir] as number)) * stride + vx + (DX[dir] as number);
        const options = outgoing.get(key) ?? [];
        // Prefer a left turn, then straight on, then a right turn.
        const next = [(dir + 3) % 4, dir, (dir + 1) % 4].find((d) => options.includes(d));
        if (next === undefined) break;
        options.splice(options.indexOf(next), 1);
        dir = next;
      }
      loops.push(corners(vertices));
    }
  }
  return loops;
}

/** Keeps only the vertices where the direction changes. */
function corners(vertices: Point[]): Loop {
  const n = vertices.length;
  return vertices.filter((v, i) => {
    const before = vertices[(i + n - 1) % n] as Point;
    const after = vertices[(i + 1) % n] as Point;
    return (
      Math.sign(v.x - before.x) !== Math.sign(after.x - v.x) ||
      Math.sign(v.y - before.y) !== Math.sign(after.y - v.y)
    );
  });
}

/** Signed area of a closed polygon (shoelace formula); the sign depends on the direction of travel. */
export function polygonArea(loop: Loop): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i] as Point;
    const q = loop[(i + 1) % loop.length] as Point;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** The loop enclosing the largest area: the outer boundary of a particle. */
export function outerLoop(loops: readonly Loop[]): Loop | null {
  let best: Loop | null = null;
  let bestArea = -1;
  for (const loop of loops) {
    const area = Math.abs(polygonArea(loop));
    if (area > bestArea) {
      best = loop;
      bestArea = area;
    }
  }
  return best;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, without repeated end point. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Shape measurements of a particle, in pixels of the grid the runs live on. */
export interface Shape {
  /** Number of pixels. */
  area: number;
  cx: number;
  cy: number;
  /** Diameter of the circle with the same area: 2 √(area / π). */
  eqDiameter: number;
  /** Longest and shortest caliper width (Feret diameters) of the pixel outline. */
  feretMax: number;
  feretMin: number;
  /** feretMax / feretMin. */
  aspect: number;
  /** Direction of the longest caliper, degrees from 0 up to 180, counter-clockwise from +x with y up. */
  feretAngle: number;
  /** Area of the convex hull of the outline, px²; solidity is area / convexArea. */
  convexArea: number;
  perimeter: number;
  /**
   * 4π · area / perimeter², at most 1. A circle drawn in pixels reads about 0.9, not 1, because
   * the perimeter follows pixel edges (corner cutting leaves it about 5 % long); a square reads
   * about 0.83 (the exact value is 0.785). Compare particles with each other, or filter with
   * this in mind.
   */
  circularity: number;
}

/**
 * Measures a particle. Feret diameters come from the convex hull of the outline's corners (the
 * pixel corners, so one pixel has Feret diameter 1): the maximum is the longest distance between
 * two hull points and the minimum is the smallest width between parallel supporting lines, found
 * by trying the direction of every hull edge. The perimeter joins the midpoints of the unit
 * edges of the outline, which cuts corners: a straight run keeps its length and a 45° staircase
 * gets its true length √2 per step; in terms of the outline it equals
 * (edge length) − (number of corners) · (1 − √2/2). Circularity uses the pixel count as area.
 */
export function shapeOf(runs: Runs): Shape {
  const area = runsArea(runs);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < runs.length; i += 3) {
    const y = runs[i] as number;
    const x0 = runs[i + 1] as number;
    const x1 = runs[i + 2] as number;
    sx += ((x0 + x1) / 2) * (x1 - x0);
    sy += (y + 0.5) * (x1 - x0);
  }
  const loops = outlineLoops(runs);
  const outer = outerLoop(loops) ?? [];
  let edge = 0;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i] as Point;
    const q = outer[(i + 1) % outer.length] as Point;
    edge += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
  }
  const perimeter = edge - outer.length * (1 - Math.SQRT1_2);
  const hull = convexHull(outer);
  let feretMax = 0;
  let feretAngle = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const a = hull[i] as Point;
      const b = hull[j] as Point;
      const length = Math.hypot(a.x - b.x, a.y - b.y);
      if (length > feretMax) {
        feretMax = length;
        feretAngle = lineAngle(a, b) % 180;
      }
    }
  }
  let feretMin = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i] as Point;
    const q = hull[(i + 1) % hull.length] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length === 0) continue;
    let width = 0;
    for (const r of hull) {
      width = Math.max(
        width,
        Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / length,
      );
    }
    feretMin = Math.min(feretMin, width);
  }
  if (!Number.isFinite(feretMin)) feretMin = feretMax;
  return {
    area,
    cx: area > 0 ? sx / area : 0,
    cy: area > 0 ? sy / area : 0,
    eqDiameter: 2 * Math.sqrt(area / Math.PI),
    feretMax,
    feretMin,
    aspect: feretMin > 0 ? feretMax / feretMin : 1,
    feretAngle,
    convexArea: Math.abs(polygonArea(hull)),
    perimeter,
    circularity: perimeter > 0 ? Math.min(1, (4 * Math.PI * area) / perimeter ** 2) : 0,
  };
}
