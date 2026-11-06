import { describe, expect, it } from 'vitest';
import {
  applyRange,
  autoRange,
  equalize,
  subtractBackground,
  unsharpMask,
} from '../src/core/particles/detect/adjust';
import {
  AUTO_THRESHOLD_METHODS,
  autoThreshold,
  type AutoThresholdMethod,
} from '../src/core/particles/detect/autoThreshold';
import { ellipseRuns } from '../src/core/particles/detect/manual';
import { fitEllipse, greyStats, lineProfile } from '../src/core/particles/detect/measure';
import { normaliseRuns, runsArea, shapeOf } from '../src/core/particles/detect/regions';
import { lineAngle, snapLine, snapSquare } from '../src/core/particles/geometry';
import { measureColumns } from '../src/modules/particles/measureColumns';

describe('Shift-snapping of drawn lines', () => {
  it('measures angles counter-clockwise with y up, as on screen', () => {
    expect(lineAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(lineAngle({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(90);
    expect(lineAngle({ x: 0, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
    expect(lineAngle({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(270);
  });

  it('rounds the angle to 15° steps and keeps the length', () => {
    const a = { x: 10, y: 10 };
    const nearlyFlat = snapLine(a, { x: 110, y: 13 });
    expect(nearlyFlat.y).toBe(10);
    expect(Math.hypot(nearlyFlat.x - a.x, nearlyFlat.y - a.y)).toBeCloseTo(Math.hypot(100, 3));
    const nearlyVertical = snapLine(a, { x: 12, y: 60 });
    expect(nearlyVertical.x).toBe(10);
    const diagonal = snapLine(a, { x: 60, y: -38 });
    expect(lineAngle(a, diagonal)).toBeCloseTo(45);
    expect(snapLine(a, { x: 60, y: -20 }).x).toBeGreaterThan(10);
    expect(lineAngle(a, snapLine(a, { x: 60, y: -20 }))).toBeCloseTo(30);
    expect(lineAngle(a, snapLine(a, { x: 60, y: -20 }, 45))).toBeCloseTo(45);
    expect(snapLine(a, a)).toEqual(a);
  });

  it('makes boxes square in the direction dragged', () => {
    expect(snapSquare({ x: 0, y: 0 }, { x: 5, y: -3 })).toEqual({ x: 5, y: -5 });
    expect(snapSquare({ x: 0, y: 0 }, { x: -2, y: 7 })).toEqual({ x: -7, y: 7 });
  });
});

describe('image adjustments', () => {
  /** Ramp background 50 + x (or 150 + x) with a 3 × 3 square 100 brighter (or 40 darker) at x 20 to 22. */
  const ramp = (dark: boolean) => {
    const width = 64;
    const height = 16;
    const gray = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const inside = x >= 20 && x <= 22 && y >= 6 && y <= 8;
        gray[y * width + x] = dark ? 150 + x - (inside ? 40 : 0) : 50 + x + (inside ? 100 : 0);
      }
    return { gray, width, height };
  };

  it('removes a brightness ramp and keeps particles smaller than the window', () => {
    const { gray, width, height } = ramp(false);
    const out = subtractBackground(gray, width, height, 5, false);
    // Away from the right edge (where the window is cut) the ramp is gone.
    for (let x = 0; x < width - 6; x++) {
      const inside = x >= 20 && x <= 22;
      expect(out[2 * width + x]).toBe(0);
      expect(out[7 * width + x]).toBe(inside ? 100 : 0);
    }
  });

  it('subtracts towards white when the particles are dark', () => {
    const { gray, width, height } = ramp(true);
    const out = subtractBackground(gray, width, height, 5, true);
    for (let x = 6; x < width; x++) {
      const inside = x >= 20 && x <= 22;
      expect(out[2 * width + x]).toBe(255);
      expect(out[7 * width + x]).toBe(inside ? 215 : 255);
    }
  });

  it('chooses the automatic range that saturates 0.35 % of the pixels and stretches it', () => {
    const hist = new Int32Array(256);
    hist[0] = 1;
    hist[50] = 1000;
    hist[200] = 1000;
    hist[255] = 1;
    expect(autoRange(hist)).toEqual({ min: 50, max: 200 });
    expect(autoRange(new Int32Array(256))).toBeNull();
    const out = applyRange(Uint8Array.from([0, 50, 125, 200, 255]), 50, 200);
    expect(Array.from(out)).toEqual([0, 0, 128, 255, 255]);
  });

  it('equalises the histogram with the classic cumulative mapping', () => {
    const gray = Uint8Array.from([0, 0, 0, 0, 10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
    expect(Array.from(new Set(equalize(gray, 4)))).toEqual([0, 85, 170, 255]);
  });

  it('leaves flat areas alone when sharpening and steepens edges', () => {
    const width = 20;
    const height = 5;
    const gray = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) gray[y * width + x] = x < 10 ? 100 : 200;
    const out = unsharpMask(gray, width, height, 1, 0.6);
    expect(out[2 * width + 1]).toBe(100);
    expect(out[2 * width + 18]).toBe(200);
    expect(out[2 * width + 9] as number).toBeLessThan(100);
    expect(out[2 * width + 10] as number).toBeGreaterThan(200);
  });
});

describe('automatic thresholds', () => {
  /** Two equal Gaussian peaks at 70 and 170 (σ = 25), cut symmetrically at 20 and 220: symmetric about 120. */
  const bimodal = new Int32Array(256);
  for (let v = 20; v <= 220; v++)
    bimodal[v] = Math.round(
      10000 * (Math.exp(-((v - 70) ** 2) / 1250) + Math.exp(-((v - 170) ** 2) / 1250)),
    );

  it('puts the symmetric methods midway between two equal peaks', () => {
    for (const method of [
      'default',
      'intermodes',
      'minimum',
      'mean',
      'moments',
      'otsu',
    ] as AutoThresholdMethod[]) {
      const { level, fellBack } = autoThreshold(method, bimodal);
      expect(fellBack).toBe(false);
      expect(Math.abs(level - 120), method).toBeLessThanOrEqual(1);
    }
  });

  it('puts every method between the two peaks', () => {
    for (const method of AUTO_THRESHOLD_METHODS) {
      const { level } = autoThreshold(method, bimodal);
      expect(level, method).toBeGreaterThan(70);
      expect(level, method).toBeLessThan(170);
    }
  });

  it('falls back to Otsu when a method needs two peaks and there is one', () => {
    const single = new Int32Array(256);
    for (let v = 0; v < 256; v++) single[v] = Math.round(1000 * Math.exp(-((v - 100) ** 2) / 800));
    for (const method of ['intermodes', 'minimum'] as AutoThresholdMethod[]) {
      const result = autoThreshold(method, single);
      expect(result.fellBack).toBe(true);
      expect(result.level).toBe(autoThreshold('otsu', single).level);
    }
  });

  it('places the triangle threshold in the long tail, on either side', () => {
    // A peak at 50 with an exponential tail towards white, and its mirror image.
    const tail = new Int32Array(256);
    for (let v = 40; v < 256; v++)
      tail[v] = v < 50 ? (v - 39) * 10000 : Math.round(100000 * Math.exp(-(v - 50) / 20));
    const mirror = tail.map((_, v) => tail[255 - v] as number);
    const bright = autoThreshold('triangle', tail).level;
    const dark = autoThreshold('triangle', mirror).level;
    expect(bright).toBeGreaterThan(55);
    expect(bright).toBeLessThan(200);
    expect(dark).toBeLessThan(200);
    expect(dark).toBeGreaterThan(55);
    // The point farthest from the line goes with the peak's side in both cases.
    expect(Math.abs(dark - (254 - bright))).toBeLessThanOrEqual(1);
  });
});

describe('measurements', () => {
  /** Runs of the pixels whose centres lie in an ellipse rotated by `degrees` (counter-clockwise, y up). */
  const rotatedEllipse = (a: number, b: number, degrees: number) => {
    const t = (degrees * Math.PI) / 180;
    const out: number[] = [];
    for (let y = 0; y < 200; y++) {
      let start = -1;
      for (let x = 0; x <= 200; x++) {
        const dx = x + 0.5 - 100;
        const dy = -(y + 0.5 - 100);
        const u = dx * Math.cos(t) + dy * Math.sin(t);
        const v = -dx * Math.sin(t) + dy * Math.cos(t);
        const inside = x < 200 && (u / a) ** 2 + (v / b) ** 2 <= 1;
        if (inside && start < 0) start = x;
        if (!inside && start >= 0) {
          out.push(y, start, x);
          start = -1;
        }
      }
    }
    return normaliseRuns(out);
  };

  it('fits the ellipse of a drawn ellipse: axes, angle, and the same area', () => {
    const runs = ellipseRuns(100, 100, 40, 20, 200, 200);
    const fit = fitEllipse(runs);
    expect(fit.major).toBeCloseTo(80, 0);
    expect(fit.minor).toBeCloseTo(40, 0);
    expect(fit.angle).toBeCloseTo(0, 5);
    expect((Math.PI * fit.major * fit.minor) / 4).toBeCloseTo(runsArea(runs), 6);
    const tilted = fitEllipse(rotatedEllipse(50, 20, 30));
    expect(tilted.angle).toBeCloseTo(30, 0);
    expect(tilted.major / tilted.minor).toBeCloseTo(2.5, 1);
    expect(fitEllipse(rotatedEllipse(50, 20, 120)).angle).toBeCloseTo(120, 0);
  });

  it('reports grey statistics of the pixels inside', () => {
    const gray = Uint8Array.from([10, 20, 30, 40, 99, 99, 99, 99]);
    const stats = greyStats(Int32Array.from([0, 0, 4]), gray, 4);
    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(25);
    expect(stats.sd).toBeCloseTo(Math.sqrt(500 / 3), 10);
    // Median: the upper of the two middle values for an even count, as ImageJ reports it.
    expect([stats.min, stats.max, stats.median, stats.mode, stats.sum]).toEqual([
      10, 40, 30, 10, 100,
    ]);
    expect(stats.skewness).toBeCloseTo(0, 10);
    // Population moments: m2 = 125, m4 = 25 625, so m4 / m2² − 3 = −1.36.
    expect(stats.kurtosis).toBeCloseTo(-1.36, 10);
    expect(greyStats(new Int32Array(), gray, 4).mean).toBeNaN();
  });

  it('reads the grey levels along a line, interpolated between pixel centres', () => {
    const gray = Uint8Array.from({ length: 30 }, (_, i) => (i % 10) * 10);
    const profile = lineProfile(gray, 10, 3, { x: 0.5, y: 1.5 }, { x: 5.5, y: 1.5 });
    expect(Array.from(profile.distance)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(profile.value)).toEqual([0, 10, 20, 30, 40, 50]);
    const half = lineProfile(gray, 10, 3, { x: 1, y: 1.5 }, { x: 2, y: 1.5 });
    expect(Array.from(half.value)).toEqual([5, 15]);
  });

  it('gives the direction of the longest caliper and the convex area', () => {
    const rectangle = normaliseRuns([0, 0, 20, 1, 0, 20, 2, 0, 20, 3, 0, 20, 4, 0, 20]);
    const shape = shapeOf(rectangle);
    const diagonal = (Math.atan(5 / 20) * 180) / Math.PI;
    expect(Math.min(shape.feretAngle, 180 - shape.feretAngle)).toBeCloseTo(diagonal, 6);
    expect(shape.convexArea).toBeCloseTo(100, 6);
  });

  it('builds the chosen columns in original pixels', () => {
    const runs = ellipseRuns(50, 50, 20, 10, 100, 100);
    const particle = { id: 1, runs, source: 'auto' as const };
    const columns = measureColumns(['moments', 'area', 'ellipse'], {
      scale: 0.5,
      gray: null,
      nmPerPixel: null,
    });
    expect(columns.map((c) => c.header)).toEqual([
      'Area',
      'Major',
      'Minor',
      'Angle',
      'Skew',
      'Kurt',
    ]);
    expect(columns[0]?.value(particle)).toBe(runsArea(runs) * 4);
    expect(columns[1]?.value(particle)).toBeCloseTo(fitEllipse(runs).major * 2, 10);
  });
});
