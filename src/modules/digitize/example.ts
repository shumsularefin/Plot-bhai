import type { Rgb } from '../../core/digitize/extract';
import type { ExampleFigure } from './target';

/*
 * Generated example figures, not taken from any paper: curves on axes with ticks, gridlines and
 * an optional legend, as a figure in a paper might look. Each tool draws its own synthetic data.
 */

export interface FigureCurve {
  f: (x: number) => number;
  /** CSS colour; the traced curve's colour must also be given as RGB in `traced`. */
  color: string;
  label?: string;
}

export interface FigureSpec {
  /** x at the left and right edge of the plot area; left above right for a reversed axis. */
  x: readonly [number, number];
  xTick: number;
  xTitle: string;
  /** y at the bottom and top of the plot area. */
  y: readonly [number, number];
  yTick: number;
  /** Highest labelled y tick, to leave room for a legend. */
  yLabelsTo: number;
  curves: readonly FigureCurve[];
  /** The curve the example traces: its index, colour and an x to start from. */
  traced: { index: number; rgb: Rgb; at: number };
  /** x values of the two x marks and y values of the two y marks. */
  marks: { x: readonly [number, number]; y: readonly [number, number] };
  description: string;
}

const WIDTH = 1200;
const HEIGHT = 720;
const AREA = { left: 110, top: 40, right: 1160, bottom: 640 };

/** Draws the figure and returns it as a PNG with the marks a careful user would place. */
export async function drawFigure(spec: FigureSpec): Promise<ExampleFigure> {
  const [xl, xr] = spec.x;
  const [yb, yt] = spec.y;
  const px = (x: number, y: number) => ({
    x: AREA.left + ((x - xl) / (xr - xl)) * (AREA.right - AREA.left),
    y: AREA.bottom - ((y - yb) / (yt - yb)) * (AREA.bottom - AREA.top),
  });
  const xMin = Math.min(xl, xr);
  const xMax = Math.max(xl, xr);
  const xTicks: number[] = [];
  for (let x = Math.ceil(xMin / spec.xTick) * spec.xTick; x <= xMax + 1e-9; x += spec.xTick)
    xTicks.push(x);
  const yTicks: number[] = [];
  for (let y = Math.ceil(yb / spec.yTick) * spec.yTick; y <= spec.yLabelsTo + 1e-9; y += spec.yTick)
    yTicks.push(y);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  for (const x of xTicks) {
    const a = px(x, yb);
    if (a.x <= AREA.left + 1 || a.x >= AREA.right - 1) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, AREA.top);
    ctx.lineTo(Math.round(a.x) + 0.5, AREA.bottom);
    ctx.stroke();
  }
  for (const y of yTicks) {
    const a = px(xl, y);
    if (a.y >= AREA.bottom - 1) continue;
    ctx.beginPath();
    ctx.moveTo(AREA.left, Math.round(a.y) + 0.5);
    ctx.lineTo(AREA.right, Math.round(a.y) + 0.5);
    ctx.stroke();
  }

  const steps = 4000;
  for (const curve of spec.curves) {
    ctx.strokeStyle = curve.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = xMin + ((xMax - xMin) * i) / steps;
      const p = px(x, curve.f(x));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(AREA.left, AREA.top, AREA.right - AREA.left, AREA.bottom - AREA.top);
  ctx.fillStyle = '#000000';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const x of xTicks) {
    const a = px(x, yb);
    ctx.fillRect(Math.round(a.x) - 1, AREA.bottom, 2, 10);
    ctx.fillText(String(x), a.x, AREA.bottom + 14);
  }
  ctx.fillText(spec.xTitle, (AREA.left + AREA.right) / 2, AREA.bottom + 46);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const y of yTicks) {
    const a = px(xl, y);
    ctx.fillRect(AREA.left - 10, Math.round(a.y) - 1, 10, 2);
    ctx.fillText(String(y), AREA.left - 14, a.y);
  }
  ctx.textAlign = 'left';
  spec.curves
    .filter((c) => c.label)
    .forEach((c, i) => {
      ctx.fillStyle = c.color;
      ctx.fillText(c.label as string, AREA.right - 150, AREA.top + 30 + 32 * i);
      ctx.fillRect(AREA.right - 220, AREA.top + 29 + 32 * i, 50, 3);
    });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no PNG'))), 'image/png'),
  );
  const traced = spec.curves[spec.traced.index] as FigureCurve;
  const [mx1, mx2] = spec.marks.x;
  const [my1, my2] = spec.marks.y;
  return {
    blob,
    marks: {
      x1: { at: px(mx1, yb), value: mx1 },
      x2: { at: px(mx2, yb), value: mx2 },
      y1: { at: px(xl, my1), value: my1 },
      y2: { at: px(xl, my2), value: my2 },
    },
    seed: px(spec.traced.at, traced.f(spec.traced.at)),
    color: spec.traced.rgb,
    // Just inside the plot frame, so tick labels and the frame are left out.
    crop: {
      x: AREA.left + 4,
      y: AREA.top + 4,
      width: AREA.right - AREA.left - 8,
      height: AREA.bottom - AREA.top - 8,
    },
    description: spec.description,
  };
}
