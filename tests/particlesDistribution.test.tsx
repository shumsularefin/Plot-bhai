import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ellipseRuns } from '../src/core/particles/detect/manual';
import { particleMethodsParagraph } from '../src/core/particles/methods';
import { fitLognormal, fitNormal, cleanSizes } from '../src/core/particles/distribution';
import { DEFAULT_DETECT_SETTINGS } from '../src/core/particles/detect/pipeline';
import {
  DEFAULT_DISTRIBUTION,
  DEFAULT_STEREOLOGY,
  initialParticleData,
  migrateParticleData,
  type ImageInfo,
  type Particle,
  type ParticleData,
  type PoolEntry,
} from '../src/modules/particles/data';
import { DistributionStep } from '../src/modules/particles/DistributionStep';
import { collectSizes, imageSizes } from '../src/modules/particles/sizes';
import { stereologyOf } from '../src/modules/particles/stereology';

const image: ImageInfo = {
  id: 'img',
  name: 'sample-a.png',
  width: 1000,
  height: 800,
  format: 'png',
  synthetic: false,
  notes: [],
};

vi.mock('../src/modules/particles/useImage', () => ({
  useImage: () => ({ status: 'none' }),
  cacheImage: () => {},
  clearImageCache: () => {},
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Discs of the given diameters in pixels, side by side on a 1000 × 800 image. */
function discs(diameters: number[]): Particle[] {
  return diameters.map((d, i) => ({
    id: i + 1,
    source: 'auto',
    runs: ellipseRuns(60 + 90 * (i % 10), 60 + 90 * Math.floor(i / 10), d / 2, d / 2, 1000, 800),
  }));
}

// 2 px per nm: 100 px stand for 50 nm.
const scaled = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, length: 50, unit: 'nm' as const };

const withParticles = (diameters: number[], patch: Partial<ParticleData> = {}): ParticleData => ({
  ...initialParticleData,
  image,
  scale: scaled,
  detect: { ...initialParticleData.detect, particles: discs(diameters), nextParticleId: 99 },
  ...patch,
});

const entry = (name: string, unit: 'nm' | 'px', values: number[]): PoolEntry => ({
  id: name,
  name,
  unit,
  equalArea: values,
  longest: values,
  shortest: values,
});

describe('sizes of the image on screen', () => {
  it('converts equal-area diameters from pixels to nm with the scale', () => {
    const sizes = imageSizes(withParticles([40, 60, 80]), false);
    expect(sizes.unit).toBe('nm');
    expect(sizes.equalArea).toHaveLength(3);
    // 2 px per nm: a disc of 60 px is 30 nm; digital discs are within 2 %.
    expect(Math.abs((sizes.equalArea[1] as number) - 30) / 30).toBeLessThan(0.02);
    expect(sizes.hand).toBe(0);
  });

  it('works in pixels without a scale, and adds hand measurements on request', () => {
    const data = withParticles([40], {
      scale: null,
      measurements: [{ id: 1, kind: 'circle', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }],
    });
    const without = imageSizes(data, false);
    expect(without.unit).toBe('px');
    expect(without.equalArea).toHaveLength(1);
    const withHand = imageSizes(data, true);
    expect(withHand.hand).toBe(1);
    expect(withHand.equalArea[1]).toBe(30);
  });
});

describe('pooling', () => {
  it('combines the image on screen with saved images of the same unit', () => {
    const data = withParticles([60, 60], {
      pool: [entry('b.png', 'nm', [10, 20, 30])],
    });
    const collected = collectSizes(data);
    expect(collected.values).toHaveLength(5);
    expect(collected.sources.map((s) => [s.name, s.count])).toEqual([
      ['sample-a.png', 2],
      ['b.png', 3],
    ]);
    expect(collected.skipped).toHaveLength(0);
  });

  it('leaves out saved images whose unit differs and says so', () => {
    const data = withParticles([60], {
      pool: [entry('px-image.png', 'px', [10, 20])],
    });
    const collected = collectSizes(data);
    expect(collected.unit).toBe('nm');
    expect(collected.values).toHaveLength(1);
    expect(collected.skipped.map((p) => p.name)).toEqual(['px-image.png']);
  });

  it('does not count the image on screen twice after it was saved', () => {
    const data = withParticles([60, 60], { pool: [entry('sample-a.png', 'nm', [30, 30])] });
    expect(collectSizes(data).values).toHaveLength(2);
    const off = { ...data, distribution: { ...DEFAULT_DISTRIBUTION, useCurrent: false } };
    expect(collectSizes(off).values).toEqual([30, 30]);
  });

  it('uses only the pool when the image on screen is switched off', () => {
    const data = withParticles([60], {
      distribution: { ...DEFAULT_DISTRIBUTION, useCurrent: false },
      pool: [entry('b.png', 'nm', [10, 20, 30])],
    });
    expect(collectSizes(data).values).toEqual([10, 20, 30]);
  });

  it('uses the chosen measure', () => {
    const pool = [{ ...entry('b.png', 'nm', [1]), longest: [5], shortest: [2] }];
    const base = withParticles([], { pool, image: null });
    const longest = collectSizes({
      ...base,
      distribution: { ...DEFAULT_DISTRIBUTION, measure: 'longest' },
    });
    expect(longest.values).toEqual([5]);
  });
});

describe('saved state', () => {
  it('upgrades version 2 by adding distribution settings and an empty pool', () => {
    const { distribution: _d, pool: _p, ...v2 } = initialParticleData;
    void _d;
    void _p;
    const upgraded = migrateParticleData({ step: 4, furthest: 4, data: { ...v2, nextId: 5 } }, 2);
    expect(upgraded?.data.pool).toEqual([]);
    expect(upgraded?.data.distribution).toEqual(DEFAULT_DISTRIBUTION);
    expect(upgraded?.data.nextId).toBe(5);
    expect(upgraded?.data.detect.particles).toEqual([]);
    // The old step 5 (Distribution and export) is step 5 again: hand measuring moved into the
    // detect step, and the adjust step came before it.
    expect(upgraded?.step).toBe(4);
    expect(upgraded?.furthest).toBe(4);
  });

  it('upgrades version 3: keeps the detection and its splitting, adds the clump settings', () => {
    const { diameterUsed: _new, ...v3Detect } = initialParticleData.detect;
    void _new;
    const v3 = {
      ...initialParticleData,
      measurements: [{ id: 1, kind: 'circle', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }],
      detect: {
        ...v3Detect,
        settings: {
          ...initialParticleData.detect.settings,
          split: { enabled: false, neckPercent: 55 },
        },
      },
    };
    const upgraded = migrateParticleData({ step: 3, furthest: 4, data: v3 }, 3);
    expect(upgraded?.step).toBe(4);
    expect(upgraded?.furthest).toBe(4);
    expect(upgraded?.data.measurements).toHaveLength(1);
    expect(upgraded?.data.detect.diameterUsed).toBeNull();
    expect(upgraded?.data.detect.settings.split).toEqual({
      ...DEFAULT_DETECT_SETTINGS.split,
      enabled: false,
      neckPercent: 55,
    });
  });
});

describe('methods text', () => {
  const values = cleanSizes([20, 25, 30, 35, 40]);
  const base = {
    software: 'XRD Toolkit',
    allSynthetic: false,
    images: 1,
    nmPerPixel: 0.5,
    detection: {
      settings: DEFAULT_DETECT_SETTINGS,
      edited: true,
      diameterUsed: null,
      thresholdUsed: null,
      fellBack: false,
      filters: {
        unit: 'nm',
        minDiameter: 5,
        maxDiameter: null,
        minCircularity: null,
        excludeEdge: true,
      },
    },
    handCount: 0,
    measureName: 'equal-area diameter',
    unit: 'nm',
    count: 5,
    mean: 30,
    sd: 7.9057,
    d10: 22,
    d50: 30,
    d90: 38,
    bins: { method: 'sturges' as const, count: 4 },
    fits: { normal: fitNormal(values), lognormal: fitLognormal(values) },
  };

  it('states the settings that were used', () => {
    const text = particleMethodsParagraph(base);
    expect(text).toContain('0.5 nm per pixel');
    expect(text).toContain('Otsu');
    expect(text).toContain('Gaussian filter (σ = 1 px)');
    expect(text).toContain('watershed');
    expect(text).toContain('smaller than 5 nm');
    expect(text).toContain('touching the edge');
    expect(text).toContain('corrected by hand');
    expect(text).toContain('5 particles');
    expect(text).toContain('4 bins by the Sturges rule');
    expect(text).toContain('D10, D50 and D90');
    expect(text).toContain('lognormal');
    expect(text).not.toMatch(/Hitachi|JEOL|kV/i);
  });

  it('describes clump separation with the diameter used and whether it was estimated', () => {
    const clumps = { ...DEFAULT_DETECT_SETTINGS.split, method: 'clumps' as const };
    const estimated = particleMethodsParagraph({
      ...base,
      detection: {
        ...base.detection,
        settings: { ...DEFAULT_DETECT_SETTINGS, split: clumps },
        diameterUsed: 33.1,
      },
    });
    expect(estimated).toContain('clumps were separated');
    expect(estimated).toContain('circular Hough transform');
    expect(estimated).toContain('typical diameter 33.1 px, estimated from the image');
    expect(estimated).toContain('at least 5 % of a whole outline');
    expect(estimated).not.toContain('neck threshold');
    const chosen = particleMethodsParagraph({
      ...base,
      detection: {
        ...base.detection,
        settings: { ...DEFAULT_DETECT_SETTINGS, split: { ...clumps, diameter: 40 } },
        diameterUsed: 40,
      },
    });
    expect(chosen).toContain('typical diameter 40 px, radii');
  });

  it('leaves out what was not used', () => {
    const text = particleMethodsParagraph({
      ...base,
      nmPerPixel: null,
      detection: null,
      handCount: 3,
      fits: { normal: null, lognormal: null },
      allSynthetic: true,
    });
    expect(text).toContain('no scale was set');
    expect(text).toContain('generated example');
    expect(text).toContain('3 particles were also measured by hand');
    expect(text).not.toContain('watershed');
    expect(text).not.toContain('fitted by maximum likelihood');
  });
});

describe('distribution step', () => {
  function setup(start: ParticleData) {
    let data = start;
    const view = render(<DistributionStep data={data} update={() => {}} />);
    const update = (patch: Partial<ParticleData>) => {
      data = { ...data, ...patch };
      view.rerender(<DistributionStep data={data} update={update} />);
    };
    view.rerender(<DistributionStep data={data} update={update} />);
    return { get: () => data };
  }
  const many = Array.from({ length: 12 }, (_, i) => 30 + 4 * i);

  it('shows the numbers and warns below 100 particles', () => {
    setup(withParticles(many));
    expect(screen.getByRole('alert').textContent).toContain('Only 12 particles');
    expect(screen.getByText('D90 (nm)')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /Histogram of the equal-area diameter of 12/ }),
    ).toBeTruthy();
    expect(screen.getByText(/sample standard deviation/)).toBeTruthy();
    expect(screen.getByLabelText('Methods paragraph')).toBeTruthy();
  });

  it('has no warning with 100 particles or more', () => {
    setup(withParticles([]));
    expect(screen.queryByRole('alert')).toBeNull();
    const pooled = withParticles([], {
      pool: [
        entry(
          'big.png',
          'nm',
          Array.from({ length: 120 }, (_, i) => 20 + (i % 30)),
        ),
      ],
    });
    setup(pooled);
    expect(screen.queryByText(/Only \d+ particles/)).toBeNull();
  });

  it('saves the image for pooling and removes it again', () => {
    const store = setup(withParticles(many));
    fireEvent.click(screen.getByRole('button', { name: 'Save this image for pooling' }));
    expect(store.get().pool).toHaveLength(1);
    expect(store.get().pool[0]?.equalArea).toHaveLength(12);
    expect(screen.getByText(/sample-a.png: 12 particles \(nm\)/)).toBeTruthy();
    // Saving the same image again replaces it instead of counting it twice.
    fireEvent.click(screen.getByRole('button', { name: 'Save this image for pooling' }));
    expect(store.get().pool).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Remove sample-a.png from the pool/ }));
    expect(store.get().pool).toHaveLength(0);
  });

  it('offers manual bins only when chosen', () => {
    const store = setup(withParticles(many));
    expect(screen.queryByLabelText('Number of bins')).toBeNull();
    fireEvent.change(screen.getByLabelText('Bins'), { target: { value: 'manual' } });
    expect(store.get().distribution.binMethod).toBe('manual');
    fireEvent.change(screen.getByLabelText('Number of bins'), { target: { value: '7' } });
    expect(store.get().distribution.manualBins).toBe(7);
  });

  it('says what to do when there is nothing to show', () => {
    setup(withParticles([]));
    expect(screen.getByText(/Nothing to show yet/)).toBeTruthy();
  });
});

