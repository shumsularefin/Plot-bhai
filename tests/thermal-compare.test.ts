// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summariseRun } from '../src/core/thermal/compare';
import { syntheticMassPct, type SyntheticStep } from '../src/core/thermal/synthetic';

/** A noise-free run from 30 to 800 °C every 0.5 °C with the given steps. */
function run(steps: readonly SyntheticStep[]) {
  const T: number[] = [];
  for (let t = 30; t <= 800; t += 0.5) T.push(t);
  return {
    T: Float64Array.from(T),
    m: Float64Array.from(T, (t) => syntheticMassPct(t, steps)),
  };
}

describe('summariseRun', () => {
  it('finds the fastest loss at the centre of the largest step and the known residue', () => {
    // One step of 40 % centred at 400 °C (σ = 20 °C): the DTG maximum is at 400 °C with height
    // 40 / (σ √(2π)) %/°C, half the loss (T at 80 %) is at 400 °C, and 60 % remains.
    const { T, m } = run([{ loss: 40, peak: 400, sigma: 20 }]);
    const s = summariseRun(T, m, 10, 700);
    expect(s.dtgPeakC).toBeCloseTo(400, 0);
    // The local quadratic over 10 °C flattens the peak slightly (about 0.7 %).
    const height = 40 / (20 * Math.sqrt(2 * Math.PI));
    expect(Math.abs((s.dtgPeak as number) / height - 1)).toBeLessThan(0.01);
    expect(s.residuePct as number).toBeCloseTo(60, 3);
    expect(s.totalLossPct).toBeCloseTo(40, 3);
    expect(s.t50).toBeNull();
    // 5 % lost when Φ((T − 400) / 20) = 1/8.
    expect(s.t5 as number).toBeCloseTo(400 - 20 * 1.15035, 1);
  });

  it('ranks two samples by thermal stability', () => {
    const a = run([{ loss: 30, peak: 300, sigma: 20 }]);
    const b = run([{ loss: 30, peak: 450, sigma: 20 }]);
    const early = summariseRun(a.T, a.m, 10, null);
    const late = summariseRun(b.T, b.m, 10, null);
    expect(late.t10 as number).toBeGreaterThan(early.t10 as number);
    expect((late.dtgPeakC as number) - (early.dtgPeakC as number)).toBeCloseTo(150, 0);
    expect(early.residuePct).toBeNull();
  });

  it('reports no DTG peak for a curve without mass loss', () => {
    const T = Float64Array.from({ length: 200 }, (_, i) => 30 + i);
    const s = summariseRun(T, new Float64Array(200).fill(100), 10, 100);
    expect(s.dtgPeakC).toBeNull();
    expect(s.t5).toBeNull();
    expect(s.residuePct).toBe(100);
  });
});
