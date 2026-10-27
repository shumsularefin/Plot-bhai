// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gaussianBlur, medianFilter, rgbaToGray } from '../src/core/particles/detect/image';
import { connectedComponents } from '../src/core/particles/detect/label';
import {
  cutAlongSegment,
  ellipseRuns,
  segmentTouches,
  splitRunsByLine,
} from '../src/core/particles/detect/manual';
import {
  close,
  dilate,
  distanceTransform,
  erode,
  fillHoles,
  open,
} from '../src/core/particles/detect/morphology';
import {
  DEFAULT_DETECT_SETTINGS,
  detectParticles,
  type DetectSettings,
} from '../src/core/particles/detect/pipeline';
import {
  labelsToRuns,
  mergeRuns,
  normaliseRuns,
  outlineLoops,
  runsArea,
  runsBounds,
  runsContain,
  shapeOf,
  touchesEdge,
} from '../src/core/particles/detect/regions';
import {
  adaptiveThreshold,
  applyThreshold,
  histogram,
  otsuThreshold,
} from '../src/core/particles/detect/threshold';
import { estimateDiameter, splitClusters } from '../src/core/particles/detect/clusters';
import { splitTouching } from '../src/core/particles/detect/watershed';
import { seededNoise } from '../src/core/uvvis/synthetic';

interface Disc {
  x: number;
  y: number;
  d: number;
}

/** A grey image: background level, discs of the given level (pixel centres inside the radius) and optional noise. */
function discImage(
  width: number,
  height: number,
  discs: readonly Disc[],
  options: { background?: number; level?: number; noiseSd?: number; seed?: number } = {},
): Uint8Array {
  const { background = 40, level = 190, noiseSd = 0, seed = 1 } = options;
  const noise = noiseSd > 0 ? seededNoise(seed, noiseSd) : () => 0;
  const image = new Uint8Array(width * height);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (let i = 0; i < image.length; i++) image[i] = clamp(background + noise());
  for (const c of discs) {
    const r = c.d / 2;
    for (
      let y = Math.max(0, Math.floor(c.y - r));
      y <= Math.min(height - 1, Math.ceil(c.y + r));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(c.x - r));
        x <= Math.min(width - 1, Math.ceil(c.x + r));
        x++
      ) {
        if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= r)
          image[y * width + x] = clamp(level + noise());
      }
    }
  }
  return image;
}

/** The mask of the same discs, 1 inside. */
const discMask = (width: number, height: number, discs: readonly Disc[]) =>
  discImage(width, height, discs, { background: 0, level: 1 });

describe('image helpers', () => {
  it('converts colour to grey with the BT.601 weights', () => {
    const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
    expect(Array.from(rgbaToGray(rgba, 4))).toEqual([76, 150, 29, 255]);
  });

  it('leaves a flat image flat, conserves brightness and spreads a point symmetrically', () => {
    const flat = new Uint8Array(100).fill(90);
    expect(Array.from(gaussianBlur(flat, 10, 10, 1.5))).toEqual(Array.from(flat));
    const block = new Uint8Array(41 * 41);
    for (let y = 16; y < 25; y++) for (let x = 16; x < 25; x++) block[y * 41 + x] = 200;
    const blurred = gaussianBlur(block, 41, 41, 2);
    const total = blurred.reduce((s, v) => s + v, 0);
    expect(Math.abs(total - 200 * 81) / (200 * 81)).toBeLessThan(0.01);
    expect(blurred[20 * 41 + 13]).toBe(blurred[20 * 41 + 27]);
    expect(blurred[13 * 41 + 20]).toBe(blurred[27 * 41 + 20]);
    expect(Array.from(gaussianBlur(block, 41, 41, 0))).toEqual(Array.from(block));
  });

  it('median filter removes a lone bright pixel and keeps a step edge where it is', () => {
    const img = new Uint8Array(15 * 15).fill(20);
    img[7 * 15 + 7] = 255;
    expect(medianFilter(img, 15, 15, 1)[7 * 15 + 7]).toBe(20);
    const step = Uint8Array.from({ length: 15 * 15 }, (_, i) => (i % 15 < 7 ? 20 : 200));
    const out = medianFilter(step, 15, 15, 2);
    expect(Array.from(out.slice(5 * 15, 6 * 15))).toEqual(Array.from(step.slice(5 * 15, 6 * 15)));
  });
});

