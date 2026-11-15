import { describe, expect, it } from 'vitest';
import { bandShift, groupBands, type SamplePeak } from '../src/core/ftir/compare';
import { intensityClass, peakShapes } from '../src/core/ftir/peakShape';
import { nearestMaximum, peakAt } from '../src/core/ftir/peaks';

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

const grid = (from: number, to: number, step: number) =>
  Float64Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
const gauss = (x: number, c: number, w: number, h: number) =>
  h * Math.exp((-4 * Math.LN2 * (x - c) ** 2) / w ** 2);
const lorentz = (x: number, c: number, w: number, h: number) =>
  h / (1 + (4 * (x - c) ** 2) / w ** 2);

describe('width and area above the local baseline', () => {
  const x = grid(1000, 2000, 1);

  it('recovers the width and area of an isolated Gaussian band', () => {
    const [w, h] = [30, 0.5];
    const y = x.map((v) => gauss(v, 1500, w, h));
    const [s] = peakShapes(x, y, [1500]);
    expect(s?.fwhm).toBeCloseTo(w, 1);
    // Area of a Gaussian: h · FWHM · √(π / (4 ln 2)).
    expect(s?.area).toBeCloseTo(h * w * Math.sqrt(Math.PI / (4 * Math.LN2)), 3);
    expect(s?.heightAbove).toBeCloseTo(h, 6);
    expect(s?.overlap).toBe(false);
  });

  it('recovers the width and the truncated area of an isolated Lorentzian band', () => {
    const [w, h, D] = [20, 0.5, 500];
    const y = x.map((v) => lorentz(v, 1500, w, h));
    const [s] = peakShapes(x, y, [1500]);
    // The local baseline joins the two ends, where the band is L_D high.
    const LD = lorentz(1500 + D, 1500, w, h);
    const fwhm = w * Math.sqrt((2 * h) / (h + LD) - 1);
    const area = h * w * Math.atan((2 * D) / w) - 2 * D * LD;
    expect(s?.fwhm).toBeCloseTo(fwhm, 1);
    expect(s?.area).toBeCloseTo(area, 3);
    // The full analytic area π h w / 2 is larger: the baseline cuts off the wings.
    expect(s?.area).toBeLessThan((Math.PI * h * w) / 2);
  });

  it('does not change with a constant offset, and scales with the absorbance', () => {
    const y = x.map((v) => gauss(v, 1400, 40, 0.3) + gauss(v, 1650, 25, 0.6));
    const [a, b] = peakShapes(x, y, [1400, 1650]);
    const shifted = peakShapes(
      x,
      y.map((v) => v + 0.2),
      [1400, 1650],
    );
    const scaled = peakShapes(
      x,
      y.map((v) => 3 * v),
      [1400, 1650],
    );
    expect(shifted[0]?.fwhm).toBeCloseTo(a?.fwhm ?? 0, 9);
    expect(shifted[1]?.area).toBeCloseTo(b?.area ?? 0, 9);
    expect(scaled[0]?.fwhm).toBeCloseTo(a?.fwhm ?? 0, 9);
    expect(scaled[1]?.area).toBeCloseTo(3 * (b?.area ?? 0), 9);
  });

  it('gives the same result for the mirror image of the spectrum', () => {
    const y = x.map((v) => gauss(v, 1400, 40, 0.3) + lorentz(v, 1480, 20, 0.5));
    const mirrored = Float64Array.from(y).reverse();
    const mx = Float64Array.from(x)
      .reverse()
      .map((v) => 3000 - v);
    const direct = peakShapes(x, y, [1400, 1480]);
    const back = peakShapes(mx, mirrored, [1520, 1600]);
    expect(back[1]?.fwhm).toBeCloseTo(direct[0]?.fwhm ?? 0, 9);
    expect(back[0]?.area).toBeCloseTo(direct[1]?.area ?? 0, 9);
    expect(back[0]?.overlap).toBe(direct[1]?.overlap);
  });

  it('flags two bands that are not resolved at half height', () => {
    const close = x.map((v) => gauss(v, 1500, 30, 0.5) + gauss(v, 1525, 30, 0.4));
    expect(peakShapes(x, close, [1499, 1527]).map((s) => s.overlap)).toEqual([true, true]);
    const apart = x.map((v) => gauss(v, 1500, 30, 0.5) + gauss(v, 1600, 30, 0.4));
    expect(peakShapes(x, apart, [1500, 1600]).map((s) => s.overlap)).toEqual([false, false]);
  });
});

describe('intensity class', () => {
  it('uses the stated thresholds', () => {
    expect(intensityClass(100, 20)).toEqual({ strength: 'strong', broad: false });
    expect(intensityClass(60, 20).strength).toBe('strong');
    expect(intensityClass(59.9, 20).strength).toBe('medium');
    expect(intensityClass(25, null).strength).toBe('medium');
    expect(intensityClass(24.9, 150)).toEqual({ strength: 'weak', broad: true });
  });
});

describe('peaks added by hand', () => {
  const x = grid(1000, 2000, 2);
  const y = x.map((v) => gauss(v, 1500.6, 40, 0.5) + gauss(v, 1540, 30, 0.15));

  it('snaps to the nearest maximum, or none on a flank', () => {
    expect(nearestMaximum(x, y, 1507, 10)).toBeCloseTo(1500.6, 0);
    expect(nearestMaximum(x, y, 1470, 10)).toBeNull();
  });

  it('gives a flank point a prominence of 0', () => {
    const p = peakAt(x, y, 1470);
    expect(p?.height).toBeCloseTo(gauss(1470, 1500.6, 40, 0.5), 2);
    expect(p?.prominence).toBe(0);
  });
});

describe('grouping bands across samples', () => {
  const base = [500, 1000, 1630, 2920, 3400];
  const samples: SamplePeak[] = [
    ...base.map((wavenumber) => ({ sample: 'A', wavenumber })),
    ...base.map((wavenumber) => ({ sample: 'B', wavenumber: wavenumber + 3 })),
    ...base
      .filter((c) => c !== 1000)
      .map((wavenumber) => ({ sample: 'C', wavenumber: wavenumber - 4 })),
  ];

  it('recovers known shifts in three samples', () => {
    const bands = groupBands(samples, 10);
    expect(bands).toHaveLength(5);
    for (const band of bands) {
      expect(bandShift(band, 'B', 'A')).toBe(3);
      if (band.peaks.has('C')) expect(bandShift(band, 'C', 'A')).toBe(-4);
    }
    expect(bands[1]?.peaks.has('C')).toBe(false);
    expect(bandShift(must(bands[1]), 'C', 'A')).toBeNull();
    expect(bands[0]?.wavenumber).toBeCloseTo(499.6667, 3);
  });

  it('does not depend on the order of the samples or peaks', () => {
    const key = (list: readonly SamplePeak[]) =>
      JSON.stringify(
        groupBands(list, 10).map((b) => [b.wavenumber, [...b.peaks.entries()].sort()]),
      );
    const reference = key(samples);
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 20; k++) {
      const shuffled = [...samples].sort(() => random() - 0.5);
      expect(key(shuffled)).toBe(reference);
    }
  });

  it('keeps one peak per sample in a band and splits beyond the tolerance', () => {
    const bands = groupBands(
      [
        { sample: 'A', wavenumber: 1000 },
        { sample: 'A', wavenumber: 1006 },
        { sample: 'B', wavenumber: 1003 },
        { sample: 'B', wavenumber: 1030 },
      ],
      10,
    );
    expect(bands.map((b) => [...b.peaks.keys()].sort())).toEqual([['A', 'B'], ['A'], ['B']]);
  });
});