describe('area fraction, intercepts and XRD comparison', () => {
  it('gives the area fraction of the detected particles in the whole image', () => {
    const result = stereologyOf(withParticles([40, 60, 80]));
    const expected = (Math.PI * (20 ** 2 + 30 ** 2 + 40 ** 2)) / (1000 * 800);
    expect(Math.abs((result?.areaFraction as number) - expected) / expected).toBeLessThan(0.03);
    expect(result?.unit).toBe('nm');
    expect(result?.regions).toBe(3);
  });

  it('shows the ratio of the particle size to the typed XRD size, marked as an estimate', () => {
    const data = withParticles([60, 60, 60, 60], {
      stereology: { ...DEFAULT_STEREOLOGY, xrdSizeNm: 10, xrdMethod: 'Scherrer' },
    });
    render(<DistributionStep data={data} update={() => {}} />);
    expect(screen.getByText('Area fraction and grain size')).toBeTruthy();
    expect(screen.getByText(/Estimate, not a proof/)).toBeTruthy();
    // Discs of 60 px are 30 nm, three times the 10 nm crystallite size.
    expect(screen.getByText(/Here it is 3(\.0\d*)?\./)).toBeTruthy();
    expect(screen.getByText(/ASTM E112 asks for at least 50/)).toBeTruthy();
  });

  it('upgrades a version 4 session with default settings', () => {
    const { stereology: _unused, ...v4 } = initialParticleData;
    void _unused;
    const upgraded = migrateParticleData({ step: 4, furthest: 4, data: v4 }, 4);
    expect(upgraded?.data.stereology).toEqual(DEFAULT_STEREOLOGY);
    expect(upgraded?.step).toBe(5);
  });
});