describe('thresholds', () => {
  it('Otsu falls between two well separated grey levels', () => {
    const hist = new Int32Array(256);
    hist[50] = 700;
    hist[200] = 300;
    const t = otsuThreshold(hist);
    expect(t).toBeGreaterThanOrEqual(50);
    expect(t).toBeLessThan(200);
    // Spread-out classes: the threshold lands between the two means.
    const img = discImage(200, 200, [{ x: 100, y: 100, d: 90 }], { noiseSd: 12, seed: 3 });
    const level = otsuThreshold(histogram(img, 200));
    expect(level).toBeGreaterThan(80);
    expect(level).toBeLessThan(150);
  });

  it('takes the histogram of the analysis area only, so a dark data bar does not move the threshold', () => {
    const width = 200;
    const height = 200;
    const img = discImage(width, height, [{ x: 100, y: 60, d: 50 }], {
      background: 90,
      level: 180,
    });
    for (let y = 140; y < 200; y++) for (let x = 0; x < width; x++) img[y * width + x] = 0;
    const whole = otsuThreshold(histogram(img, width));
    const cropped = otsuThreshold(histogram(img, width, { x: 0, y: 0, width, height: 140 }));
    expect(cropped).toBeGreaterThanOrEqual(90);
    expect(cropped).toBeLessThan(180);
    expect(whole).toBeLessThan(cropped);
  });

  it('adaptive threshold finds discs on a sloping background where one global level fails', () => {
    const width = 240;
    const height = 120;
    const base = Uint8Array.from(
      { length: width * height },
      (_, i) => 40 + Math.round(((i % width) / width) * 120),
    );
    const discs = [
      { x: 40, y: 60, d: 30 },
      { x: 200, y: 60, d: 30 },
    ];
    const img = base.map((v, i) => {
      const x = i % width;
      const y = (i - x) / width;
      return discs.some((c) => Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= c.d / 2)
        ? Math.min(255, v + 45)
        : v;
    });
    const local = adaptiveThreshold(img, width, height, 25, 10);
    expect(local[60 * width + 40]).toBe(1);
    expect(local[60 * width + 200]).toBe(1);
    expect(local[60 * width + 120]).toBe(0);
    const global = applyThreshold(img, otsuThreshold(histogram(img, width)));
    expect(
      global[60 * width + 40] === 1 &&
        global[60 * width + 200] === 1 &&
        global[10 * width + 230] === 0,
    ).toBe(false);
  });
});

