// @vitest-environment node
/*
 * Validation of the baseline methods on synthetic data whose true baseline is known: an
 * FTIR-like absorbance spectrum (1801 points, 2 cm⁻¹ step, nine bands 12–150 cm⁻¹ wide, noise
 * 0.003) and an XRD-like counting pattern (3500 points, 0.02° step, twelve pseudo-Voigt peaks
 * 0.15–0.4° wide, Poisson-like noise), each on a gently and a strongly curved baseline. The
 * error is the root-mean-square difference between estimated and true baseline over 5 noise
 * realisations. These numbers back the choice of arPLS as the default and are quoted in the
 * About page; they hold for these shapes and are not a general proof.
 */
import { describe, expect, it } from 'vitest';
import { rubberBandBaseline } from '../src/core/ftir/baseline';
import { alsBaseline, arplsBaseline } from '../src/core/math/whittaker';
import {
  anchorBackground,
  arplsBackground,
  cutIntoData,
  polynomialBackground,
  snipBackground,
} from '../src/core/xrd/process/background';
import { seededRandom } from '../src/core/xrd/synthetic';

const gaussian = (seed: number) => {
  const r = seededRandom(seed);
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
};
const rmse = (a: Float64Array, b: Float64Array) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] as number)) ** 2, 0) / a.length);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

const ftirX = Float64Array.from({ length: 1801 }, (_, i) => 400 + 2 * i);
const ftirBands: [number, number, number][] = [
  [3400, 0.4, 150],
  [2920, 0.3, 15],
  [2850, 0.2, 12],
  [1720, 0.6, 12],
  [1600, 0.3, 20],
  [1450, 0.2, 15],
  [1100, 0.5, 40],
  [800, 0.3, 30],
  [600, 0.4, 60],
];
const ftirBands0 = ftirX.map((w) =>
  ftirBands.reduce((s, [c, h, wd]) => s + h * Math.exp(-4 * Math.LN2 * ((w - c) / wd) ** 2), 0),
);
const ftirBaselines = {
  gentle: ftirX.map((w) => 0.05 + 0.15 * ((w - 400) / 3600) ** 2 + 0.04 * Math.sin(w / 700)),
  curved: ftirX.map(
    (w) =>
      0.05 +
      0.3 * ((w - 400) / 3600) ** 3 +
      0.08 * Math.exp(-(((w - 2000) / 400) ** 2)) +
      0.03 * Math.sin(w / 300),
  ),
};

const xrdX = Float64Array.from({ length: 3500 }, (_, i) => 10 + 0.02 * i);
const xrdLines: [number, number, number][] = [
  [19, 400, 0.3],
  [25.3, 2000, 0.15],
  [29, 1500, 0.2],
  [30.5, 500, 0.2],
  [35, 300, 0.4],
  [37.8, 400, 0.2],
  [48, 800, 0.25],
  [53.9, 300, 0.3],
  [55, 400, 0.3],
  [62.7, 300, 0.35],
  [70, 150, 0.4],
  [75, 200, 0.4],
];
const pv = (t: number, c: number, w: number) =>
  0.5 / (1 + 4 * ((t - c) / w) ** 2) + 0.5 * Math.exp(-4 * Math.LN2 * ((t - c) / w) ** 2);
const xrdPeaks = xrdX.map((t) => xrdLines.reduce((s, [c, h, w]) => s + h * pv(t, c, w), 0));
const xrdBaselines = {
  gentle: xrdX.map((t) => 150 + 400 * Math.exp(-(t - 10) / 12) + 30 * Math.sin(t / 9)),
  curved: xrdX.map(
    (t) =>
      150 +
      600 * Math.exp(-(t - 10) / 5) +
      250 * Math.exp(-4 * Math.LN2 * ((t - 25) / 8) ** 2) +
      40 * Math.sin(t / 4),
  ),
};

