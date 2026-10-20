// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { solve } from '../src/core/math/linear';
import {
  anchorBackground,
  polynomialBackground,
  snipBackground,
} from '../src/core/xrd/process/background';
import { kAlpha2Position, stripKAlpha2 } from '../src/core/xrd/process/kAlpha2';
import {
  DEFAULT_PROCESSING,
  runPipeline,
  type ProcessingSettings,
} from '../src/core/xrd/process/pipeline';
import { savitzkyGolay } from '../src/core/xrd/process/savitzkyGolay';
import { ANODES, DEFAULT_RADIATION } from '../src/core/xrd/radiation';
import { generatePattern, pseudoVoigt, type SyntheticPeak } from '../src/core/xrd/synthetic';

/*
 * Known-answer tests on synthetic data. Peaks are pseudo-Voigt (η = 0.5) at chosen positions
 * and heights; backgrounds and the Kα2 doublet are known exactly, so the corrected pattern can
 * be compared with the truth. Tolerances are stated in each test and in docs/PROGRESS.md.
 */

const CU = ANODES.Cu;
const STEP = 0.01;
const PEAKS: SyntheticPeak[] = [
  { center: 25, fwhm: 0.3, height: 3000, eta: 0.5 },
  { center: 38, fwhm: 0.3, height: 8000, eta: 0.5 },
  { center: 52, fwhm: 0.3, height: 2000, eta: 0.5 },
  { center: 66, fwhm: 0.3, height: 5000, eta: 0.5 },
];

const grid = () =>
  Float64Array.from(
    { length: Math.round((80 - 10) / STEP) + 1 },
    (_, i) => Math.round((10 + i * STEP) * 1e6) / 1e6,
  );
const peaksOnly = (x: Float64Array, peaks = PEAKS) =>
  x.map((v) =>
    peaks.reduce((sum, p) => sum + p.height * pseudoVoigt(v, p.center, p.fwhm, p.eta), 0),
  );
const withDoublet = (peaks: SyntheticPeak[]) =>
  peaks.flatMap((p) => [
    p,
    { ...p, center: kAlpha2Position(p.center, CU.kAlpha1, CU.kAlpha2), height: p.height * 0.5 },
  ]);

/**
 * Peak position and height near `near`: the highest point within ±0.15°, refined by a
 * least-squares parabola through the 17 points around it (robust to counting noise).
 */
function peakAt(x: Float64Array, y: Float64Array, near: number) {
  let best = -1;
  for (let i = 0; i < x.length; i++) {
    if (
      Math.abs((x[i] as number) - near) <= 0.15 &&
      (best < 0 || (y[i] as number) > (y[best] as number))
    )
      best = i;
  }
  const rows: number[][] = [];
  for (let k = -8; k <= 8; k++) rows.push([1, k * STEP, (k * STEP) ** 2, y[best + k] as number]);
  const sum = (f: (r: number[]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const m = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => sum((r) => (r[i] as number) * (r[j] as number))),
  );
  const v = [0, 1, 2].map((i) => sum((r) => (r[i] as number) * (r[3] as number)));
  const [a, b, c] = solve(m, v) as [number, number, number];
  const u = -b / (2 * c);
  return { position: (x[best] as number) + u, height: a + b * u + c * u * u };
}

const settings = (
  patch: Partial<{ [K in keyof ProcessingSettings]: Partial<ProcessingSettings[K]> }>,
): ProcessingSettings => ({
  zeroShift: { ...DEFAULT_PROCESSING.zeroShift, ...patch.zeroShift },
  smoothing: { ...DEFAULT_PROCESSING.smoothing, ...patch.smoothing },
  background: { ...DEFAULT_PROCESSING.background, ...patch.background },
  kAlpha2: { ...DEFAULT_PROCESSING.kAlpha2, ...patch.kAlpha2 },
  normalise: { ...DEFAULT_PROCESSING.normalise, ...patch.normalise },
});