describe('morphology', () => {
  it('distance transform gives the exact distance to the nearest background pixel', () => {
    const row = Uint8Array.from([0, 1, 1, 1, 1, 1, 0]);
    expect(Array.from(distanceTransform(row, 7, 1))).toEqual([0, 1, 2, 3, 2, 1, 0]);
    // Against brute force on a small random mask.
    const w = 12;
    const h = 9;
    const random = seededNoise(5, 1);
    const mask = Uint8Array.from({ length: w * h }, () => (random() > -0.3 ? 1 : 0));
    const dt = distanceTransform(mask, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) {
          expect(dt[y * w + x]).toBe(0);
          continue;
        }
        let best = Infinity;
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++)
            if (!mask[yy * w + xx]) best = Math.min(best, Math.hypot(xx - x, yy - y));
        if (Number.isFinite(best)) expect(dt[y * w + x]).toBeCloseTo(best, 4);
      }
    }
  });

  it('the distance at the centre of a disc is its radius', () => {
    const mask = discMask(101, 101, [{ x: 50.5, y: 50.5, d: 60 }]);
    expect(distanceTransform(mask, 101, 101)[50 * 101 + 50]).toBeGreaterThan(29);
    expect(distanceTransform(mask, 101, 101)[50 * 101 + 50]).toBeLessThan(31);
  });

  it('opening removes specks, closing fills small gaps, and both keep a large disc about the same size', () => {
    const disc = discMask(80, 80, [{ x: 40, y: 40, d: 40 }]);
    const speck = disc.slice();
    speck[5 * 80 + 5] = 1;
    const opened = open(speck, 80, 80, 1);
    expect(opened[5 * 80 + 5]).toBe(0);
    const comps = connectedComponents(opened, 80, 80);
    expect(comps.count).toBe(1);
    const kept = runsArea(
      labelsToRuns(comps.labels, 80, 80, comps.count)[0] ?? Int32Array.from([]),
    );
    expect(Math.abs(kept - disc.reduce((s, v) => s + v, 0))).toBeLessThan(20);
    const gap = disc.slice();
    gap[40 * 80 + 40] = 0;
    expect(close(gap, 80, 80, 1)[40 * 80 + 40]).toBe(1);
    const grown = dilate(disc, 80, 80, 2).reduce((s, v) => s + v, 0);
    const shrunk = erode(disc, 80, 80, 2).reduce((s, v) => s + v, 0);
    const original = disc.reduce((s, v) => s + v, 0);
    expect(grown).toBeGreaterThan(original);
    expect(shrunk).toBeLessThan(original);
  });

  it('fills a closed hole but not a gap that leaks to the outside', () => {
    const ring = new Uint8Array(11 * 11);
    for (let i = 2; i <= 8; i++) {
      ring[2 * 11 + i] = 1;
      ring[8 * 11 + i] = 1;
      ring[i * 11 + 2] = 1;
      ring[i * 11 + 8] = 1;
    }
    expect(fillHoles(ring, 11, 11)[5 * 11 + 5]).toBe(1);
    const open4 = ring.slice();
    open4[2 * 11 + 5] = 0;
    expect(fillHoles(open4, 11, 11)[5 * 11 + 5]).toBe(0);
  });
});

describe('labelling and splitting', () => {
  it('counts separate blobs and joins pixels that only touch at a corner', () => {
    const w = 10;
    const mask = new Uint8Array(w * 6);
    mask[1 * w + 1] = 1;
    mask[2 * w + 2] = 1; // diagonal neighbour: same blob
    mask[4 * w + 7] = 1;
    expect(connectedComponents(mask, w, 6).count).toBe(2);
  });

  it('separates two overlapping discs, keeps one disc and one rod whole, and merges a deep overlap', () => {
    const size = [160, 100] as const;
    const split = (discs: Disc[], neck = 0.7) =>
      splitTouching(discMask(size[0], size[1], discs), size[0], size[1], neck).count;
    expect(
      split([
        { x: 50, y: 50, d: 40 },
        { x: 88, y: 50, d: 40 },
      ]),
    ).toBe(2); // overlap of 2 px
    expect(split([{ x: 60, y: 50, d: 60 }])).toBe(1);
    expect(
      split([
        { x: 60, y: 50, d: 40 },
        { x: 70, y: 50, d: 40 },
      ]),
    ).toBe(1); // centres a quarter diameter apart
    const rod = new Uint8Array(size[0] * size[1]);
    for (let y = 40; y < 60; y++) for (let x = 20; x < 130; x++) rod[y * size[0] + x] = 1;
    expect(splitTouching(rod, size[0], size[1], 0.7).count).toBe(1);
  });

  it('a lower neck fraction splits more', () => {
    const discs: Disc[] = [
      { x: 50, y: 50, d: 40 },
      { x: 78, y: 50, d: 40 },
    ]; // moderate overlap
    const mask = discMask(130, 100, discs);
    expect(splitTouching(mask, 130, 100, 0.95).count).toBe(2);
    expect(splitTouching(mask, 130, 100, 0.2).count).toBe(1);
  });
});

