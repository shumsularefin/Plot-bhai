// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  calibrationError,
  calibrationWarnings,
  xPerPixel,
  toData,
  toPixel,
  type Calibration,
} from '../src/core/digitize/calibration';
import { applyEdits, toCurve } from '../src/core/digitize/curve';
import { backgroundColor, extractCurve, pickCurve, type Rgb } from '../src/core/digitize/extract';
import { fitPeaks } from '../src/core/xrd/peaks/fit';
import { scherrer } from '../src/core/xrd/size/methods';
import {
  blank,
  degrade,
  drawAxes,
  drawBlock,
  drawCurve,
  exactCalibration,
  pixelOf,
  pseudoVoigt,
  type PlotSpec,
} from './digitizeFixtures';

const BLACK: Rgb = [0, 0, 0];
const RED: Rgb = [214, 39, 40];

const spec: PlotSpec = {
  width: 720,
  height: 420,
  area: [60, 20, 660, 380],
  xRange: [20, 80],
  yRange: [0, 1200],
};

/** Two peaks on a flat background: FWHM 0.6° and 0.8°, so 6 and 8 pixels at 0.1° per pixel. */
const pattern = (x: number) =>
  100 + 900 * pseudoVoigt(x, 35, 0.6, 0.4) + 500 * pseudoVoigt(x, 62, 0.8, 0.4);

describe('axis calibration', () => {
  it('maps pixels to values and back, also on a rotated image', () => {
    const c = exactCalibration(spec);
    expect(calibrationError(c)).toBeNull();
    const v = toData(c, pixelOf(spec, 47.5, 600));
    expect(v.x).toBeCloseTo(47.5, 9);
    expect(v.y).toBeCloseTo(600, 9);
    expect(xPerPixel(c)).toBeCloseTo(0.1, 12);

    // The same plot turned by 7° about (0, 0): the affine map still recovers every value.
    const a = (7 * Math.PI) / 180;
    const turn = (p: { x: number; y: number }) => ({
      x: p.x * Math.cos(a) - p.y * Math.sin(a),
      y: p.x * Math.sin(a) + p.y * Math.cos(a),
    });
    const rotated: Calibration = {
      x: [
        { at: turn(c.x[0].at), value: 20 },
        { at: turn(c.x[1].at), value: 80 },
      ],
      y: [
        { at: turn(c.y[0].at), value: 0 },
        { at: turn(c.y[1].at), value: 1200 },
      ],
      yScale: 'linear',
    };
    const w = toData(rotated, turn(pixelOf(spec, 31, 250)));
    expect(w.x).toBeCloseTo(31, 9);
    expect(w.y).toBeCloseTo(250, 9);
    const back = toPixel(rotated, { x: 31, y: 250 });
    const truth = turn(pixelOf(spec, 31, 250));
    expect(back.x).toBeCloseTo(truth.x, 9);
    expect(back.y).toBeCloseTo(truth.y, 9);
    expect(calibrationWarnings(rotated).some((t) => t.includes('tilted by 7.0°'))).toBe(true);
  });

  it('reads a logarithmic intensity axis', () => {
    const log: PlotSpec = { ...spec, yRange: [10, 10000], yScale: 'log' };
    const c = exactCalibration(log);
    expect(toData(c, pixelOf(log, 50, 316.2)).y).toBeCloseTo(316.2, 6);
    expect(toPixel(c, { x: 50, y: 1000 }).y).toBeCloseTo(pixelOf(log, 50, 1000).y, 9);
  });

  it('explains unusable calibrations', () => {
    const c = exactCalibration(spec);
    expect(calibrationError({ ...c, x: [c.x[0], { ...c.x[1], value: 20 }] })).toMatch(
      /different values/,
    );
    expect(calibrationError({ ...c, yScale: 'log' })).toMatch(/above zero/);
    // Intensity points marked along the 2θ axis by mistake.
    expect(calibrationError({ ...c, y: [c.x[0], { ...c.x[1], value: 5 }] })).toMatch(/same line/);
  });
});