describe('Savitzky–Golay', () => {
  it('uses the classic 5-point quadratic weights (−3, 12, 17, 12, −3)/35 in the middle', () => {
    const impulse = new Float64Array(11);
    impulse[5] = 35;
    const out = savitzkyGolay(impulse, 5, 2);
    expect([...out.slice(3, 8)].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      -3, 12, 17, 12, -3,
    ]);
  });

  it('leaves a cubic unchanged everywhere, ends included, when the order is 3', () => {
    const y = Float64Array.from(
      { length: 40 },
      (_, i) => 2 + 0.5 * i - 0.03 * i * i + 0.001 * i ** 3,
    );
    const out = savitzkyGolay(y, 9, 3);
    out.forEach((v, i) => expect(v).toBeCloseTo(y[i] as number, 9));
  });

  it('reduces noise while keeping a peak within 1 % of its height', () => {
    const { twoTheta, intensity } = generatePattern({
      start: 30,
      end: 46,
      step: STEP,
      peaks: [PEAKS[1] as SyntheticPeak],
      background: { constant: 0, amplitude: 0, decay: 1 },
      noiseSeed: 3,
    });
    const smooth = savitzkyGolay(intensity, 11, 3);
    const truth = peaksOnly(twoTheta, [PEAKS[1] as SyntheticPeak]);
    const rms = (a: Float64Array) =>
      Math.sqrt(a.reduce((s, v, i) => s + (v - (truth[i] as number)) ** 2, 0) / a.length);
    expect(rms(smooth)).toBeLessThan(0.6 * rms(intensity));
    expect(Math.abs(peakAt(twoTheta, smooth, 38).height - 8000) / 8000).toBeLessThan(0.01);
  });
});

describe('background removal recovers peak heights and positions (noise-free)', () => {
  const x = grid();
  const truthPeaks = peaksOnly(x);

  it('iterative polynomial: heights within 1 %, positions within 0.005°', () => {
    const bg = x.map((v) => 600 + 12 * v - 0.25 * v * v + 0.0018 * v ** 3);
    const y = truthPeaks.map((v, i) => v + (bg[i] as number));
    const fit = polynomialBackground(x, y, 3);
    const corrected = y.map((v, i) => v - (fit[i] as number));
    for (const p of PEAKS) {
      const found = peakAt(x, corrected, p.center);
      expect(Math.abs(found.height - p.height) / p.height).toBeLessThan(0.01);
      expect(Math.abs(found.position - p.center)).toBeLessThan(0.005);
    }
  });

  it('SNIP: heights within 2 %, positions within 0.005°', () => {
    const bg = x.map((v) => 150 + 900 * Math.exp(-v / 12));
    const y = truthPeaks.map((v, i) => v + (bg[i] as number));
    const fit = snipBackground(y, Math.round(2 / STEP));
    const corrected = y.map((v, i) => v - (fit[i] as number));
    for (const p of PEAKS) {
      const found = peakAt(x, corrected, p.center);
      expect(Math.abs(found.height - p.height) / p.height).toBeLessThan(0.02);
      expect(Math.abs(found.position - p.center)).toBeLessThan(0.005);
    }
    // Away from peaks the background is matched within 1 % of the smallest peak height.
    const i = Math.round((45 - 10) / STEP);
    expect(Math.abs(corrected[i] as number)).toBeLessThan(20);
  });

  it('manual anchors: the curve passes through every anchor and stays flat outside them', () => {
    const anchors: [number, number][] = [
      [20, 500],
      [40, 300],
      [60, 250],
      [75, 260],
    ];
    const bg = anchorBackground(x, anchors);
    for (const [ax, ay] of anchors) expect(bg[Math.round((ax - 10) / STEP)]).toBeCloseTo(ay, 6);
    expect(bg[0]).toBe(500);
    expect(bg[bg.length - 1]).toBe(260);
    // Monotone between anchors that are monotone: no overshoot below 300 between 40° and 60°.
    const between = bg.slice(Math.round(30 / STEP), Math.round(50 / STEP));
    expect(Math.min(...between)).toBeGreaterThanOrEqual(250 - 1e-9);
  });

  it('manual anchors with two points give a straight line', () => {
    const bg = anchorBackground(Float64Array.of(0, 1, 2, 3, 4), [
      [0, 10],
      [4, 30],
    ]);
    expect([...bg]).toEqual([10, 15, 20, 25, 30]);
  });
});