describe('particle runs and shape', () => {
  it('keeps every pixel, finds bounds, joins touching runs, and tests membership and edge contact', () => {
    const w = 12;
    const mask = discMask(w, 12, [{ x: 6, y: 6, d: 8 }]);
    const { labels, count } = connectedComponents(mask, w, 12);
    const [runs] = labelsToRuns(labels, w, 12, count);
    expect(runs).toBeDefined();
    expect(runsArea(runs as Int32Array)).toBe(mask.reduce((s, v) => s + v, 0));
    expect(runsContain(runs as Int32Array, 6, 6)).toBe(true);
    expect(runsContain(runs as Int32Array, 0, 0)).toBe(false);
    const b = runsBounds(runs as Int32Array);
    expect(b.x1 - b.x0).toBeLessThanOrEqual(9);
    expect(Array.from(normaliseRuns([0, 5, 8, 0, 1, 5, 1, 0, 2]))).toEqual([0, 1, 8, 1, 0, 2]);
    expect(Array.from(mergeRuns(Int32Array.from([0, 0, 2]), Int32Array.from([0, 2, 4])))).toEqual([
      0, 0, 4,
    ]);
    expect(touchesEdge(runs as Int32Array, { x: 0, y: 0, width: 12, height: 12 })).toBe(false);
    expect(touchesEdge(Int32Array.from([0, 0, 3]), { x: 0, y: 0, width: 12, height: 12 })).toBe(
      true,
    );
    expect(touchesEdge(runs as Int32Array, { x: 2, y: 2, width: 8, height: 8 })).toBe(true);
  });

  it('traces a rectangle as four corners, joins diagonal pixels, and reports holes as extra loops', () => {
    expect(outlineLoops(Int32Array.from([0, 0, 3, 1, 0, 3]))).toHaveLength(1);
    expect(outlineLoops(Int32Array.from([0, 0, 3, 1, 0, 3]))[0]).toHaveLength(4);
    expect(outlineLoops(Int32Array.from([0, 0, 1, 1, 1, 2]))).toHaveLength(1);
    const ring = Int32Array.from([0, 0, 3, 1, 0, 1, 1, 2, 3, 2, 0, 3]);
    expect(outlineLoops(ring)).toHaveLength(2);
  });

  it('measures a square: area, Feret diameters and circularity near the perimeter-corrected value', () => {
    const square = Int32Array.from(Array.from({ length: 10 }, (_, y) => [y, 0, 10]).flat());
    const s = shapeOf(square);
    expect(s.area).toBe(100);
    expect(s.cx).toBe(5);
    expect(s.cy).toBe(5);
    expect(s.feretMax).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(s.feretMin).toBeCloseTo(10, 9);
    expect(s.aspect).toBeCloseTo(Math.SQRT2, 9);
    // Perimeter 40 − 4 (1 − √2/2); a true square has circularity π/4 = 0.785, this estimate is a little high.
    expect(s.perimeter).toBeCloseTo(40 - 4 * (1 - Math.SQRT1_2), 9);
    expect(s.circularity).toBeGreaterThan(0.78);
    expect(s.circularity).toBeLessThan(0.87);
  });

  it('a digital disc has the right area, Feret diameters and a circularity close to 1', () => {
    for (const d of [20, 40, 80]) {
      const runs = ellipseRuns(d, d, d / 2, d / 2, 2 * d, 2 * d);
      const s = shapeOf(runs);
      expect(Math.abs(s.eqDiameter - d) / d).toBeLessThan(0.02);
      expect(Math.abs(s.feretMax - d)).toBeLessThan(1.6);
      expect(Math.abs(s.feretMin - d)).toBeLessThan(1.6);
      // A circle drawn in pixels reads about 0.9 (see Shape.circularity).
      expect(s.circularity).toBeGreaterThan(0.85);
      expect(s.circularity).toBeLessThanOrEqual(1);
    }
  });

  it('an ellipse box gives the two axes, an aspect ratio and a lower circularity', () => {
    const s = shapeOf(ellipseRuns(60, 40, 40, 20, 120, 80));
    expect(Math.abs(s.feretMax - 80)).toBeLessThan(2);
    expect(Math.abs(s.feretMin - 40)).toBeLessThan(2);
    expect(Math.abs(s.aspect - 2)).toBeLessThan(0.1);
    expect(s.circularity).toBeLessThan(0.85);
  });
});