/** Draws, extracts and converts; returns the pattern and the extraction. */
function digitize(
  img: ReturnType<typeof blank>,
  plot: PlotSpec,
  seedX: number,
  f: (x: number) => number,
  color: Rgb = BLACK,
  tolerance = 120,
) {
  const background = backgroundColor(img);
  const picked = pickCurve(img, pixelOf(plot, seedX, f(seedX)), background);
  if (!picked) throw new Error('no curve under the seed');
  const [l, t, r, b] = plot.area;
  const extraction = extractCurve(img, {
    color,
    tolerance,
    removeStraightLines: true,
    region: { x: l - 2, y: t - 2, width: r - l + 4, height: b - t + 4 },
    seeds: [picked.at],
  });
  const result = toCurve(extraction.points, exactCalibration(plot));
  if (!result) throw new Error('no pattern');
  return { result, extraction, picked };
}

/** Root-mean-square difference from the true curve, as a fraction of the y range. */
function rmsError(x: Float64Array, y: Float64Array, f: (x: number) => number, plot: PlotSpec) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += ((y[i] as number) - f(x[i] as number)) ** 2;
  return Math.sqrt(sum / x.length) / (plot.yRange[1] - plot.yRange[0]);
}

describe('curve extraction', () => {
  it('follows a black curve on black axes with gridlines and recovers it closely', () => {
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec, [200, 200, 200]);
    drawCurve(img, spec, { f: pattern, color: BLACK, thickness: 2 });
    const { result, extraction } = digitize(img, spec, 50, pattern);
    expect(extraction.removedLines).toBeGreaterThan(0);
    expect(result.x[0]).toBeLessThan(20.3);
    expect(result.x[result.x.length - 1]).toBeGreaterThan(79.7);
    expect(rmsError(result.x, result.y, pattern, spec)).toBeLessThan(0.004);
    expect(result.gaps).toEqual([]);
  });

  it('keeps peak heights and widths despite a thick line', () => {
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec);
    drawCurve(img, spec, { f: pattern, color: BLACK, thickness: 3 });
    const { result } = digitize(img, spec, 50, pattern);
    const peaks = fitPeaks(
      result.x,
      result.y,
      [
        { center: 35, width: 0.5 },
        { center: 62, width: 0.5 },
      ],
      { profile: 'pseudo-voigt', fixedEta: null },
    )
      .flatMap((r) => r.peaks)
      .sort((a, b) => a.center - b.center);
    // Heights 900 and 500 above the background, FWHM 0.6° and 0.8° (6 and 8 pixels). A 3 px line
    // rounds off a 6 px wide apex, so that peak comes back about 6 % low and 5 % wide.
    expect(Math.abs((peaks[0]?.height ?? 0) / 900 - 1)).toBeLessThan(0.08);
    expect(Math.abs((peaks[1]?.height ?? 0) / 500 - 1)).toBeLessThan(0.08);
    expect(Math.abs((peaks[0]?.fwhm ?? 0) / 0.6 - 1)).toBeLessThan(0.08);
    expect(Math.abs((peaks[1]?.fwhm ?? 0) / 0.8 - 1)).toBeLessThan(0.08);
  });

  it('separates two curves by colour and by the seed', () => {
    const red = (x: number) => 600 + 400 * pseudoVoigt(x, 48, 0.7, 0.4);
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec);
    drawCurve(img, spec, { f: pattern, color: BLACK, thickness: 2 });
    drawCurve(img, spec, { f: red, color: RED, thickness: 2 });
    drawBlock(img, 520, 40, 120, 14, BLACK); // a legend
    const black = digitize(img, spec, 50, pattern);
    expect(rmsError(black.result.x, black.result.y, pattern, spec)).toBeLessThan(0.006);
    const second = digitize(img, spec, 40, red, RED, 90);
    expect(rmsError(second.result.x, second.result.y, red, spec)).toBeLessThan(0.006);
  });

  it('follows the seeded curve of two stacked curves of the same colour', () => {
    const upper = (x: number) => 650 + 0.45 * pattern(x);
    const lower = (x: number) => 0.45 * pattern(x);
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec);
    drawCurve(img, spec, { f: upper, color: BLACK, thickness: 2 });
    drawCurve(img, spec, { f: lower, color: BLACK, thickness: 2 });
    const { result } = digitize(img, spec, 50, upper);
    expect(rmsError(result.x, result.y, upper, spec)).toBeLessThan(0.006);
  });

  it('copes with a noisy, blurred screenshot', () => {
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec, [210, 210, 210]);
    drawCurve(img, spec, { f: pattern, color: [30, 30, 120], thickness: 2 });
    const noisy = degrade(img, 18);
    const { result } = digitize(noisy, spec, 50, pattern, [30, 30, 120], 150);
    expect(rmsError(result.x, result.y, pattern, spec)).toBeLessThan(0.008);
  });

  it('ignores inward tick marks that touch a low baseline', () => {
    // Background 100 counts sits 30 px above the axis; ticks 2 px wide reach 31 px up into it.
    const img = blank(spec.width, spec.height);
    drawAxes(img, spec);
    drawCurve(img, spec, { f: pattern, color: BLACK, thickness: 2 });
    const ticks = [30, 40, 50, 70];
    for (const tick of ticks) {
      const p = pixelOf(spec, tick, 0);
      drawBlock(img, Math.round(p.x) - 1, spec.area[3] - 31, 2, 31, BLACK);
    }
    const { result } = digitize(img, spec, 45, pattern);
    let worst = 0;
    result.x.forEach((x, i) => {
      if (ticks.some((t) => Math.abs(x - t) < 1))
        worst = Math.max(worst, Math.abs((result.y[i] as number) - pattern(x)));
    });
    // One pixel is 3.3 counts; a dip onto a tick would be about 100.
    expect(worst).toBeLessThan(12);
  });

  it('applies erasures and hand-placed points', () => {
    const points = [
      { x: 10.5, y: 5 },
      { x: 11.5, y: 5 },
      { x: 12.5, y: 50 },
      { x: 13.5, y: 5 },
    ];
    const edited = applyEdits(points, {
      erased: [{ x: 12, y: 40, width: 2, height: 20 }],
      added: [{ x: 13.2, y: 6 }],
    });
    expect(edited).toEqual([
      { x: 10.5, y: 5 },
      { x: 11.5, y: 5 },
      { x: 13.2, y: 6 },
    ]);
  });
});