function score(
  base: Float64Array,
  signal: Float64Array,
  noise: (m: number, g: () => number) => number,
  methods: Record<string, (y: Float64Array) => Float64Array>,
): Record<string, number> {
  const errors: Record<string, number[]> = {};
  for (let seed = 1; seed <= 5; seed++) {
    const g = gaussian(seed);
    const y = base.map((b, i) => noise(b + (signal[i] as number), g));
    for (const [name, method] of Object.entries(methods))
      (errors[name] ??= []).push(rmse(method(y), base));
  }
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, mean(v)]));
}

describe('FTIR baselines on spectra with a known baseline', () => {
  const methods = {
    arPLS: (y: Float64Array) => arplsBaseline(y, 1e6),
    rubberBand: (y: Float64Array) => rubberBandBaseline(ftirX, y),
    polynomial3: (y: Float64Array) => polynomialBackground(ftirX, y, 3),
    asls: (y: Float64Array) => alsBaseline(y, 1e5, 0.01),
  };
  it.each(Object.keys(ftirBaselines) as (keyof typeof ftirBaselines)[])(
    'arPLS (λ = 10⁶) has the smallest error on the %s baseline',
    (shape) => {
      const errors = score(ftirBaselines[shape], ftirBands0, (m, g) => m + 0.003 * g(), methods);
      // Measured: gentle 0.0011, curved 0.0014 absorbance (the noise is 0.003).
      expect(errors['arPLS']).toBeLessThan(0.002);
      for (const [name, e] of Object.entries(errors))
        if (name !== 'arPLS') expect(e, name).toBeGreaterThan(errors['arPLS'] as number);
    },
  );
});

describe('XRD backgrounds on patterns with a known background', () => {
  const step = 0.02;
  const methods = {
    arPLS: (y: Float64Array) => arplsBackground(y, 4, step),
    snip: (y: Float64Array) => snipBackground(y, Math.round(2 / step)),
    polynomial4: (y: Float64Array) => polynomialBackground(xrdX, y, 4),
  };
  it.each(Object.keys(xrdBaselines) as (keyof typeof xrdBaselines)[])(
    'arPLS (width 4°) has the smallest error on the %s background',
    (shape) => {
      const errors = score(
        xrdBaselines[shape],
        xrdPeaks,
        (m, g) => Math.max(0, m + Math.sqrt(m) * g()),
        methods,
      );
      // Measured: gentle ≈ 7, curved ≈ 8 counts (noise 12 to 28 counts).
      expect(errors['arPLS']).toBeLessThan(10);
      for (const [name, e] of Object.entries(errors))
        if (name !== 'arPLS') expect(e, name).toBeGreaterThan(errors['arPLS'] as number);
    },
  );

  it('converts the width to λ so the stiffness does not depend on the step', () => {
    const fine = Float64Array.from({ length: 7000 }, (_, i) => 10 + 0.01 * i);
    const y = fine.map((t) => 200 + 50 * Math.sin(t / 6));
    const coarse = y.filter((_, i) => i % 2 === 0);
    const a = arplsBackground(y, 4, 0.01).filter((_, i) => i % 2 === 0);
    const b = arplsBackground(coarse, 4, 0.02);
    expect(rmse(a, b)).toBeLessThan(0.5);
  });

  it('notices a background that cuts into a broad peak', () => {
    const g = gaussian(3);
    const y = xrdX.map((t) => {
      const m = 200 + 600 * Math.exp(-4 * Math.LN2 * ((t - 30) / 3) ** 2);
      return m + Math.sqrt(m) * g();
    });
    // Manual points put on the peak make the background pass above its flanks…
    const wrong = anchorBackground(xrdX, [
      [10, 200],
      [30, 700],
      [80, 200],
    ]);
    const cutWrong = cutIntoData(
      y,
      y.map((v, i) => v - (wrong[i] as number)),
    );
    // …while a straight background under it does not.
    const flat = new Float64Array(y.length).fill(200);
    const cutFlat = cutIntoData(
      y,
      y.map((v, i) => v - (flat[i] as number)),
    );
    expect(cutFlat).toBeLessThan(0.02);
    expect(cutWrong).toBeGreaterThan(0.1);
  });
});
