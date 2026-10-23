/**
 * Solves the square system A·x = b by Gaussian elimination with partial pivoting.
 * A is given as rows and is not modified. Returns null if A is singular.
 */
export function solve(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (
        Math.abs((m[r] as number[])[col] as number) >
        Math.abs((m[pivot] as number[])[col] as number)
      )
        pivot = r;
    }
    const pivotRow = m[pivot] as number[];
    if (Math.abs(pivotRow[col] as number) < 1e-14) return null;
    [m[col], m[pivot]] = [pivotRow, m[col] as number[]];
    const top = m[col] as number[];
    for (let r = col + 1; r < n; r++) {
      const row = m[r] as number[];
      const factor = (row[col] as number) / (top[col] as number);
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - factor * (top[c] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let sum = row[n] as number;
    for (let c = r + 1; c < n; c++) sum -= (row[c] as number) * (x[c] as number);
    x[r] = sum / (row[r] as number);
  }
  return x;
}

/** Inverse of a small square matrix, or null if singular. */
export function invert(a: readonly (readonly number[])[]): number[][] | null {
  const n = a.length;
  const columns: number[][] = [];
  for (let j = 0; j < n; j++) {
    const column = solve(
      a,
      Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)),
    );
    if (!column) return null;
    columns.push(column);
  }
  return Array.from({ length: n }, (_, i) => columns.map((column) => column[i] as number));
}