describe('Kα2 stripping (Rachinger)', () => {
  const x = grid();

  it('Kα2 sits where Bragg’s law puts it', () => {
    // Same d: sin θ2 / sin θ1 = λ2 / λ1.
    const t2 = kAlpha2Position(38, CU.kAlpha1, CU.kAlpha2);
    expect(Math.sin((t2 / 2) * (Math.PI / 180)) / Math.sin((38 / 2) * (Math.PI / 180))).toBeCloseTo(
      CU.kAlpha2 / CU.kAlpha1,
      12,
    );
    expect(t2).toBeGreaterThan(38);
  });

  it('removes a known doublet: Kα1 heights within 1 %, positions within 0.005°, Kα2 residue below 1 %', () => {
    const y = peaksOnly(x, withDoublet(PEAKS));
    const stripped = stripKAlpha2(x, y, CU.kAlpha1, CU.kAlpha2, 0.5);
    for (const p of PEAKS) {
      const found = peakAt(x, stripped, p.center);
      expect(Math.abs(found.height - p.height) / p.height).toBeLessThan(0.01);
      expect(Math.abs(found.position - p.center)).toBeLessThan(0.005);
      const i2 = Math.round((kAlpha2Position(p.center, CU.kAlpha1, CU.kAlpha2) - 10) / STEP);
      const truthAt = peaksOnly(Float64Array.of(x[i2] as number))[0] as number;
      expect(Math.abs((stripped[i2] as number) - truthAt) / p.height).toBeLessThan(0.01);
    }
  });

  it('handles a step larger than the Kα2 shift (within 2 % of the peak height everywhere)', () => {
    // Near 12° the Cu Kα2 shift is about 0.03°, smaller than this 0.05° step.
    const coarse = Float64Array.from({ length: 101 }, (_, i) => 10 + i * 0.05);
    const peak: SyntheticPeak = { center: 12, fwhm: 0.4, height: 1000, eta: 0.5 };
    const stripped = stripKAlpha2(
      coarse,
      peaksOnly(coarse, withDoublet([peak])),
      CU.kAlpha1,
      CU.kAlpha2,
      0.5,
    );
    const truth = peaksOnly(coarse, [peak]);
    const worst = Math.max(...stripped.map((v, i) => Math.abs(v - (truth[i] as number))));
    expect(worst / peak.height).toBeLessThan(0.02);
  });
});

describe('full pipeline on noisy synthetic data', () => {
  it('smoothing, SNIP and Kα2 stripping recover heights within 3 % and positions within 0.01°', () => {
    const { twoTheta, intensity } = generatePattern({
      start: 10,
      end: 80,
      step: STEP,
      peaks: PEAKS,
      background: { constant: 150, amplitude: 900, decay: 12 },
      noiseSeed: 11,
      kAlpha2: { lambda1: CU.kAlpha1, lambda2: CU.kAlpha2, ratio: 0.5 },
    });
    const result = runPipeline(
      twoTheta,
      intensity,
      settings({
        smoothing: { enabled: true, window: 11, order: 3 },
        background: { enabled: true, method: 'snip', snipWidthDeg: 2 },
        kAlpha2: { enabled: true },
      }),
      DEFAULT_RADIATION,
    );
    for (const p of PEAKS) {
      const found = peakAt(result.twoTheta, result.intensity, p.center);
      expect(Math.abs(found.height - p.height) / p.height).toBeLessThan(0.03);
      expect(Math.abs(found.position - p.center)).toBeLessThan(0.01);
    }
  });
});