describe('manual edits', () => {
  it('draws a circle of the chosen diameter and clips it to the image', () => {
    const runs = ellipseRuns(50, 50, 15, 15, 100, 100);
    expect(Math.abs(runsArea(runs) - Math.PI * 225) / (Math.PI * 225)).toBeLessThan(0.02);
    const clipped = ellipseRuns(5, 5, 15, 15, 100, 100);
    expect(runsBounds(clipped).x0).toBe(0);
    expect(runsArea(clipped)).toBeLessThan(Math.PI * 225);
  });

  it('cuts a disc in two along a line through its centre, and refuses a line that misses it', () => {
    const disc = ellipseRuns(50, 50, 20, 20, 100, 100);
    const halves = splitRunsByLine(disc, { x: 50, y: 0 }, { x: 50, y: 100 });
    expect(halves).not.toBeNull();
    if (!halves) return;
    const [a, b] = halves;
    expect(runsArea(a) + runsArea(b)).toBe(runsArea(disc));
    expect(Math.abs(runsArea(a) - runsArea(b)) / runsArea(disc)).toBeLessThan(0.03);
    expect(splitRunsByLine(disc, { x: 90, y: 0 }, { x: 90, y: 100 })).toBeNull();
  });
});

/** Matches detected particles to the true discs by nearest centre. */
function match(particles: readonly Int32Array[], truth: readonly Disc[]) {
  const shapes = particles.map(shapeOf);
  return truth.map((disc) => {
    const best = shapes.reduce((a, b) =>
      Math.hypot(b.cx - disc.x, b.cy - disc.y) < Math.hypot(a.cx - disc.x, a.cy - disc.y) ? b : a,
    );
    return { disc, shape: best, relative: Math.abs(best.eqDiameter - disc.d) / disc.d };
  });
}

