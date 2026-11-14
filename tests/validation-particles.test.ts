// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { histogram } from '../src/core/particles/detect/threshold';
import {
  autoThreshold,
  type AutoThresholdMethod,
} from '../src/core/particles/detect/autoThreshold';
import { connectedComponents } from '../src/core/particles/detect/label';
import { labelsToRuns, shapeOf, type Shape } from '../src/core/particles/detect/regions';
import { fitEllipse, type EllipseFit } from '../src/core/particles/detect/measure';
import {
  cleanSizes,
  fitLognormal,
  fitNormal,
  histogram as sizeHistogram,
  percentile,
  summarise,
} from '../src/core/particles/distribution';
import { collectSizes } from '../src/modules/particles/sizes';
import { initialParticleData, type PoolEntry } from '../src/modules/particles/data';

/*
 * The Particles tool against programs that are not part of this site (docs/validation.md,
 * "Particles"). The test image and the references are written by
 * scripts/validation/particles/make_particles.py (scikit-image, SciPy, NumPy) and
 * scripts/validation/particles/ImageJCheck.java (ImageJ itself, run by the Validation workflow).
 */

const root = new URL('../', import.meta.url);
const file = (path: string) => new URL(`tests/fixtures/validation/${path}`, root);

function readPgm(path: string) {
  const bytes = readFileSync(file(path));
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0, 32).toString('latin1'));
  if (!header) throw new Error('not an 8-bit PGM');
  const width = Number(header[1]);
  const height = Number(header[2]);
  const gray = new Uint8Array(bytes.subarray(header[0].length, header[0].length + width * height));
  return { width, height, gray };
}

interface SkimageFixture {
  image: { ellipses: [number, number, number, number, number][] };
  thresholds: Record<string, number>;
  regionsLevel: number;
  regions: {
    area: number;
    cx: number;
    cy: number;
    eqDiameter: number;
    inertiaEigenvalues: [number, number];
  }[];
  sizes: {
    values: number[];
    percentiles: Record<string, number>;
    mean: number;
    sd: number;
    histogram: Record<'sturges' | 'fd', { bins: number; counts: number[]; binWidth: number }>;
    normal: { mean: number; sigma: number; logLikelihood: number };
    lognormal: { mu: number; sigma: number; logLikelihood: number };
  };
}

const skimage = JSON.parse(readFileSync(file('particles-skimage.json'), 'utf8')) as SkimageFixture;
const image = readPgm('particles.pgm');
const hist = histogram(image.gray, image.width);
const level = (method: AutoThresholdMethod) => autoThreshold(method, hist).level;

interface Particle {
  shape: Shape;
  ellipse: EllipseFit;
}

function particlesOf(gray: Uint8Array, width: number, height: number, above: number): Particle[] {
  const mask = gray.map((v) => (v > above ? 1 : 0));
  const { labels, count } = connectedComponents(mask, width, height);
  return labelsToRuns(labels, width, height, count).map((runs) => ({
    shape: shapeOf(runs),
    ellipse: fitEllipse(runs),
  }));
}

const particles = particlesOf(image.gray, image.width, image.height, skimage.regionsLevel);

/** The particle whose centroid is nearest (x, y). */
function nearest<T>(list: readonly T[], x: number, y: number, at: (item: T) => [number, number]) {
  let best = list[0] as T;
  let bestDistance = Infinity;
  for (const item of list) {
    const [ix, iy] = at(item);
    const d = Math.hypot(ix - x, iy - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = item;
    }
  }
  return { item: best, distance: bestDistance };
}

