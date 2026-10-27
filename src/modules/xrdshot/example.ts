import { ANODES } from '../../core/xrd/radiation';
import type { Rgb } from '../../core/digitize/extract';
import type { Point } from '../../core/particles/geometry';
import type { MarkId } from './data';

/*
 * A generated example figure, not taken from any paper: a black pattern of made-up peaks whose
 * widths follow the Scherrer equation for 18 nm crystallites (K = 0.9, Cu Kα1), and a red curve
 * above it, on axes with gridlines and a legend, as a figure in a paper might look.
 */

export const EXAMPLE_SIZE_NM = 18;
export const EXAMPLE_K = 0.9;
const PEAKS = [
  { center: 28, height: 620 },
  { center: 33, height: 900 },
  { center: 47.5, height: 480 },
  { center: 56.2, height: 380 },
  { center: 69.4, height: 260 },
];

export const EXAMPLE_DESCRIPTION = `A generated figure, not from a real paper: the black curve has made-up peaks whose widths match ${EXAMPLE_SIZE_NM} nm crystallites (Scherrer, K = ${EXAMPLE_K}, Cu Kα1, no instrument broadening), so the size found later can be checked against ${EXAMPLE_SIZE_NM} nm.`;

const WIDTH = 1200;
const HEIGHT = 720;
const AREA = { left: 100, top: 40, right: 1160, bottom: 640 };
const X_RANGE = [10, 80] as const;
const Y_RANGE = [0, 1600] as const;

const px = (x: number, y: number): Point => ({
  x: AREA.left + ((x - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0])) * (AREA.right - AREA.left),
  y: AREA.bottom - ((y - Y_RANGE[0]) / (Y_RANGE[1] - Y_RANGE[0])) * (AREA.bottom - AREA.top),
});

/** FWHM in degrees 2θ of D nm crystallites: β = Kλ / (D cos θ). */
function scherrerWidth(center: number): number {
  const lambdaNm = ANODES.Cu.kAlpha1 / 10;
  const beta =
    (EXAMPLE_K * lambdaNm) / (EXAMPLE_SIZE_NM * Math.cos(((center / 2) * Math.PI) / 180));
  return (beta * 180) / Math.PI;
}

function sample(x: number): number {
  const background = 90 + 60 * Math.exp(-(x - 10) / 12);
  return PEAKS.reduce((sum, p) => {
    const d = (x - p.center) / (scherrerWidth(p.center) / 2);
    return sum + p.height * (0.5 / (1 + d * d) + 0.5 * Math.exp(-Math.LN2 * d * d));
  }, background);
}

// Offset above the sample so the two curves never cross.
const reference = (x: number) => 1150 + 0.35 * sample(x) - 30;

/** Where a careful user would put the four calibration marks, with their values. */
export const EXAMPLE_MARKS: Record<MarkId, { at: Point; value: number }> = {
  x1: { at: px(20, 0), value: 20 },
  x2: { at: px(70, 0), value: 70 },
  y1: { at: px(10, 0), value: 0 },
  y2: { at: px(10, 1000), value: 1000 },
};

/** A point on the black curve, to start the trace from. */
export const EXAMPLE_SEED: Point = px(40, sample(40));
export const EXAMPLE_COLOR: Rgb = [0, 0, 0];
/** Just inside the plot frame, so tick labels and the frame are left out. */
export const EXAMPLE_CROP = {
  x: AREA.left + 4,
  y: AREA.top + 4,
  width: AREA.right - AREA.left - 8,
  height: AREA.bottom - AREA.top - 8,
};

/** Draws the example figure and returns it as a PNG file. */
export async function makeExampleShot(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  for (let x = 20; x < X_RANGE[1]; x += 10) {
    const a = px(x, 0);
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, AREA.top);
    ctx.lineTo(Math.round(a.x) + 0.5, AREA.bottom);
    ctx.stroke();
  }
  for (let y = 200; y < Y_RANGE[1]; y += 200) {
    const a = px(10, y);
    ctx.beginPath();
    ctx.moveTo(AREA.left, Math.round(a.y) + 0.5);
    ctx.lineTo(AREA.right, Math.round(a.y) + 0.5);
    ctx.stroke();
  }

  const curve = (f: (x: number) => number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = X_RANGE[0]; x <= X_RANGE[1]; x += 0.01) {
      const p = px(x, f(x));
      if (x === X_RANGE[0]) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  };
  curve(reference, '#d62728');
  curve(sample, '#000000');

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(AREA.left, AREA.top, AREA.right - AREA.left, AREA.bottom - AREA.top);
  ctx.fillStyle = '#000000';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 10; x <= X_RANGE[1]; x += 10) {
    const a = px(x, 0);
    ctx.fillRect(Math.round(a.x) - 1, AREA.bottom, 2, 10);
    ctx.fillText(String(x), a.x, AREA.bottom + 14);
  }
  ctx.fillText('2θ (degrees)', (AREA.left + AREA.right) / 2, AREA.bottom + 46);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = 0; y <= 1400; y += 200) {
    const a = px(10, y);
    ctx.fillRect(AREA.left - 10, Math.round(a.y) - 1, 10, 2);
    ctx.fillText(String(y), AREA.left - 14, a.y);
  }
  ctx.textAlign = 'left';
  ctx.fillText('Sample', AREA.right - 150, AREA.top + 30);
  ctx.fillRect(AREA.right - 220, AREA.top + 29, 50, 3);
  ctx.fillStyle = '#d62728';
  ctx.fillText('Reference', AREA.right - 150, AREA.top + 62);
  ctx.fillRect(AREA.right - 220, AREA.top + 61, 50, 3);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG'))), 'image/png'),
  );
}
