import { describe, expect, it } from 'vitest';
import { indexPattern, INDEX_SYSTEMS } from '../src/core/xrd/reference/indexing';
import { reciprocalTerms, type LatticeSystem } from '../src/core/xrd/reference/lattice';

const LAMBDA = 1.5406;

/** Synthetic peak positions (degrees 2θ) of a cell, with a condition for which hkl are present. */
function positions(
  system: LatticeSystem,
  p: number[],
  present: (h: number, k: number, l: number) => boolean,
  maxTwoTheta: number,
): number[] {
  const seen = new Set<string>();
  for (let h = 0; h <= 6; h++)
    for (let k = 0; k <= 6; k++)
      for (let l = 0; l <= 6; l++) {
        if (h + k + l === 0 || !present(h, k, l)) continue;
        const q = reciprocalTerms(system, [h, k, l]).reduce(
          (s, g, j) => s + g * (p[j] as number),
          0,
        );
        const s = (LAMBDA * Math.sqrt(q)) / 2;
        if (s >= 1) continue;
        const t = (2 * Math.asin(s) * 180) / Math.PI;
        if (t <= maxTwoTheta) seen.add(t.toFixed(4));
      }
  return [...seen].map(Number).sort((a, b) => a - b);
}

describe('indexing without a reference', () => {
  it('finds a face-centred cubic cell from its lines', () => {
    const a = 4.08;
    const fcc = (h: number, k: number, l: number) => h % 2 === k % 2 && k % 2 === l % 2;
    const lines = positions('cubic', [1 / a ** 2], fcc, 120);
    const [best] = indexPattern(lines, LAMBDA, INDEX_SYSTEMS);
    expect(best?.system).toBe('cubic');
    expect(best?.centring).toBe('F');
    expect(best?.fit.edges[0]?.a.value).toBeCloseTo(a, 4);
    expect(best?.indexed).toBe(lines.length);
    expect(best?.lines[0]?.hkl).toEqual([1, 1, 1]);
  });

  it('finds a body-centred tetragonal cell', () => {
    const [a, c] = [3.79, 9.51];
    const bct = (h: number, k: number, l: number) => (h + k + l) % 2 === 0;
    const lines = positions('tetragonal', [1 / a ** 2, 1 / c ** 2], bct, 80);
    const [best] = indexPattern(lines, LAMBDA, INDEX_SYSTEMS);
    expect(best?.system).toBe('tetragonal');
    expect(best?.centring).toBe('I');
    expect(best?.fit.edges[0]?.a.value).toBeCloseTo(a, 3);
    expect(best?.fit.edges[1]?.a.value).toBeCloseTo(c, 3);
  });

  it('finds a hexagonal cell and only tries the systems asked for', () => {
    const [a, c] = [3.25, 5.21];
    const lines = positions('hexagonal', [1 / a ** 2, 1 / c ** 2], () => true, 75);
    const [best] = indexPattern(lines, LAMBDA, ['hexagonal']);
    expect(best?.system).toBe('hexagonal');
    expect(best?.fit.edges[0]?.a.value).toBeCloseTo(a, 3);
    expect(best?.fit.edges[1]?.a.value).toBeCloseTo(c, 3);
    expect(indexPattern(lines, LAMBDA, ['cubic']).every((s) => s.system === 'cubic')).toBe(true);
  });

  it('returns nothing for too few lines', () => {
    expect(indexPattern([30, 40], LAMBDA, INDEX_SYSTEMS)).toEqual([]);
  });
});
