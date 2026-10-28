// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  absorbanceAt,
  calibrate,
  concentrationFrom,
  firstOrderKinetics,
  type FirstOrderResult,
  type KineticPoint,
} from '../src/core/uvvis/concentration';

describe('absorbanceAt', () => {
  const w = Float64Array.from({ length: 11 }, (_, i) => 600 + i * 10); // 600 … 700 nm
  const a = Float64Array.from(w, (x) => (x - 600) / 100); // 0 … 1, linear
  it('interpolates between points and averages over a window', () => {
    expect(absorbanceAt(w, a, 655)).toBeCloseTo(0.55, 12);
    expect(absorbanceAt(w, a, 650, 10)).toBeCloseTo(0.5, 12); // mean of 0.4, 0.5, 0.6
    expect(absorbanceAt(w, a, 655, 2)).toBeCloseTo(0.55, 12); // no point inside: interpolated
  });
  it('is null outside the measured range', () => {
    expect(absorbanceAt(w, a, 599)).toBeNull();
    expect(absorbanceAt(w, a, 701)).toBeNull();
  });
});

describe('Beer–Lambert calibration', () => {
  // Made-up dye with ε = 80 000 L mol⁻¹ cm⁻¹ in a 1 cm cell, standards 1–10 µmol/L.
  const c = [1e-6, 2e-6, 5e-6, 1e-5];
  const A = c.map((x) => 80000 * x);
  it('recovers the absorptivity and an unknown concentration exactly', () => {
    const cal = calibrate(c, A, 1, false);
    expect(cal?.absorptivity).toBeCloseTo(80000, 6);
    expect(cal?.fit.intercept).toBeCloseTo(0, 12);
    expect(cal?.fit.rSquared).toBeCloseTo(1, 12);
    expect(concentrationFrom(0.4, cal as NonNullable<typeof cal>)).toBeCloseTo(5e-6, 15);
    expect(cal?.range).toEqual([1e-6, 1e-5]);
  });
  it('divides by the path length', () => {
    const cal = calibrate(
      c,
      A.map((x) => x / 2),
      0.5,
      true,
    );
    expect(cal?.absorptivity).toBeCloseTo(80000, 6);
  });
  it('a constant offset changes the intercept, not the slope', () => {
    const cal = calibrate(
      c,
      A.map((x) => x + 0.02),
      1,
      false,
    );
    expect(cal?.absorptivity).toBeCloseTo(80000, 6);
    expect(cal?.fit.intercept).toBeCloseTo(0.02, 12);
  });
  it('refuses too few standards or a bad path length', () => {
    expect(calibrate([1], [0.1], 1, false)).toBeNull();
    expect(calibrate(c, A, 0, false)).toBeNull();
  });
});

describe('pseudo-first-order kinetics', () => {
  // C/C0 = exp(−k t) with k = 0.025 min⁻¹ and A0 = 0.9; a dark period at −30 min.
  const k = 0.025;
  const t = [-30, 0, 15, 30, 60, 90, 120];
  const A = t.map((x) => (x < 0 ? 1.0 : 0.9 * Math.exp(-k * x)));
  it('recovers k, the half-life and the removal', () => {
    const r = firstOrderKinetics(t, A) as FirstOrderResult;
    expect(r.referenceTimeMin).toBe(0);
    expect(r.kPerMin).toBeCloseTo(k, 12);
    expect(r.fit.rSquared).toBeCloseTo(1, 12);
    expect(r.halfLifeMin).toBeCloseTo(Math.LN2 / k, 9);
    const last = r.points[r.points.length - 1] as KineticPoint;
    expect(last.removalPct).toBeCloseTo((1 - Math.exp(-k * 120)) * 100, 9);
    // The dark point is listed (C/C0 > 1, negative removal) but not fitted.
    expect(r.points[0]?.ratio).toBeCloseTo(1 / 0.9, 12);
    expect(r.fit.n).toBe(6);
  });
  it('uses the earliest point when there is no t = 0', () => {
    const r = firstOrderKinetics(
      [10, 20, 40],
      [0.5, 0.5 * Math.exp(-0.1), 0.5 * Math.exp(-0.3)],
    ) as FirstOrderResult;
    expect(r.referenceTimeMin).toBe(10);
    expect(r.kPerMin).toBeCloseTo(0.01, 12);
  });
  it('is null without enough points or with A0 ≤ 0', () => {
    expect(firstOrderKinetics([0], [1])).toBeNull();
    expect(firstOrderKinetics([0, 10], [0, 0.5])).toBeNull();
  });
});