describe('detectParticles on synthetic images with known diameters', () => {
  const width = 420;
  const height = 300;
  const separate: Disc[] = [
    { x: 60, y: 60, d: 30 },
    { x: 160, y: 70, d: 40 },
    { x: 270, y: 60, d: 50 },
    { x: 370, y: 80, d: 36 },
    { x: 70, y: 190, d: 60 },
    { x: 200, y: 200, d: 44 },
    { x: 320, y: 220, d: 56 },
  ];

  it('finds every separate disc and its diameter within 3 %, with noise', () => {
    const image = discImage(width, height, separate, { noiseSd: 10, seed: 11 });
    const { particles } = detectParticles(image, width, height, DEFAULT_DETECT_SETTINGS);
    expect(particles).toHaveLength(separate.length);
    for (const m of match(particles, separate))
      expect(m.relative, `disc d=${m.disc.d}`).toBeLessThan(0.03);
  });

  it('returns the true size in nm through a calibration of 2 pixels per nm', () => {
    const image = discImage(width, height, separate);
    const { particles } = detectParticles(image, width, height, DEFAULT_DETECT_SETTINGS);
    const nm = match(particles, separate).map((m) => m.shape.eqDiameter / 2);
    separate.forEach((disc, i) =>
      expect(Math.abs((nm[i] as number) - disc.d / 2) / (disc.d / 2)).toBeLessThan(0.03),
    );
  });

  it('separates a touching pair of equal discs and measures both, but gives one blob without splitting', () => {
    const pair: Disc[] = [
      { x: 100, y: 100, d: 60 },
      { x: 156, y: 100, d: 60 },
    ]; // 4 px overlap
    const image = discImage(260, 200, pair, { noiseSd: 8, seed: 4 });
    const split = detectParticles(image, 260, 200, DEFAULT_DETECT_SETTINGS);
    expect(split.particles).toHaveLength(2);
    for (const m of match(split.particles, pair)) expect(m.relative).toBeLessThan(0.05);
    const noSplit = detectParticles(image, 260, 200, {
      ...DEFAULT_DETECT_SETTINGS,
      split: { ...DEFAULT_DETECT_SETTINGS.split, enabled: false },
    });
    expect(noSplit.particles).toHaveLength(1);
  });

  it('separates a touching pair of unequal discs', () => {
    const pair: Disc[] = [
      { x: 90, y: 100, d: 70 },
      { x: 150, y: 100, d: 36 },
    ];
    const image = discImage(240, 200, pair);
    const result = detectParticles(image, 240, 200, DEFAULT_DETECT_SETTINGS);
    expect(result.particles).toHaveLength(2);
    for (const m of match(result.particles, pair)) expect(m.relative).toBeLessThan(0.06);
  });

  it('finds dark particles on a bright background when invert is on', () => {
    const image = discImage(width, height, separate, {
      background: 200,
      level: 60,
      noiseSd: 6,
      seed: 2,
    });
    const settings: DetectSettings = { ...DEFAULT_DETECT_SETTINGS, invert: true };
    expect(detectParticles(image, width, height, settings).particles).toHaveLength(separate.length);
    expect(
      detectParticles(image, width, height, DEFAULT_DETECT_SETTINGS).particles.length,
    ).not.toBe(separate.length);
  });

  it('stays inside the crop area and ignores a dark data bar', () => {
    const bar = discImage(width, height, separate, { background: 90, level: 180 });
    for (let y = 250; y < height; y++) for (let x = 0; x < width; x++) bar[y * width + x] = 0;
    const crop = { x: 0, y: 0, width, height: 250 };
    const inside = separate.filter((d) => d.y + d.d / 2 < 250);
    const result = detectParticles(bar, width, height, DEFAULT_DETECT_SETTINGS, crop);
    expect(result.particles).toHaveLength(inside.length);
    expect(result.threshold).toBeGreaterThanOrEqual(90);
    for (const runs of result.particles) expect(runsBounds(runs).y1).toBeLessThanOrEqual(250);
  });

  it('flags particles cut by the image edge so they can be excluded', () => {
    const discs: Disc[] = [
      { x: 100, y: 100, d: 40 },
      { x: 5, y: 100, d: 40 },
    ];
    const image = discImage(200, 200, discs);
    const { particles } = detectParticles(image, 200, 200, DEFAULT_DETECT_SETTINGS);
    expect(particles).toHaveLength(2);
    const flags = particles.map((p) => touchesEdge(p, { x: 0, y: 0, width: 200, height: 200 }));
    expect(flags.filter(Boolean)).toHaveLength(1);
  });

  it('works with a manual threshold, an adaptive threshold and a median filter', () => {
    const image = discImage(width, height, separate, { noiseSd: 8, seed: 5 });
    const manual: DetectSettings = {
      ...DEFAULT_DETECT_SETTINGS,
      threshold: { ...DEFAULT_DETECT_SETTINGS.threshold, method: 'manual', manual: 115 },
    };
    expect(detectParticles(image, width, height, manual).particles).toHaveLength(separate.length);
    const adaptive: DetectSettings = {
      ...DEFAULT_DETECT_SETTINGS,
      threshold: {
        ...DEFAULT_DETECT_SETTINGS.threshold,
        method: 'adaptive',
        adaptiveRadius: 60,
        adaptiveOffset: 30,
      },
    };
    expect(detectParticles(image, width, height, adaptive).particles).toHaveLength(separate.length);
    const median: DetectSettings = {
      ...DEFAULT_DETECT_SETTINGS,
      denoise: { method: 'median', size: 1 },
    };
    expect(detectParticles(image, width, height, median).particles).toHaveLength(separate.length);
  });

  it('on a half-size working copy the diameters mapped back to full size are within 3 %', () => {
    const fullW = 840;
    const fullH = 600;
    const big = separate.map((d) => ({ x: d.x * 2, y: d.y * 2, d: d.d * 2 }));
    const full = discImage(fullW, fullH, big, { noiseSd: 6, seed: 8 });
    const scale = 0.5;
    const small = new Uint8Array((fullW / 2) * (fullH / 2));
    for (let y = 0; y < fullH / 2; y++) {
      for (let x = 0; x < fullW / 2; x++) {
        const s =
          (full[2 * y * fullW + 2 * x] as number) +
          (full[2 * y * fullW + 2 * x + 1] as number) +
          (full[(2 * y + 1) * fullW + 2 * x] as number) +
          (full[(2 * y + 1) * fullW + 2 * x + 1] as number);
        small[y * (fullW / 2) + x] = Math.round(s / 4);
      }
    }
    const { particles } = detectParticles(small, fullW / 2, fullH / 2, DEFAULT_DETECT_SETTINGS);
    expect(particles).toHaveLength(big.length);
    for (const d of big) {
      const nearest = particles
        .map(shapeOf)
        .reduce((a, b) =>
          Math.hypot(b.cx / scale - d.x, b.cy / scale - d.y) <
          Math.hypot(a.cx / scale - d.x, a.cy / scale - d.y)
            ? b
            : a,
        );
      expect(Math.abs(nearest.eqDiameter / scale - d.d) / d.d).toBeLessThan(0.03);
    }
  });
});

