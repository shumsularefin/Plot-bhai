// @vitest-environment node
import { decode } from 'tiff';
import { describe, expect, it } from 'vitest';
import {
  bestUnit,
  cropBottom,
  distance,
  measure,
  nmPerPixel,
  pixelsPerNm,
  pixelsPerUnit,
  pixelsToNm,
  rectFromCorners,
  toOriginal,
  toWorking,
  workingScale,
  type Calibration,
} from '../src/core/particles/geometry';
import { ifdToRgba } from '../src/core/particles/tiff';
import {
  fitView,
  MAX_ZOOM_FACTOR,
  pan,
  toImage,
  toScreen,
  zoomAt,
} from '../src/core/particles/view';

const bar = (length: number, unit: 'nm' | 'um', px: number): Calibration => ({
  p1: { x: 100, y: 500 },
  p2: { x: 100 + px, y: 500 },
  length,
  unit,
});

describe('scale calibration', () => {
  it('turns a 200 px bar of 100 nm into 2 px per nm', () => {
    const c = bar(100, 'nm', 200);
    expect(pixelsPerNm(c)).toBe(2);
    expect(nmPerPixel(c)).toBe(0.5);
    expect(pixelsPerUnit(c, 'um')).toBe(2000);
    expect(pixelsToNm(40, c)).toBe(20);
  });

  it('converts micrometre bars: a 500 px bar of 1 µm is 0.5 px per nm', () => {
    const c = bar(1, 'um', 500);
    expect(pixelsPerNm(c)).toBe(0.5);
    expect(nmPerPixel(c)).toBe(2);
    expect(pixelsPerUnit(c, 'um')).toBe(500);
    expect(pixelsPerUnit(c, 'nm')).toBe(0.5);
  });

  it('works for a sloping bar and refuses unusable input', () => {
    const c: Calibration = { p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, length: 25, unit: 'nm' };
    expect(distance(c.p1, c.p2)).toBe(50);
    expect(pixelsPerNm(c)).toBe(2);
    expect(pixelsPerNm({ ...c, p2: c.p1 })).toBeNull();
    expect(pixelsPerNm({ ...c, length: 0 })).toBeNull();
    expect(pixelsPerNm({ ...c, length: -5 })).toBeNull();
    expect(pixelsToNm(10, null)).toBeNull();
  });

  it('picks the unit that reads best', () => {
    expect(bestUnit(999)).toBe('nm');
    expect(bestUnit(1000)).toBe('um');
    expect(bestUnit(2500)).toBe('um');
  });
});

describe('measurements', () => {
  it('measures a line, a circle drawn along a diameter and an ellipse drawn as a box', () => {
    const line = measure({ id: 1, kind: 'line', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } });
    expect(line.major).toBe(5);
    expect(line.area).toBe(0);

    const circle = measure({ id: 2, kind: 'circle', a: { x: 10, y: 10 }, b: { x: 30, y: 10 } });
    expect(circle.major).toBe(20);
    expect(circle.area).toBeCloseTo(Math.PI * 100, 10);
    expect(circle.equivalentDiameter).toBeCloseTo(20, 10);

    const ellipse = measure({ id: 3, kind: 'ellipse', a: { x: 5, y: 40 }, b: { x: 25, y: 10 } });
    expect(ellipse.major).toBe(30);
    expect(ellipse.minor).toBe(20);
    expect(ellipse.aspectRatio).toBe(1.5);
    expect(ellipse.area).toBeCloseTo((Math.PI * 30 * 20) / 4, 10);
    expect(ellipse.equivalentDiameter).toBeCloseTo(Math.sqrt(600), 10);
  });

  it('a circle drawn as a square ellipse has the same size and area as the circle', () => {
    const c = measure({ id: 1, kind: 'circle', a: { x: 0, y: 0 }, b: { x: 12, y: 0 } });
    const e = measure({ id: 2, kind: 'ellipse', a: { x: 0, y: 0 }, b: { x: 12, y: 12 } });
    expect(e.area).toBeCloseTo(c.area, 10);
    expect(e.equivalentDiameter).toBeCloseTo(c.equivalentDiameter, 10);
  });

  it('converts a measured diameter to nm with the calibration and the area with its square', () => {
    const c = bar(100, 'nm', 200);
    const circle = measure({ id: 1, kind: 'circle', a: { x: 0, y: 0 }, b: { x: 60, y: 0 } });
    expect(pixelsToNm(circle.major, c)).toBe(30);
    const nm = nmPerPixel(c) as number;
    expect(circle.area * nm * nm).toBeCloseTo((Math.PI * 30 * 30) / 4, 9);
  });
});

