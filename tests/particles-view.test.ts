// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADJUST } from '../src/core/particles/detect/adjust';
import { ellipseRuns } from '../src/core/particles/detect/manual';
import {
  DEFAULT_FILTERS,
  initialParticleData,
  migrateParticleData,
  type Particle,
  type ParticleFilters,
} from '../src/modules/particles/data';
import { applyFilters, outlinePath, sizesOf } from '../src/modules/particles/particleView';

const particle = (id: number, d: number, cx = 100, cy = 100): Particle => ({
  id,
  source: 'auto',
  runs: ellipseRuns(cx, cy, d / 2, d / 2, 400, 400),
});
const context = { scale: 1, nmPerPixel: 0.5, edgeArea: { x: 0, y: 0, width: 400, height: 400 } };

describe('sizes on a working copy', () => {
  it('maps lengths and areas back to the original image', () => {
    const p = particle(1, 40);
    const same = sizesOf(p.runs, 1);
    const half = sizesOf(p.runs, 0.5);
    expect(half.eqDiameter).toBeCloseTo(2 * same.eqDiameter, 9);
    expect(half.feretMax).toBeCloseTo(2 * same.feretMax, 9);
    expect(half.area).toBeCloseTo(4 * same.area, 6);
    expect(half.cx).toBeCloseTo(2 * same.cx, 9);
    expect(half.circularity).toBe(same.circularity);
    expect(Math.abs(same.eqDiameter - 40) / 40).toBeLessThan(0.02);
  });

  it('draws an outline as a closed path of the particle', () => {
    const d = outlinePath(particle(1, 20).runs);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(outlinePath(Int32Array.from([]))).toBe('');
  });
});

describe('filters', () => {
  const particles = [
    particle(1, 20),
    particle(2, 40, 200, 100),
    particle(3, 80, 100, 250),
    particle(4, 40, 15, 300),
  ];
  const filter = (patch: Partial<ParticleFilters>) =>
    applyFilters(particles, { ...DEFAULT_FILTERS, ...patch }, context);

  it('keeps everything with no limits', () => {
    expect(filter({}).kept).toHaveLength(4);
  });

  it('limits the equivalent diameter in pixels and in nm (0.5 nm per pixel)', () => {
    const px = filter({ minDiameter: 30, maxDiameter: 60 });
    expect(px.kept.map((p) => p.id)).toEqual([2, 4]);
    expect(px.counts).toMatchObject({ small: 1, large: 1 });
    // 30 nm is 60 px, 10 nm is 20 px.
    const nm = filter({ unit: 'nm', minDiameter: 15, maxDiameter: 30 });
    expect(nm.kept.map((p) => p.id)).toEqual([2, 4]);
    const um = filter({ unit: 'um', maxDiameter: 0.03 });
    expect(um.kept.map((p) => p.id)).toEqual([1, 2, 4]);
  });

  it('ignores nm limits when there is no scale, and filters by circularity and edge contact', () => {
    const noScale = applyFilters(
      particles,
      { ...DEFAULT_FILTERS, unit: 'nm', minDiameter: 1000 },
      { ...context, nmPerPixel: null },
    );
    expect(noScale.kept).toHaveLength(4);
    const edge = filter({ excludeEdge: true });
    expect(edge.kept.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(edge.counts.edge).toBe(1);
    const round = filter({ minCircularity: 0.99 });
    expect(round.kept).toHaveLength(0);
    expect(round.counts.shape).toBe(4);
  });
});

describe('saved state', () => {
  it('upgrades version 1 by adding empty detection state and keeps the old data', () => {
    const { detect: _unused, ...v1 } = initialParticleData;
    void _unused;
    const upgraded = migrateParticleData({ step: 2, furthest: 2, data: { ...v1, nextId: 7 } }, 1);
    expect(upgraded?.data.detect.particles).toEqual([]);
    expect(upgraded?.data.nextId).toBe(7);
    // Step 2 (detect) is step 3 since the adjust step came before it.
    expect(upgraded?.step).toBe(3);
    expect(migrateParticleData({}, 1)).toBeUndefined();
    expect(migrateParticleData({ step: 0, furthest: 0, data: v1 }, 7)).toBeUndefined();
  });

  it('upgrades version 5: adds the adjust step and settings, renames Otsu to an automatic method', () => {
    const v5Settings = {
      ...initialParticleData.detect.settings,
      threshold: { method: 'otsu', manual: 90, adaptiveRadius: 30, adaptiveOffset: 2 },
    };
    const { adjust: _adjust, ...withoutAdjust } = v5Settings;
    void _adjust;
    const { fellBack: _fellBack, columns: _columns, ...v5Detect } = initialParticleData.detect;
    void _fellBack;
    void _columns;
    const upgraded = migrateParticleData(
      {
        step: 2,
        furthest: 3,
        data: { ...initialParticleData, detect: { ...v5Detect, settings: withoutAdjust } },
      },
      5,
    );
    expect(upgraded?.step).toBe(3);
    expect(upgraded?.furthest).toBe(4);
    const settings = upgraded?.data.detect.settings;
    expect(settings?.threshold).toEqual({
      method: 'auto',
      auto: 'otsu',
      manual: 90,
      adaptiveRadius: 30,
      adaptiveOffset: 2,
    });
    expect(settings?.adjust).toEqual(DEFAULT_ADJUST);
    expect(upgraded?.data.detect.fellBack).toBe(false);
    expect(upgraded?.data.detect.columns).toEqual([]);
    const kept = migrateParticleData(
      {
        step: 1,
        furthest: 1,
        data: {
          ...initialParticleData,
          detect: {
            ...v5Detect,
            settings: {
              ...withoutAdjust,
              threshold: { ...v5Settings.threshold, method: 'manual' },
            },
          },
        },
      },
      5,
    );
    expect(kept?.step).toBe(1);
    expect(kept?.data.detect.settings.threshold.method).toBe('manual');
  });
});