describe('speed', () => {
  it('detects on a 4 megapixel image in a few seconds', { timeout: 120_000 }, () => {
    const w = 2048;
    const h = 2048;
    const discs: Disc[] = [];
    for (let gy = 0; gy < 12; gy++)
      for (let gx = 0; gx < 12; gx++)
        discs.push({ x: 100 + gx * 160, y: 100 + gy * 160, d: 60 + ((gx * 7 + gy * 3) % 30) });
    const image = discImage(w, h, discs, { noiseSd: 8, seed: 9 });
    const t0 = performance.now();
    const { particles } = detectParticles(image, w, h, DEFAULT_DETECT_SETTINGS);
    const seconds = (performance.now() - t0) / 1000;
    expect(particles).toHaveLength(discs.length);
    console.log(`4 MP detection of ${discs.length} particles took ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(30);
  });
});

describe('cutting particles along a drawn segment', () => {
  it('cuts a particle the segment crosses and leaves others alone', () => {
    const a = { id: 1, runs: ellipseRuns(40, 40, 20, 20, 200, 100) };
    const b = { id: 2, runs: ellipseRuns(150, 40, 20, 20, 200, 100) };
    const cuts = cutAlongSegment([a, b], { x: 40, y: 10 }, { x: 40, y: 70 });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.id).toBe(1);
    const [p, q] = cuts[0]?.pieces ?? [Int32Array.from([]), Int32Array.from([])];
    expect(runsArea(p) + runsArea(q)).toBe(runsArea(a.runs));
  });

  it('does nothing when the segment misses every particle', () => {
    const a = { id: 1, runs: ellipseRuns(40, 40, 20, 20, 200, 100) };
    expect(cutAlongSegment([a], { x: 120, y: 0 }, { x: 120, y: 90 })).toEqual([]);
    expect(segmentTouches(a.runs, { x: 40, y: 10 }, { x: 40, y: 70 })).toBe(true);
  });

  it('separates a merged touching pair by a cut across the neck', () => {
    const pair = mergeRuns(
      ellipseRuns(40, 40, 20, 20, 200, 100),
      ellipseRuns(78, 40, 20, 20, 200, 100),
    );
    const cuts = cutAlongSegment([{ id: 1, runs: pair }], { x: 59, y: 15 }, { x: 59, y: 65 });
    expect(cuts).toHaveLength(1);
    const [left, right] = cuts[0]?.pieces ?? [Int32Array.from([]), Int32Array.from([])];
    expect(Math.abs(shapeOf(left).eqDiameter - 40) / 40).toBeLessThan(0.1);
    expect(Math.abs(shapeOf(right).eqDiameter - 40) / 40).toBeLessThan(0.1);
  });
});

/**
 * A transmission-like image of a clump, particles bright: every disc adds its projected
 * thickness, k · √(r² − ρ²) / r grey levels, to the background, as overlapping spheres do.
 */
function sphereImage(width: number, height: number, discs: readonly Disc[], k = 120): Uint8Array {
  const image = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 30;
      for (const c of discs) {
        const r = c.d / 2;
        const rho2 = (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2;
        if (rho2 <= r * r) v += (k * Math.sqrt(r * r - rho2)) / r;
      }
      image[y * width + x] = Math.min(255, Math.round(v));
    }
  }
  return image;
}

/** The label under each disc centre. */
const labelsAt = (labels: Int32Array, width: number, discs: readonly Disc[]) =>
  discs.map((c) => labels[Math.floor(c.y) * width + Math.floor(c.x)] as number);

describe('separating clumps', () => {
  // Six spheres of 40 px on a 2 × 3 grid, 28 px apart: they overlap by 12 px, so the necks are
  // as wide as the particles and no neck can be seen in the outline.
  const clump: Disc[] = [0, 1, 2].flatMap((col) =>
    [0, 1].map((row) => ({ x: 60 + 28 * col, y: 60 + 28 * row, d: 40 })),
  );
  const width = 180;
  const height = 150;

  it('estimates the typical diameter from separate particles, and returns null for an empty mask', () => {
    const image = discImage(300, 200, [
      { x: 60, y: 60, d: 40 },
      { x: 160, y: 60, d: 40 },
      { x: 100, y: 140, d: 40 },
    ]);
    const d = estimateDiameter(applyThreshold(image, 100), 300, 200) as number;
    expect(Math.abs(d - 40) / 40).toBeLessThan(0.1);
    expect(estimateDiameter(new Uint8Array(100), 10, 10)).toBeNull();
  });

  it('finds the six spheres of a clump from their visible arcs, where the neck watershed finds one', () => {
    const image = sphereImage(width, height, clump);
    const mask = applyThreshold(image, 50);
    expect(splitTouching(mask, width, height, 0.7).count).toBe(1);
    const { labels, count } = splitClusters(mask, image, width, height, 40, 0.05);
    expect(count).toBe(6);
    expect(new Set(labelsAt(labels, width, clump)).size).toBe(6);
  });

  it('through the pipeline with a typical diameter, and reports the diameter used', () => {
    const image = sphereImage(width, height, clump);
    const split = { ...DEFAULT_DETECT_SETTINGS.split, method: 'clumps' as const };
    const set = detectParticles(image, width, height, {
      ...DEFAULT_DETECT_SETTINGS,
      split: { ...split, diameter: 40 },
    });
    expect(set.particles).toHaveLength(6);
    expect(set.diameter).toBe(40);
    // Estimated from a clump alone, the diameter comes out too large (the documented
    // limitation), so fewer particles are found: a line drawn across one particle is better.
    const estimated = detectParticles(image, width, height, { ...DEFAULT_DETECT_SETTINGS, split });
    expect(estimated.diameter).toBeGreaterThan(40);
    expect(estimated.particles.length).toBeLessThan(6);
    expect(detectParticles(image, width, height, DEFAULT_DETECT_SETTINGS).diameter).toBeNull();
  });

  it('keeps one particle whole, and a needed outline share above what is visible finds none', () => {
    const one: Disc[] = [{ x: 60, y: 60, d: 50 }];
    const image = sphereImage(120, 120, one);
    const mask = applyThreshold(image, 50);
    expect(splitClusters(mask, image, 120, 120, 50, 0.05).count).toBe(1);
    // With no centre accepted, the blob is still kept as one particle.
    expect(splitClusters(mask, image, 120, 120, 50, 5).count).toBe(1);
  });

  it('splits a row of flat, overlapping discs (as in SEM) from the outer arcs alone', () => {
    const row: Disc[] = [
      { x: 40, y: 50, d: 40 },
      { x: 70, y: 50, d: 40 },
      { x: 100, y: 50, d: 40 },
    ];
    const image = discImage(150, 100, row);
    const mask = applyThreshold(image, 100);
    const { labels, count } = splitClusters(mask, image, 150, 100, 40, 0.05);
    expect(count).toBe(3);
    expect(new Set(labelsAt(labels, 150, row)).size).toBe(3);
  });
});
