// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dragRect, grabAt } from '../src/core/particles/geometry';
import { fitRect, toScreen } from '../src/core/particles/view';

const rect = { x: 100, y: 50, width: 200, height: 100 };

describe('crop rectangle editing', () => {
  it('finds the edge, corner or inside under a point', () => {
    expect(grabAt(rect, { x: 102, y: 100 }, 6)).toEqual({
      left: true,
      right: false,
      top: false,
      bottom: false,
    });
    expect(grabAt(rect, { x: 299, y: 151 }, 6)).toEqual({
      left: false,
      right: true,
      top: false,
      bottom: true,
    });
    expect(grabAt(rect, { x: 200, y: 100 }, 6)).toBe('move');
    expect(grabAt(rect, { x: 50, y: 100 }, 6)).toBeNull();
  });

  it('moves the rectangle and keeps it inside the image', () => {
    expect(dragRect(rect, 'move', 30, -10, 400, 300)).toEqual({ ...rect, x: 130, y: 40 });
    expect(dragRect(rect, 'move', 500, 500, 400, 300)).toEqual({ ...rect, x: 200, y: 200 });
  });

  it('moves only the grabbed edges, within the image and a minimum size', () => {
    const right = { left: false, right: true, top: false, bottom: false };
    expect(dragRect(rect, right, 50, 0, 400, 300)).toEqual({ ...rect, width: 250 });
    expect(dragRect(rect, right, 500, 0, 400, 300)).toEqual({ ...rect, width: 300 });
    expect(dragRect(rect, right, -500, 0, 400, 300, 8)).toEqual({ ...rect, width: 8 });
    const topLeft = { left: true, right: false, top: true, bottom: false };
    expect(dragRect(rect, topLeft, -20, -20, 400, 300)).toEqual({
      x: 80,
      y: 30,
      width: 220,
      height: 120,
    });
  });

  it('fits a rectangle of the image in a box, centred', () => {
    const view = fitRect(800, 400, rect);
    // 200 × 100 px into 800 × 400: scale 4, and the rectangle fills the box.
    expect(view.scale).toBe(4);
    expect(toScreen({ x: 100, y: 50 }, view)).toEqual({ x: 0, y: 0 });
    expect(toScreen({ x: 300, y: 150 }, view)).toEqual({ x: 800, y: 400 });
  });
});