describe('from screenshot to crystallite size', () => {
  it('recovers the FWHM and the Scherrer size of known peaks', () => {
    // Peaks with a chosen width: D = Kλ/(β cos θ) with K = 0.9, λ = 0.15406 nm.
    const lambdaNm = 0.15406;
    const sizeNm = 15;
    const width = (center: number) =>
      ((0.9 * lambdaNm) / (sizeNm * Math.cos((center / 2) * (Math.PI / 180)))) * (180 / Math.PI);
    const lines = [
      [30, 900],
      [45, 600],
      [57, 450],
    ];
    const centers = lines.map(([c]) => c as number);
    const f = (x: number) =>
      80 +
      lines.reduce(
        (s, [c, h]) => s + (h as number) * pseudoVoigt(x, c as number, width(c as number), 0.5),
        0,
      );
    const plot: PlotSpec = { ...spec, width: 1300, area: [60, 20, 1260, 380], xRange: [20, 80] };
    const img = blank(plot.width, plot.height);
    drawAxes(img, plot);
    drawCurve(img, plot, { f, color: BLACK, thickness: 2 });
    const { result } = digitize(img, plot, 25, f);
    const regions = fitPeaks(
      result.x,
      result.y,
      centers.map((c) => ({ center: c, width: 0.6 })),
      { profile: 'pseudo-voigt', fixedEta: null },
    );
    const peaks = regions.flatMap((r) => r.peaks).sort((a, b) => a.center - b.center);
    expect(peaks).toHaveLength(3);
    peaks.forEach((p, i) => {
      expect(p.center).toBeCloseTo(centers[i] as number, 1);
      // 0.05° per pixel and a 2 px line: the width comes back within 8 %.
      expect(Math.abs(p.fwhm / width(centers[i] as number) - 1)).toBeLessThan(0.08);
    });
    const s = scherrer(
      peaks.map((p) => ({
        twoTheta: p.center,
        beta: (p.fwhm * Math.PI) / 180,
        betaSigma: 0,
        modulusGPa: null,
      })),
      { k: 0.9, lambdaNm, modulusGPa: null },
    );
    expect(Math.abs(s.mean / sizeNm - 1)).toBeLessThan(0.08);
  });
});
