import { describe, expect, it } from 'vitest';
import { berarLelann } from '../src/core/xrd/rietveld/statistics';

/** Seeded normal deviates (mulberry32 + Box–Muller). */
function gaussians(n: number, seed: number): Float64Array {
  let t = seed >>> 0;
  const uniform = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return Float64Array.from(
    { length: n },
    () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform()),
  );
}
const z = (s: number) => Math.sqrt(2 * Math.PI * s) / (2 + Math.sqrt(2 * Math.PI * s));

describe('Bérar–Lelann s.u. factor', () => {
  it('matches the hand calculation of eqs 10–12', () => {
    // Runs {2, 3} and {5}: S″ = 19 + 2·2·3·z₂z₃; the single-point run cancels exactly.
    const expected = Math.sqrt((19 + 12 * z(5) * z(13)) / 19);
    expect(berarLelann([1, 2, 3, -1, -2])).toBeCloseTo(expected, 12);
    // Same value as the independent Python script and rietx: 1.17522.
    expect(berarLelann([1, 2, 3, -1, -2])).toBeCloseTo(1.175219, 5);
  });

  it('is 1 when every sign alternates (no correlated pairs)', () => {
    expect(berarLelann([1, -2, 3, -0.5, 4, -1])).toBe(1);
  });

  it('gives about 1.127 for white noise (Python script: 1.1268; rietx: 1.1267)', () => {
    expect(berarLelann(gaussians(400000, 11))).toBeCloseTo(1.1268, 2);
  });

  it('keeps the corrected s.u. nearly unchanged when every point is duplicated (paper §II)', () => {
    // A smooth misfit (systematic residual) sampled μ times more densely: the least-squares s.u.
    // fall as μ^(-1/2), so the factor must grow about as √μ for the corrected s.u. to stay put.
    const base = Float64Array.from({ length: 400 }, (_, i) => 3 * Math.sin(i / 15));
    const f1 = berarLelann(base);
    for (const mu of [2, 4, 8]) {
      const dense = Float64Array.from(
        { length: base.length * mu },
        (_, i) => base[Math.floor(i / mu)] as number,
      );
      const corrected = berarLelann(dense) / Math.sqrt(mu);
      expect(Math.abs(corrected / f1 - 1)).toBeLessThan(0.1);
    }
  });

  it('is unchanged by a change of sign, but depends on the absolute weights', () => {
    const r = gaussians(5000, 3).map((v, i) => v + Math.sin(i / 30));
    const f = berarLelann(r);
    expect(berarLelann(r.map((v) => -v))).toBeCloseTo(f, 12);
    // z_i uses the size of a_i, so wrong weights (here 10⁻⁶ of the true w) change the factor.
    expect(berarLelann(r.map((v) => 1e-3 * v))).not.toBeCloseTo(f, 3);
  });
});
