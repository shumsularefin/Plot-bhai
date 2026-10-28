// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Runs } from '../src/core/particles/detect/regions';
import { findScaleBar } from '../src/core/particles/scaleBar';
import {
  areaFraction,
  astmGrainSize,
  countIntercepts,
  meanIntercept,
} from '../src/core/particles/stereology';

/** Runs of a filled rectangle. */
function rect(x0: number, y0: number, x1: number, y1: number): Runs {
  const list: number[] = [];
  for (let y = y0; y < y1; y++) list.push(y, x0, x1);
  return Int32Array.from(list);
}

/** Runs of a disc of radius r around (cx, cy): pixels whose centre lies inside. */
function disc(cx: number, cy: number, r: number): Runs {
  const list: number[] = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const dy = y + 0.5 - cy;
    if (Math.abs(dy) >= r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    const x0 = Math.ceil(cx - half - 0.5);
    const x1 = Math.floor(cx + half - 0.5) + 1;
    if (x1 > x0) list.push(y, x0, x1);
  }
  return Int32Array.from(list);
}

describe('area fraction', () => {
  it('is the share of the analysed area covered by the regions', () => {
    const area = { x: 0, y: 0, width: 50, height: 40 };
    expect(areaFraction([rect(0, 0, 10, 10), rect(20, 20, 30, 40)], area)).toBeCloseTo(
      300 / 2000,
      12,
    );
  });

  it('counts only the part of a region inside the area', () => {
    const area = { x: 10, y: 10, width: 20, height: 20 };
    expect(areaFraction([rect(0, 0, 20, 20)], area)).toBeCloseTo(100 / 400, 12);
  });
});

describe('line intercepts (ASTM E112)', () => {
  // Square grains 10 px wide tile the plane; the analysed area starts and ends halfway into a grain.
  const grains: Runs[] = [];
  for (let gy = 0; gy < 12; gy++)
    for (let gx = 0; gx < 12; gx++) grains.push(rect(gx * 10, gy * 10, gx * 10 + 10, gy * 10 + 10));
  const area = { x: 5, y: 5, width: 90, height: 90 };

  it('scores end segments as half intercepts and recovers the grain width', () => {
    const counts = countIntercepts(grains, area, 'horizontal', 9);
    // Each 90 px line: two half grains at the ends (½ each) and 8 whole grains = 9 intercepts.
    expect(counts.lines).toBe(9);
    expect(counts.lineLength).toBe(810);
    expect(counts.intercepts).toBe(81);
    expect(meanIntercept(counts, 'grains')).toBeCloseTo(10, 12);
  });

  it('gives the same in the other direction for equiaxed grains', () => {
    const counts = countIntercepts(grains, area, 'vertical', 9);
    expect(meanIntercept(counts, 'grains')).toBeCloseTo(10, 12);
  });

  it('gives the mean chord πr/2 of discs on a background (one phase)', () => {
    const r = 20;
    const discs = [disc(50, 50, r), disc(150, 50, r), disc(50, 150, r), disc(150, 150, r)];
    const area = { x: 0, y: 0, width: 200, height: 200 };
    const counts = countIntercepts(discs, area, 'horizontal', 200);
    // Mean chord of a disc for parallel lines = area / width = πr² / 2r.
    expect(meanIntercept(counts, 'phase') as number).toBeCloseTo((Math.PI * r) / 2, 0);
    expect(areaFraction(discs, area)).toBeCloseTo((4 * Math.PI * r * r) / 40000, 2);
  });

  it('has no mean intercept without intercepts', () => {
    const counts = countIntercepts([], area, 'horizontal', 5);
    expect(meanIntercept(counts, 'grains')).toBeNull();
  });
});

describe('ASTM grain size number', () => {
  // Pairs from ASTM E112-13 Table 4 (mean intercept in mm at 1X).
  it.each([
    [0.32, 0],
    [0.02, 8],
    [0.0025, 14],
  ])('ℓ̄ = %s mm gives G = %s', (l, g) => {
    expect(astmGrainSize(l) as number).toBeCloseTo(g, 2);
  });

  it('rises by 2 when the intercept halves', () => {
    expect((astmGrainSize(0.01) as number) - (astmGrainSize(0.02) as number)).toBeCloseTo(2, 4);
  });
});

describe('scale bar detection', () => {
  /** A grey image with speckled content, a black data bar at the bottom and a white bar on it. */
  function micrograph() {
    const width = 400;
    const height = 300;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = 90 + ((i * 7919) % 80);
    for (let y = 260; y < height; y++) gray.fill(0, y * width, (y + 1) * width);
    for (let y = 275; y < 280; y++) gray.fill(255, y * width + 300, y * width + 380);
    // Letters next to the bar: short white strokes that must not win.
    for (let y = 266; y < 290; y++) gray.fill(255, y * width + 250, y * width + 253);
    return { gray, width, height };
  }

  it('finds a white bar on a black data bar', () => {
    const { gray, width, height } = micrograph();
    const bar = findScaleBar(gray, width, height);
    expect(bar).not.toBeNull();
    expect(bar?.p1).toEqual({ x: 300, y: 277 });
    expect(bar?.p2).toEqual({ x: 380, y: 277 });
    expect(bar?.thickness).toBe(5);
    expect(bar?.tone).toBe('bright');
  });

  it('finds a black bar drawn on a light image', () => {
    const width = 300;
    const height = 200;
    const gray = new Uint8Array(width * height).fill(230);
    for (let y = 180; y < 183; y++) gray.fill(10, y * width + 20, y * width + 120);
    const bar = findScaleBar(gray, width, height);
    expect(bar?.tone).toBe('dark');
    expect((bar?.p2.x ?? 0) - (bar?.p1.x ?? 0)).toBe(100);
  });

  it('puts the ends at the centres of end ticks', () => {
    // Like the example image: a 4 px line from x = 60 to 260 with 4 px ticks centred on its ends.
    const width = 400;
    const height = 200;
    const gray = new Uint8Array(width * height);
    for (let y = 150; y < 160; y++) gray.fill(255, y * width + 58, y * width + 62);
    for (let y = 150; y < 160; y++) gray.fill(255, y * width + 258, y * width + 262);
    for (let y = 154; y < 158; y++) gray.fill(255, y * width + 58, y * width + 262);
    const bar = findScaleBar(gray, width, height);
    expect(bar?.p1.x).toBe(60);
    expect(bar?.p2.x).toBe(260);
  });

  it('finds nothing in an image without a bar', () => {
    const width = 200;
    const height = 200;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = 90 + ((i * 7919) % 80);
    expect(findScaleBar(gray, width, height)).toBeNull();
  });
});