describe('working copy', () => {
  it('leaves small images alone and brings a 5000 px image down to the limit', () => {
    expect(workingScale(4000, 3000)).toBe(1);
    expect(workingScale(8192, 4096)).toBe(0.5);
    expect(workingScale(8192, 4096, 2048)).toBe(0.25);
  });

  it('maps points to the working copy and back without loss', () => {
    const p = { x: 1234.5, y: 678.9 };
    const s = workingScale(10000, 8000);
    const back = toOriginal(toWorking(p, s), s);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('a calibration drawn on the working copy gives the same scale as one on the original', () => {
    const s = 0.4;
    const original = bar(200, 'nm', 500);
    const onWorking = { ...original, p1: toWorking(original.p1, s), p2: toWorking(original.p2, s) };
    const mapped = {
      ...onWorking,
      p1: toOriginal(onWorking.p1, s),
      p2: toOriginal(onWorking.p2, s),
    };
    expect(pixelsPerNm(mapped)).toBeCloseTo(pixelsPerNm(original) as number, 9);
  });
});

describe('crop', () => {
  it('limits a drawn rectangle to the image and refuses an empty one', () => {
    expect(rectFromCorners({ x: -10, y: 5 }, { x: 50, y: 400 }, 100, 200)).toEqual({
      x: 0,
      y: 5,
      width: 50,
      height: 195,
    });
    expect(rectFromCorners({ x: 10, y: 10 }, { x: 10.5, y: 90 }, 100, 100)).toBeNull();
  });

  it('removes a data bar from the bottom', () => {
    expect(cropBottom(120, 1000, 800)).toEqual({ x: 0, y: 0, width: 1000, height: 680 });
    expect(cropBottom(800, 1000, 800)).toBeNull();
    expect(cropBottom(-5, 1000, 800)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });
});

describe('view transform', () => {
  it('fits and centres the image, and converts points both ways', () => {
    const v = fitView(800, 400, 1000, 1000);
    expect(v.scale).toBe(0.4);
    expect(v.tx).toBe(200);
    expect(v.ty).toBe(0);
    const p = { x: 250, y: 750 };
    const back = toImage(toScreen(p, v), v);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('zooms about a point so that the point stays put, and limits the zoom', () => {
    const v = fitView(800, 400, 1000, 1000);
    const spot = { x: 300, y: 200 };
    const at = toImage(spot, v);
    const zoomed = zoomAt(v, 2, spot.x, spot.y, v.scale);
    expect(zoomed.scale).toBeCloseTo(0.8, 12);
    const after = toScreen(at, zoomed);
    expect(after.x).toBeCloseTo(spot.x, 9);
    expect(after.y).toBeCloseTo(spot.y, 9);
    expect(zoomAt(v, 0.1, 0, 0, v.scale).scale).toBe(v.scale);
    expect(zoomAt(v, 1e6, 0, 0, v.scale).scale).toBeCloseTo(v.scale * MAX_ZOOM_FACTOR, 9);
    expect(pan(v, 5, -3)).toEqual({ ...v, tx: v.tx + 5, ty: v.ty - 3 });
  });
});

/** A minimal little-endian, uncompressed, single-strip grayscale TIFF written for the test. */
function grayTiff(
  width: number,
  height: number,
  bits: 8 | 16,
  photometric: 0 | 1,
  pixels: number[],
): Uint8Array {
  const entries = 9;
  const dataOffset = 8 + 2 + entries * 12 + 4;
  const bytes = width * height * (bits / 8);
  const buffer = new ArrayBuffer(dataOffset + bytes);
  const dv = new DataView(buffer);
  dv.setUint16(0, 0x4949, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries, true);
  let at = 10;
  const tag = (id: number, type: 3 | 4, value: number) => {
    dv.setUint16(at, id, true);
    dv.setUint16(at + 2, type, true);
    dv.setUint32(at + 4, 1, true);
    if (type === 3) dv.setUint16(at + 8, value, true);
    else dv.setUint32(at + 8, value, true);
    at += 12;
  };
  tag(256, 4, width);
  tag(257, 4, height);
  tag(258, 3, bits);
  tag(259, 3, 1);
  tag(262, 3, photometric);
  tag(273, 4, dataOffset);
  tag(277, 3, 1);
  tag(278, 4, height);
  tag(279, 4, bytes);
  dv.setUint32(at, 0, true);
  pixels.forEach((v, i) =>
    bits === 8 ? dv.setUint8(dataOffset + i, v) : dv.setUint16(dataOffset + 2 * i, v, true),
  );
  return new Uint8Array(buffer);
}

describe('TIFF display conversion', () => {
  const first = (bytes: Uint8Array) => {
    const ifd = decode(bytes)[0];
    if (!ifd) throw new Error('no page');
    return ifd;
  };

  it('reads an 8-bit grayscale TIFF as it is', () => {
    const rgba = ifdToRgba(first(grayTiff(2, 2, 8, 1, [0, 64, 128, 255])));
    expect('error' in rgba).toBe(false);
    if ('error' in rgba) return;
    expect(rgba.width).toBe(2);
    expect(Array.from(rgba.data.slice(0, 8))).toEqual([0, 0, 0, 255, 64, 64, 64, 255]);
    expect(rgba.data[12]).toBe(255);
  });

  it('stretches a dim 16-bit image to the full display range and leaves white-is-zero to the decoder', () => {
    const dim = ifdToRgba(first(grayTiff(2, 2, 16, 1, [1000, 1500, 2000, 3000])));
    if ('error' in dim) throw new Error(dim.error);
    expect(dim.data[0]).toBe(0);
    expect(dim.data[4]).toBe(64); // 63.75 rounded to a whole display level
    expect(dim.data[12]).toBe(255);
    const inverted = ifdToRgba(first(grayTiff(2, 2, 8, 0, [0, 255, 0, 255])));
    if ('error' in inverted) throw new Error(inverted.error);
    // The decoder has already inverted white-is-zero data, so 0 in the file shows as white.
    expect(inverted.data[0]).toBe(255);
    expect(inverted.data[4]).toBe(0);
  });

  it('refuses incomplete data with a plain message', () => {
    const ifd = first(grayTiff(2, 2, 8, 1, [1, 2, 3, 4]));
    const short = ifdToRgba({
      ...ifd,
      data: new Uint8Array(2),
      width: 2,
      height: 2,
      type: 1,
      samplesPerPixel: 1,
      bitsPerSample: 8,
    });
    expect('error' in short && short.error).toContain('incomplete');
  });
});
