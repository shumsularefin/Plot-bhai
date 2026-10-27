// Synthetic plot images for the digitizer tests: a curve with a known equation drawn on axes with
// known pixel positions, so every recovered value can be checked against the truth.
import type { RgbaImage, Rgb } from '../src/core/digitize/extract';
import type { Calibration } from '../src/core/digitize/calibration';

export interface PlotSpec {
  width: number;
  height: number;
  /** Plot area in pixels: left, top, right, bottom (the axes are drawn on its left and bottom edges). */
  area: [number, number, number, number];
  xRange: [number, number];
  yRange: [number, number];
  yScale?: 'linear' | 'log';
}

export interface Curve {
  f: (x: number) => number;
  color: Rgb;
  /** Line thickness, pixels. */
  thickness: number;
}

export function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function paint(img: RgbaImage, x: number, y: number, c: Rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = 255;
}

/** Pixel position (continuous) of a data value. */
export function pixelOf(spec: PlotSpec, x: number, y: number): { x: number; y: number } {
  const [l, t, r, b] = spec.area;
  const fx = (x - spec.xRange[0]) / (spec.xRange[1] - spec.xRange[0]);
  const log = spec.yScale === 'log';
  const v = log ? Math.log10(y) : y;
  const [y0, y1] = log ? spec.yRange.map(Math.log10) : spec.yRange;
  const fy = (v - (y0 as number)) / ((y1 as number) - (y0 as number));
  return { x: l + fx * (r - l), y: b - fy * (b - t) };
}

/** Draws the curve as a connected thick line: discs of the line thickness along every segment. */
export function drawCurve(img: RgbaImage, spec: PlotSpec, curve: Curve) {
  const [l, , r] = spec.area;
  const radius = curve.thickness / 2;
  const disc = (p: { x: number; y: number }) => {
    for (let yy = Math.floor(p.y - radius); yy <= Math.ceil(p.y + radius); yy++)
      for (let xx = Math.floor(p.x - radius); xx <= Math.ceil(p.x + radius); xx++)
        if ((xx + 0.5 - p.x) ** 2 + (yy + 0.5 - p.y) ** 2 <= radius * radius + 0.25)
          paint(img, xx, yy, curve.color);
  };
  let previous: { x: number; y: number } | null = null;
  for (let px = l; px <= r; px += 0.25) {
    const x = spec.xRange[0] + ((px - l) / (r - l)) * (spec.xRange[1] - spec.xRange[0]);
    const p = pixelOf(spec, x, curve.f(x));
    if (previous) {
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - previous.x, p.y - previous.y) / 0.25));
      for (let k = 1; k <= steps; k++)
        disc({
          x: previous.x + ((p.x - previous.x) * k) / steps,
          y: previous.y + ((p.y - previous.y) * k) / steps,
        });
    } else disc(p);
    previous = p;
  }
}

/** Axis lines (2 px, black) with ticks, and optional light gridlines. */
export function drawAxes(img: RgbaImage, spec: PlotSpec, grid: Rgb | null = null) {
  const [l, t, r, b] = spec.area;
  if (grid) {
    for (let x = l + 50; x < r; x += 50) for (let y = t; y <= b; y++) paint(img, x, y, grid);
    for (let y = b - 50; y > t; y -= 50) for (let x = l; x <= r; x++) paint(img, x, y, grid);
  }
  for (let x = l - 1; x <= r; x++) {
    paint(img, x, b, [0, 0, 0]);
    paint(img, x, b + 1, [0, 0, 0]);
  }
  for (let y = t; y <= b + 1; y++) {
    paint(img, l - 1, y, [0, 0, 0]);
    paint(img, l, y, [0, 0, 0]);
  }
  for (let x = l; x <= r; x += 50) for (let y = b + 2; y < b + 8; y++) paint(img, x, y, [0, 0, 0]);
}

/** A block of "text": solid rectangle, standing in for a legend or label. */
export function drawBlock(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgb) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) paint(img, xx, yy, c);
}

/** Adds noise and a 3×3 blur, like a compressed screenshot. Deterministic. */
export function degrade(img: RgbaImage, noise: number, seed = 1): RgbaImage {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const { width, height } = img;
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx));
            const yy = Math.min(height - 1, Math.max(0, y + dy));
            const w = dx === 0 && dy === 0 ? 4 : 1;
            sum += w * (img.data[(yy * width + xx) * 4 + c] as number);
            n += w;
          }
        out[(y * width + x) * 4 + c] = sum / n + noise * random();
      }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width, height, data: out };
}

/** The calibration a careful user would make: the axis ends with their values. */
export function exactCalibration(spec: PlotSpec): Calibration {
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  return {
    x: [
      { at: pixelOf(spec, x0, y0), value: x0 },
      { at: pixelOf(spec, x1, y0), value: x1 },
    ],
    y: [
      { at: pixelOf(spec, x0, y0), value: y0 },
      { at: pixelOf(spec, x0, y1), value: y1 },
    ],
    yScale: spec.yScale ?? 'linear',
  };
}

/** Pseudo-Voigt peak with height 1 at `center`, full width at half maximum `fwhm`. */
export function pseudoVoigt(x: number, center: number, fwhm: number, eta: number): number {
  const d = (x - center) / (fwhm / 2);
  return eta / (1 + d * d) + (1 - eta) * Math.exp(-Math.LN2 * d * d);
}
