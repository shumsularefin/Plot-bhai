/*
 * Space-group symmetry operators as written in CIF files ("-x+1/2, y, z+1/4").
 * An operator maps a fractional position x to R·x + t (R: 3×3 integers, t: fractions of the cell).
 */

export interface Symop {
  /** Row-major 3×3 rotation part. */
  rot: readonly number[];
  /** Translation part, fractions of the cell edges. */
  trans: readonly [number, number, number];
}

const AXIS = { x: 0, y: 1, z: 2 } as const;

/** Parses one operator such as "x-y, x, z+1/6". Throws on text it does not understand. */
export function parseSymop(text: string): Symop {
  const parts = text
    .toLowerCase()
    .replace(/['"\s]/g, '')
    .split(',');
  if (parts.length !== 3) throw new Error(`Cannot read symmetry operator "${text}"`);
  const rot = new Array<number>(9).fill(0);
  const trans: [number, number, number] = [0, 0, 0];
  parts.forEach((part, row) => {
    const term = /([+-]?)(\d+\.?\d*(?:\/\d+)?)?\*?([xyz])?/y;
    let consumed = 0;
    while (consumed < part.length) {
      term.lastIndex = consumed;
      const match = term.exec(part);
      if (!match || match[0] === '') throw new Error(`Cannot read symmetry operator "${text}"`);
      consumed = term.lastIndex;
      const sign = match[1] === '-' ? -1 : 1;
      const [num, den] = (match[2] ?? '').split('/');
      const coefficient =
        match[2] === undefined ? 1 : Number(num) / (den === undefined ? 1 : Number(den));
      const axis = match[3] as keyof typeof AXIS | undefined;
      if (axis === undefined) trans[row as 0 | 1 | 2] += sign * coefficient;
      else rot[row * 3 + AXIS[axis]] = (rot[row * 3 + AXIS[axis]] as number) + sign * coefficient;
    }
  });
  return { rot, trans };
}

/** h·R: the Miller indices of a reflection after applying the rotation part of an operator. */
export function rotateHkl(
  op: Symop,
  h: readonly [number, number, number],
): [number, number, number] {
  const r = op.rot;
  return [
    h[0] * (r[0] as number) + h[1] * (r[3] as number) + h[2] * (r[6] as number),
    h[0] * (r[1] as number) + h[1] * (r[4] as number) + h[2] * (r[7] as number),
    h[0] * (r[2] as number) + h[1] * (r[5] as number) + h[2] * (r[8] as number),
  ];
}

/**
 * True when the space group forbids the reflection h: some operator leaves h unchanged
 * (h·R = h) but shifts its phase by a non-integer amount (h·t not a whole number).
 */
export function isSystematicAbsence(
  ops: readonly Symop[],
  h: readonly [number, number, number],
): boolean {
  for (const op of ops) {
    const [a, b, c] = rotateHkl(op, h);
    if (a !== h[0] || b !== h[1] || c !== h[2]) continue;
    const phase = h[0] * op.trans[0] + h[1] * op.trans[1] + h[2] * op.trans[2];
    if (Math.abs(phase - Math.round(phase)) > 1e-4) return true;
  }
  return false;
}

/** One representative per symmetry orbit of reflections, for example (101) for {101}. */
export function orbitRepresentative(
  ops: readonly Symop[],
  h: readonly [number, number, number],
): [number, number, number] {
  let best: [number, number, number] = [h[0], h[1], h[2]];
  const consider = (g: [number, number, number]) => {
    for (const sign of [1, -1]) {
      const c: [number, number, number] = [sign * g[0] + 0, sign * g[1] + 0, sign * g[2] + 0];
      if (
        c[0] > best[0] ||
        (c[0] === best[0] && (c[1] > best[1] || (c[1] === best[1] && c[2] > best[2])))
      ) {
        best = c;
      }
    }
  };
  for (const op of ops) consider(rotateHkl(op, h));
  return best;
}
