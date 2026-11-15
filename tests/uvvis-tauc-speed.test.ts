import { describe, expect, it } from 'vitest';
import { linearFit, type LinearFit } from '../src/core/math/linearFit';
import { linearFitMargin, WindowSums, type WindowLine } from '../src/core/math/windowSums';
import { bandEdgeAbsorbance, seededNoise } from '../src/core/uvvis/synthetic';
import {
  absorptionSignal,
  analyseTaucGap,
  steepestRise,
  suggestRegion,
  taucValues,
  type RegionRule,
} from '../src/core/uvvis/tauc';

// The Tauc region search with double-double window sums and exact re-decision (src/core/uvvis/
// tauc.ts, "Speed (2026-11-15)"; docs/validation.md section 22 Part C). The suggestion must be
// bit-identical to the earlier search, which fitted every window with `linearFit`.

/*
 * The earlier search, kept here as the reference: the code of src/core/uvvis/tauc.ts before the
 * change, fitting each window with `linearFit` on copied arrays.
 */
const SPANS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.6];
type Window = {
  from: number;
  to: number;
  target: number;
  slope: number;
  intercept: number;
  steepness: number;
  r2: number;
};
function finitePoints(x: Float64Array, y: Float64Array) {
  const xs: number[] = [];
  const ys: number[] = [];
  x.forEach((xi, i) => {
    const yi = y[i] as number;
    if (Number.isFinite(xi) && Number.isFinite(yi)) {
      xs.push(xi);
      ys.push(yi);
    }
  });
  return { xs, ys };
}
function referenceWindows(xs: number[], ys: number[], top: number): Window[] {
  const out: Window[] = [];
  for (const span of SPANS) {
    let end = 0;
    for (let start = 0; start < xs.length; start++) {
      while (end < xs.length - 1 && (xs[end] as number) - (xs[start] as number) < span) end++;
      if ((xs[end] as number) - (xs[start] as number) < span) break;
      if (end - start + 1 < 6) continue;
      const wy = ys.slice(start, end + 1);
      if (Math.max(...wy) < 0.05 * top) continue;
      const fit = linearFit(xs.slice(start, end + 1), wy);
      if (!fit || !(fit.slope > 0) || !Number.isFinite(fit.rSquared)) continue;
      out.push({
        from: xs[start] as number,
        to: xs[end] as number,
        target: span,
        slope: fit.slope,
        intercept: fit.intercept,
        steepness: fit.slope / Math.max(...wy),
        r2: fit.rSquared,
      });
    }
  }
  return out;
}
function referenceStraightestWidest(c: Window[]): Window {
  for (const threshold of [0.995, 0.98]) {
    const good = c.filter((w) => w.r2 >= threshold);
    if (good.length > 0) {
      const widest = Math.max(...good.map((w) => w.target));
      return good.filter((w) => w.target === widest).reduce((a, b) => (b.r2 > a.r2 ? b : a));
    }
  }
  return c.reduce((a, b) => (b.r2 > a.r2 ? b : a));
}
function referenceWidest(e: Float64Array, y: Float64Array): [number, number] | null {
  const { xs, ys } = finitePoints(e, y);
  const c = referenceWindows(
    xs,
    ys,
    ys.reduce((m, v) => Math.max(m, v), 0),
  );
  if (c.length === 0) return null;
  const chosen = referenceStraightestWidest(c);
  const narrowest = c.filter((w) => w.target === c[0]?.target && w.r2 >= 0.98);
  if (narrowest.length === 0) return [chosen.from, chosen.to];
  const steepest = narrowest.reduce((a, b) => (b.steepness > a.steepness ? b : a));
  const gap = -chosen.intercept / chosen.slope;
  if (gap > 0 && gap <= steepest.to) return [chosen.from, chosen.to];
  const best = referenceStraightestWidest(
    c.filter((w) => w.from <= steepest.to && w.to >= steepest.from),
  );
  return [best.from, best.to];
}
function reference(e: Float64Array, y: Float64Array, rule: RegionRule): [number, number] | null {
  if (rule === 'widest') return referenceWidest(e, y);
  const { xs, ys } = finitePoints(e, y);
  const top = ys.reduce((m, v) => Math.max(m, v), 0);
  const steep = steepestRise(e, y);
  if (steep?.atEnd) return referenceWidest(e, y);
  const valid = referenceWindows(xs, ys, top).filter((w) => {
    const gap = -w.intercept / w.slope;
    return gap > 0 && gap < w.from && (steep === null || gap <= steep.energyEv);
  });
  if (valid.length === 0) return null;
  const anchored = valid.filter(
    (w) =>
      steep !== null &&
      w.from <= steep.energyEv &&
      w.to >= steep.energyEv &&
      w.slope >= 0.5 * steep.slope,
  );
  const chosen = referenceStraightestWidest(anchored.length > 0 ? anchored : valid);
  return [chosen.from, chosen.to];
}