describe('pipeline options are reversible and predictable', () => {
  const x = grid();
  const y = peaksOnly(x).map((v) => v + 100);

  it('with every step off, the data come back unchanged', () => {
    const result = runPipeline(x, y, DEFAULT_PROCESSING, DEFAULT_RADIATION);
    expect(result.twoTheta).toEqual(x);
    expect(result.intensity).toEqual(y);
    expect(result.background).toBeUndefined();
  });

  it('switching a step off again restores the original exactly', () => {
    const on = runPipeline(
      x,
      y,
      settings({ smoothing: { enabled: true }, normalise: { enabled: true } }),
      DEFAULT_RADIATION,
    );
    expect(on.intensity).not.toEqual(y);
    expect(
      runPipeline(x, y, settings({ smoothing: { enabled: false } }), DEFAULT_RADIATION).intensity,
    ).toEqual(y);
  });

  it('zero shift subtracts the shift from every 2θ', () => {
    const result = runPipeline(
      x,
      y,
      settings({ zeroShift: { enabled: true, shiftDeg: 0.05 } }),
      DEFAULT_RADIATION,
    );
    expect(result.twoTheta[0]).toBeCloseTo(9.95, 12);
    expect(peakAt(result.twoTheta, result.intensity, 37.95).position).toBeCloseTo(37.95, 3);
  });

  it('normalisation scales the highest point to the target', () => {
    const result = runPipeline(
      x,
      y,
      settings({ normalise: { enabled: true, target: 100 } }),
      DEFAULT_RADIATION,
    );
    expect(Math.max(...result.intensity)).toBeCloseTo(100, 9);
  });

  it('explains what is missing instead of guessing', () => {
    const manual = runPipeline(
      x,
      y,
      settings({ background: { enabled: true, method: 'manual', anchors: [] } }),
      DEFAULT_RADIATION,
    );
    expect(manual.messages.background?.[0]?.text).toContain('at least two anchor points');
    const mono = runPipeline(x, y, settings({ kAlpha2: { enabled: true } }), {
      ...DEFAULT_RADIATION,
      kAlpha1Only: true,
    });
    expect(mono.messages.kAlpha2?.[0]?.text).toContain('Kα1 only');
    expect(mono.intensity).toEqual(y);
    const noBg = runPipeline(x, y, settings({ kAlpha2: { enabled: true } }), DEFAULT_RADIATION);
    expect(noBg.messages.kAlpha2?.[0]?.level).toBe('warning');
  });
});

describe('performance', () => {
  it('processes 50,000 points with every step on in well under a second', () => {
    const { twoTheta, intensity } = generatePattern({
      start: 5,
      end: 80,
      step: 0.0015,
      peaks: PEAKS,
      background: { constant: 150, amplitude: 900, decay: 12 },
      noiseSeed: 5,
    });
    expect(twoTheta.length).toBe(50_001);
    for (const method of ['snip', 'polynomial'] as const) {
      const start = performance.now();
      runPipeline(
        twoTheta,
        intensity,
        settings({
          smoothing: { enabled: true, window: 21, order: 3 },
          background: { enabled: true, method, snipWidthDeg: 1 },
          kAlpha2: { enabled: true },
          normalise: { enabled: true },
        }),
        DEFAULT_RADIATION,
      );
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});

describe('tabulated wavelengths', () => {
  it('Cr, Fe, Co and Cu match Hölzer et al. (1997), Table IV, "this work" (nm × 10)', () => {
    const table: Record<string, [number, number]> = {
      Cr: [0.2289726, 0.2293651],
      Fe: [0.1936041, 0.1939973],
      Co: [0.1788996, 0.1792835],
      Cu: [0.15405929, 0.15444274],
    };
    for (const [anode, [a1, a2]] of Object.entries(table)) {
      const lines = ANODES[anode as keyof typeof ANODES];
      expect(lines.kAlpha1).toBeCloseTo(a1 * 10, 9);
      expect(lines.kAlpha2).toBeCloseTo(a2 * 10, 9);
    }
  });
});
