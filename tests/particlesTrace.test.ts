import { describe, expect, it } from 'vitest';
import { ellipseRuns, polygonRuns } from '../src/core/particles/detect/manual';
import type { Runs } from '../src/core/particles/detect/regions';

const areaOf = (runs: Runs) => {
  let n = 0;
  for (let i = 0; i < runs.length; i += 3) n += (runs[i + 2] as number) - (runs[i + 1] as number);
  return n;
};

describe('outline traced by hand', () => {
  it('fills a square exactly', () => {
    const runs = polygonRuns(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 20 },
        { x: 10, y: 20 },
      ],
      100,
      100,
    );
    expect(areaOf(runs)).toBe(200);
    expect(Array.from(runs.slice(0, 3))).toEqual([10, 10, 30]);
  });

  it('fills a traced circle like the circle tool', () => {
    const points = Array.from({ length: 360 }, (_, i) => ({
      x: 50 + 20 * Math.cos((i * Math.PI) / 180),
      y: 50 + 20 * Math.sin((i * Math.PI) / 180),
    }));
    const traced = areaOf(polygonRuns(points, 100, 100));
    const circle = areaOf(ellipseRuns(50, 50, 20, 20, 100, 100));
    expect(Math.abs(traced - circle)).toBeLessThan(10);
    expect(Math.abs(traced - Math.PI * 400)).toBeLessThan(15);
  });

  it('clips to the image and ignores too few points', () => {
    const runs = polygonRuns(
      [
        { x: -10, y: -10 },
        { x: 5, y: -10 },
        { x: 5, y: 5 },
        { x: -10, y: 5 },
      ],
      100,
      100,
    );
    expect(areaOf(runs)).toBe(25);
    expect(
      polygonRuns(
        [
          { x: 1, y: 1 },
          { x: 5, y: 5 },
        ],
        10,
        10,
      ).length,
    ).toBe(0);
  });
});