/** A Tauc curve of a synthetic edge with a level, a curved background and noise. */
function curve(k: number) {
  const n = [0.5, 2, 1.5, 3][k % 4] as number;
  const { wavelengthNm, values } = bandEdgeAbsorbance({
    startNm: 250,
    endNm: 700,
    stepNm: [1, 0.5, 0.25, 2][k % 4] as number,
    bandGapEv: 2.2 + 0.15 * k,
    n,
    baseline: [0, 0, 0.05, 0.2, 0.5][k % 5] as number,
    noiseSeed: k + 1,
    noiseSd: [0, 0, 0.001, 0.003, 0.02][k % 5] as number,
  });
  const signal = absorptionSignal(
    wavelengthNm,
    values,
    { kind: 'absorbance', scale: 'fraction' },
    null,
  );
  const background = k % 3 === 0 ? 0.01 * k : 0;
  const s = signal.signal.map((v, i) => v + background * ((signal.energyEv[i] as number) / 3) ** 4);
  return { e: signal.energyEv, s, exponent: 1 / n };
}

/** Exact least squares in rational arithmetic: every double is an integer times 2⁻¹⁰⁷⁴. */
function exactLine(x: Float64Array, y: Float64Array) {
  const big = (v: number): bigint => {
    // v = m · 2^e with integer m; scaled to an integer multiple of 2^-1074.
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, v);
    const bits = view.getBigUint64(0);
    const sign = bits >> 63n ? -1n : 1n;
    const exponent = Number((bits >> 52n) & 0x7ffn);
    const mantissa = bits & ((1n << 52n) - 1n);
    const m = exponent === 0 ? mantissa : mantissa | (1n << 52n);
    const shift = Math.max(exponent, 1) - 1;
    return sign * (m << BigInt(shift));
  };
  const n = BigInt(x.length);
  const xs = Array.from(x, big);
  const ys = Array.from(y, big);
  const sum = (f: (i: number) => bigint) => xs.reduce((t, _, i) => t + f(i), 0n);
  const sx = sum((i) => xs[i] as bigint);
  const sy = sum((i) => ys[i] as bigint);
  const cxx = n * sum((i) => (xs[i] as bigint) * (xs[i] as bigint)) - sx * sx;
  const cxy = n * sum((i) => (xs[i] as bigint) * (ys[i] as bigint)) - sx * sy;
  const cyy = n * sum((i) => (ys[i] as bigint) * (ys[i] as bigint)) - sy * sy;
  // Ratios of big integers to doubles, through 60 extra binary digits.
  const ratio = (p: bigint, q: bigint) => {
    const scale = BigInt(Math.max(0, q.toString(2).length - p.toString(2).length) + 60);
    return Number((p << scale) / q) / 2 ** Number(scale);
  };
  const numerator =
    sy * sum((i) => (xs[i] as bigint) * (xs[i] as bigint)) -
    sx * sum((i) => (xs[i] as bigint) * (ys[i] as bigint));
  return {
    slope: ratio(cxy, cxx),
    // (Σy·Σx² − Σx·Σxy) / (n·Sxx): the scaled numerator carries one more factor 2^1074.
    intercept: ratio(numerator, cxx << 1074n),
    rSquared: ratio(cxy * cxy, cxx * cyy),
  };
}