/** Difference of two directions in degrees, modulo 180, from 0 to 90. */
const angleDifference = (a: number, b: number) => {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

describe('automatic thresholds against scikit-image 0.26', () => {
  it('Otsu, IsoData (ImageJ Default), Minimum and Triangle give the same grey level', () => {
    expect(level('otsu')).toBe(skimage.thresholds.otsu);
    expect(level('default')).toBe(skimage.thresholds.isodata);
    expect(level('minimum')).toBe(skimage.thresholds.minimum);
    expect(level('triangle')).toBe(skimage.thresholds.triangle);
  });

  it('Li and Mean agree once ImageJ’s whole-level rounding is allowed for', () => {
    // scikit-image iterates Li on continuous values; ImageJ (and this site) rounds every step.
    expect(Math.abs(level('li') - (skimage.thresholds.li as number))).toBeLessThanOrEqual(1);
    // scikit-image returns the mean itself; ImageJ's Mean rounds it down.
    expect(level('mean')).toBe(Math.floor(skimage.thresholds.mean as number));
  });
});

describe('particle measurements against scikit-image regionprops', () => {
  it('finds the same 8-connected particles with the same pixel counts and centroids', () => {
    expect(particles.length).toBe(skimage.regions.length);
    for (const region of skimage.regions) {
      const { item, distance } = nearest(particles, region.cx, region.cy, (p) => [
        p.shape.cx,
        p.shape.cy,
      ]);
      expect(distance).toBeLessThan(1e-9);
      expect(item.shape.area).toBe(region.area);
      expect(item.shape.eqDiameter).toBeCloseTo(region.eqDiameter, 9);
    }
  });

  it('the ellipse comes from the same second moments (plus the 1/12 of a unit pixel)', () => {
    // scikit-image's inertia tensor is the covariance of the pixel centres. ImageJ's ellipse
    // (measure.ts) adds 1/12 for each pixel's own extent, takes A = 4√λ, and scales both axes so
    // that π·A·B/4 is the pixel count. That last step is done here from scikit-image's numbers.
    for (const region of skimage.regions) {
      const { item } = nearest(particles, region.cx, region.cy, (p) => [p.shape.cx, p.shape.cy]);
      const [l1, l2] = region.inertiaEigenvalues;
      const major = 4 * Math.sqrt(l1 + 1 / 12);
      const minor = 4 * Math.sqrt(l2 + 1 / 12);
      const scale = Math.sqrt((4 * region.area) / (Math.PI * major * minor));
      expect(item.ellipse.major).toBeCloseTo(major * scale, 9);
      expect(item.ellipse.minor).toBeCloseTo(minor * scale, 9);
    }
  });

  it('recovers the drawn ellipses: axes within 1.2 px, angle within 3°', () => {
    for (const [cx, cy, a, b, angle] of skimage.image.ellipses) {
      const { item, distance } = nearest(particles, cx, cy, (p) => [p.shape.cx, p.shape.cy]);
      expect(distance).toBeLessThan(0.5);
      expect(Math.abs(item.ellipse.major - a)).toBeLessThan(1.2);
      expect(Math.abs(item.ellipse.minor - b)).toBeLessThan(1.2);
      if (a - b >= 4) expect(angleDifference(item.ellipse.angle, angle)).toBeLessThan(3);
      // A caliper can never be shorter than the ellipse's own axis by more than a pixel step.
      expect(item.shape.feretMax).toBeGreaterThan(a - 1);
    }
  });
});

/** The image turned by `turn`, returned with its new width and height. */
function transform(kind: 'rotate90' | 'mirror' | 'flip' | 'double') {
  const { width: w, height: h, gray } = image;
  if (kind === 'double') {
    const out = new Uint8Array(4 * w * h);
    for (let y = 0; y < 2 * h; y++)
      for (let x = 0; x < 2 * w; x++)
        out[y * 2 * w + x] = gray[Math.floor(y / 2) * w + Math.floor(x / 2)] as number;
    return { gray: out, width: 2 * w, height: 2 * h };
  }
  if (kind === 'rotate90') {
    // Counter-clockwise on screen: new (x, y) = (y, w − 1 − x); new width h, height w.
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[(w - 1 - x) * h + y] = gray[y * w + x] as number;
    return { gray: out, width: h, height: w };
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const target = kind === 'mirror' ? y * w + (w - 1 - x) : (h - 1 - y) * w + x;
      out[target] = gray[y * w + x] as number;
    }
  return { gray: out, width: w, height: h };
}

describe('invariance of the measurements', () => {
  const sorted = (list: Particle[], key: (p: Particle) => number) =>
    list.map(key).sort((a, b) => a - b);

  for (const kind of ['rotate90', 'mirror', 'flip'] as const) {
    it(`a ${kind === 'rotate90' ? '90° turn' : kind === 'mirror' ? 'left-right mirror' : 'top-bottom flip'} changes no size`, () => {
      const t = transform(kind);
      const moved = particlesOf(t.gray, t.width, t.height, skimage.regionsLevel);
      expect(moved.length).toBe(particles.length);
      const keys: ((p: Particle) => number)[] = [
        (p) => p.shape.area,
        (p) => p.shape.feretMax,
        (p) => p.shape.feretMin,
        (p) => p.shape.perimeter,
        (p) => p.shape.convexArea,
        (p) => p.ellipse.major,
        (p) => p.ellipse.minor,
      ];
      for (const key of keys) {
        const before = sorted(particles, key);
        const after = sorted(moved, key);
        before.forEach((v, i) => expect(after[i]).toBeCloseTo(v, 9));
      }
    });
  }

  it('angles turn with the image: +90° for a turn, 180° − θ for a mirror', () => {
    const turned = transform('rotate90');
    const moved = particlesOf(turned.gray, turned.width, turned.height, skimage.regionsLevel);
    const mirrored = transform('mirror');
    const mirror = particlesOf(
      mirrored.gray,
      mirrored.width,
      mirrored.height,
      skimage.regionsLevel,
    );
    for (const p of particles) {
      if (p.ellipse.major - p.ellipse.minor < 2) continue;
      // Turned counter-clockwise: (x, y) → (y, w − 1 − x) in pixels, centre (cx, cy) → (cy, w − cx).
      const r = nearest(moved, p.shape.cy, image.width - p.shape.cx, (q) => [
        q.shape.cx,
        q.shape.cy,
      ]);
      expect(r.distance).toBeLessThan(1e-9);
      expect(angleDifference(r.item.ellipse.angle, p.ellipse.angle + 90)).toBeLessThan(1e-6);
      const m = nearest(mirror, image.width - p.shape.cx, p.shape.cy, (q) => [
        q.shape.cx,
        q.shape.cy,
      ]);
      expect(m.distance).toBeLessThan(1e-9);
      expect(angleDifference(m.item.ellipse.angle, 180 - p.ellipse.angle)).toBeLessThan(1e-6);
    }
  });

  it('an image enlarged ×2 doubles every length and quadruples every area', () => {
    const t = transform('double');
    const big = particlesOf(t.gray, t.width, t.height, skimage.regionsLevel);
    expect(big.length).toBe(particles.length);
    for (const p of particles) {
      const { item } = nearest(big, 2 * p.shape.cx, 2 * p.shape.cy, (q) => [
        q.shape.cx,
        q.shape.cy,
      ]);
      expect(item.shape.area).toBe(4 * p.shape.area);
      expect(item.shape.eqDiameter).toBeCloseTo(2 * p.shape.eqDiameter, 9);
      // The pixel-corner hull scales exactly. The 1/12 pixel term of the ellipse does not, so the
      // axes agree to 1 %. The perimeter cannot double exactly: enlarging turns every one-pixel
      // step of the outline into a two-pixel step, and the corner cutting removes the same
      // (1 − √2/2) per corner from both, so a 45° staircase reads (4 − 0.586) / (2 · 1.414) =
      // 1.207 times twice its first length. The ratio lies between 1 (straight edges) and that.
      expect(item.shape.feretMax).toBeCloseTo(2 * p.shape.feretMax, 9);
      expect(item.shape.feretMin).toBeCloseTo(2 * p.shape.feretMin, 9);
      const ratio = item.shape.perimeter / (2 * p.shape.perimeter);
      expect(ratio).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(ratio).toBeLessThan((4 - (2 - Math.SQRT2)) / (2 * (2 - (2 - Math.SQRT2))));
      expect(Math.abs(item.ellipse.major / (2 * p.ellipse.major) - 1)).toBeLessThan(0.01);
    }
  });
});

describe('size distribution against NumPy and SciPy', () => {
  const s = cleanSizes(skimage.sizes.values);
  const ref = skimage.sizes;

  it('percentiles (linear, NumPy default), mean and sample SD', () => {
    for (const [p, value] of Object.entries(ref.percentiles))
      expect(percentile(s, Number(p))).toBeCloseTo(value, 10);
    const summary = summarise(s);
    expect(summary?.mean).toBeCloseTo(ref.mean, 10);
    expect(summary?.sd).toBeCloseTo(ref.sd, 10);
  });

  it('Sturges and Freedman–Diaconis bins and counts (numpy.histogram_bin_edges)', () => {
    for (const [rule, method] of [
      ['sturges', 'sturges'],
      ['fd', 'freedman-diaconis'],
    ] as const) {
      const h = sizeHistogram(s, method);
      expect(h.counts.length).toBe(ref.histogram[rule].bins);
      expect(h.counts).toEqual(ref.histogram[rule].counts);
      expect(h.binWidth).toBeCloseTo(ref.histogram[rule].binWidth, 10);
    }
  });

  it('normal and lognormal maximum likelihood fits (scipy.stats norm.fit, lognorm.fit floc=0)', () => {
    const normal = fitNormal(s);
    expect(normal?.mean).toBeCloseTo(ref.normal.mean, 9);
    expect(normal?.sigma).toBeCloseTo(ref.normal.sigma, 9);
    expect(normal?.logLikelihood).toBeCloseTo(ref.normal.logLikelihood, 7);
    const lognormal = fitLognormal(s);
    expect(lognormal?.mu).toBeCloseTo(ref.lognormal.mu, 9);
    expect(lognormal?.sigma).toBeCloseTo(ref.lognormal.sigma, 9);
    expect(lognormal?.logLikelihood).toBeCloseTo(ref.lognormal.logLikelihood, 7);
  });

  it('pooled images give the distribution of all their particles, in any order', () => {
    const values = skimage.sizes.values;
    const entry = (id: string, list: number[]): PoolEntry => ({
      id,
      name: id,
      unit: 'nm',
      equalArea: list,
      longest: list,
      shortest: list,
    });
    const a = entry('a', values.slice(0, 120));
    const b = entry('b', values.slice(120));
    const pooled = (pool: PoolEntry[]) =>
      collectSizes({
        ...initialParticleData,
        pool,
        distribution: { ...initialParticleData.distribution, useCurrent: false },
      });
    const ab = pooled([a, b]);
    const ba = pooled([b, a]);
    expect(ab.values.length).toBe(values.length);
    expect(summarise(cleanSizes(ab.values))).toEqual(summarise(s));
    expect(summarise(cleanSizes(ba.values))).toEqual(summarise(s));
    expect(fitLognormal(cleanSizes(ba.values))?.sigma).toBeCloseTo(ref.lognormal.sigma, 12);
  });
});

/*
 * ImageJ itself. particles-imagej.json is written by ImageJCheck.java in the Validation workflow
 * (ImageJ cannot be run in the development container); until that file exists the comparison is
 * listed as open in docs/validation.md.
 */
const imagejFile = file('particles-imagej.json');
describe.runIf(existsSync(imagejFile))('against ImageJ (Analyze Particles, Auto Threshold)', () => {
  const imagej = existsSync(imagejFile)
    ? (JSON.parse(readFileSync(imagejFile, 'utf8')) as {
        source: string;
        thresholds: Record<string, number>;
        particles: Record<string, number>[];
      })
    : { source: '', thresholds: {}, particles: [] };

  it('every automatic threshold gives the grey level ImageJ gives', () => {
    const names: Record<string, AutoThresholdMethod> = {
      Default: 'default',
      Intermodes: 'intermodes',
      Li: 'li',
      MaxEntropy: 'maxentropy',
      Mean: 'mean',
      Minimum: 'minimum',
      Moments: 'moments',
      Otsu: 'otsu',
      Triangle: 'triangle',
    };
    for (const [name, method] of Object.entries(names))
      expect({ method, level: level(method) }).toEqual({ method, level: imagej.thresholds[name] });
  });

  it('area, centroid, ellipse and Feret diameters agree with ImageJ', () => {
    expect(imagej.particles.length).toBe(particles.length);
    for (const row of imagej.particles) {
      const { item, distance } = nearest(particles, row.X as number, row.Y as number, (p) => [
        p.shape.cx,
        p.shape.cy,
      ]);
      expect(distance).toBeLessThan(1e-6);
      expect(item.shape.area).toBe(row.Area);
      expect(item.ellipse.major).toBeCloseTo(row.Major as number, 3);
      expect(item.ellipse.minor).toBeCloseTo(row.Minor as number, 3);
      if ((row.Major as number) - (row.Minor as number) > 2)
        expect(angleDifference(item.ellipse.angle, row.Angle as number)).toBeLessThan(0.01);
      expect(item.shape.feretMax).toBeCloseTo(row.Feret as number, 3);
      expect(item.shape.feretMin).toBeCloseTo(row.MinFeret as number, 3);
    }
  });

  it('perimeter and circularity agree with ImageJ’s traced perimeter', () => {
    for (const row of imagej.particles) {
      const { item } = nearest(particles, row.X as number, row.Y as number, (p) => [
        p.shape.cx,
        p.shape.cy,
      ]);
      expect(item.shape.perimeter).toBeCloseTo(row['Perim.'] as number, 3);
    }
  });
});