describe('window sums (double-double)', () => {
  it('give the exact line through points on a line', () => {
    const x = Float64Array.from({ length: 50 }, (_, i) => 1 + i / 8);
    const sums = new WindowSums(
      x,
      x.map((v) => 2 + 3 * v),
    );
    const line = sums.line(5, 30);
    expect(line?.slope).toBe(3);
    expect(line?.intercept).toBe(2);
    expect(line?.rSquared).toBe(1);
  });

  it('match exact rational arithmetic, where linearFit stays within linearFitMargin', () => {
    // Ill-conditioned on purpose: x near 10⁴ with a spread down to 3·10⁻⁴, y near 10⁶.
    const noise = seededNoise(3, 1);
    const x = Float64Array.from({ length: 2000 }, (_, i) => 1e4 + i * 5e-5);
    const y = x.map((v) => 1e6 + 40 * (v - 1e4) + noise());
    const sums = new WindowSums(x, y);
    for (const [start, end] of [
      [0, 1999],
      [10, 16],
      [500, 1500],
      [1990, 1999],
    ] as const) {
      const exact = exactLine(x.subarray(start, end + 1), y.subarray(start, end + 1));
      const line = sums.line(start, end) as WindowLine;
      const fit = linearFit(x.subarray(start, end + 1), y.subarray(start, end + 1)) as LinearFit;
      const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
      expect(relative(line.slope, exact.slope)).toBeLessThan(1e-14);
      expect(relative(line.intercept, exact.intercept)).toBeLessThan(1e-14);
      expect(relative(line.rSquared, exact.rSquared)).toBeLessThan(1e-14);
      // linearFit's own rounding (up to 2.8·10⁻⁷ in R² here) is inside the decision margin.
      const margin = linearFitMargin(line);
      expect(Math.abs(fit.rSquared - exact.rSquared)).toBeLessThan(margin);
      expect(Math.abs(fit.slope - exact.slope)).toBeLessThan(
        margin * Math.sqrt(line.syy / line.sxx),
      );
    }
  });

  it('are unchanged by the order of the windows asked for (invariance)', () => {
    const noise = seededNoise(9, 0.1);
    const x = Float64Array.from({ length: 300 }, (_, i) => i / 100);
    const sums = new WindowSums(
      x,
      x.map((v) => v * v + noise()),
    );
    const a = sums.line(40, 90);
    sums.line(0, 299);
    expect(sums.line(40, 90)).toEqual(a);
  });
});

describe('region search: same windows as the earlier search', () => {
  it('gives bit-identical regions on 40 synthetic curves, both rules and transitions', () => {
    let compared = 0;
    for (let k = 0; k < 20; k++) {
      const { e, s, exponent } = curve(k);
      for (const p of [exponent, 2]) {
        const y = taucValues(e, s, p);
        for (const rule of ['steepest', 'widest'] as const) {
          const expected = reference(e, y, rule);
          const got = suggestRegion(e, y, rule);
          expect(got, `curve ${k}, power ${p}, ${rule}`).toEqual(expected);
          if (got && expected) {
            expect(Object.is(got[0], expected[0]) && Object.is(got[1], expected[1])).toBe(true);
          }
          compared++;
        }
      }
    }
    expect(compared).toBe(80);
  });

  it('keeps the tie-breaking of a noise-free straight Tauc line (R² = 1 to the last digit)', () => {
    // (αE)² is exactly linear above the gap for n = 1/2, so many windows tie at R² ≈ 1.
    const { e, s } = curve(0);
    const y = taucValues(e, s, 2);
    for (const rule of ['steepest', 'widest'] as const) {
      expect(suggestRegion(e, y, rule)).toEqual(reference(e, y, rule));
    }
  });
});

describe('region search on 50,001 points', () => {
  // A wavelength grid of 0.012 nm from 200 to 800 nm, edge at 3.2 eV with a level and noise.
  const { wavelengthNm, values } = bandEdgeAbsorbance({
    startNm: 200,
    endNm: 800,
    stepNm: 0.012,
    bandGapEv: 3.2,
    n: 0.5,
    strength: 1.2,
    baseline: 0.05,
    noiseSeed: 7,
    noiseSd: 0.003,
  });
  const signal = absorptionSignal(
    wavelengthNm,
    values,
    { kind: 'absorbance', scale: 'fraction' },
    null,
  );

  it('has 50,001 points', () => {
    expect(signal.energyEv.length).toBe(50001);
  });

  it('suggests a region in well under the 20 s of the earlier search', () => {
    const y = taucValues(signal.energyEv, signal.signal, 2);
    const start = performance.now();
    const region = suggestRegion(signal.energyEv, y);
    // About 0.8 s on the development container; the bound leaves room for slower CI machines.
    expect(performance.now() - start).toBeLessThan(8000);
    expect(region?.[0]).toBeGreaterThan(3.2);
    expect(region?.[0]).toBeLessThan(3.4);
  }, 30_000);

  it('finds the band gap with the sub-gap level subtracted', () => {
    const gap = analyseTaucGap(signal.energyEv, signal.signal, 2, {
      method: null,
      edgeRegion: null,
      baselineRegion: null,
    });
    expect(gap.method).toBe('subtract-baseline');
    expect(Math.abs((gap.fit?.egEv ?? 0) - 3.2)).toBeLessThan(0.01);
  }, 60_000);
});
