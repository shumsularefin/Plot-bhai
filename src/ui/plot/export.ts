import { h, render } from 'preact';
import { PlotSvg } from './PlotSvg';
import { setPngDpi } from './png';
import type { AxisLabels, Domain, PlotSeries } from './types';

/** Journal figure widths. Heights are a starting point and can be changed. */
export const EXPORT_PRESETS = {
  single: { label: 'Single column', widthMm: 85, heightMm: 65 },
  double: { label: 'Double column', widthMm: 180, heightMm: 100 },
} as const;
export type ExportPreset = keyof typeof EXPORT_PRESETS;

export const EXPORT_FONTS = {
  arial: { label: 'Arial', family: "Arial, Helvetica, 'Liberation Sans', sans-serif" },
  times: {
    label: 'Times New Roman',
    family: "'Times New Roman', Times, 'Liberation Serif', serif",
  },
} as const;
export type ExportFont = keyof typeof EXPORT_FONTS;

export interface ExportSettings {
  preset: ExportPreset;
  heightMm: number;
  font: ExportFont;
  fontSizePt: number;
  lineWidthPt: number;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  preset: 'single',
  heightMm: EXPORT_PRESETS.single.heightMm,
  font: 'arial',
  fontSizePt: 8,
  lineWidthPt: 1,
};

/** 1 inch = 25.4 mm = 72 pt. */
const PT_PER_MM = 72 / 25.4;
/** Enough columns that decimation is invisible even at 600 dpi on a double-column figure. */
const VECTOR_SAMPLES = 4500;

export interface FigureSize {
  widthMm: number;
  heightMm: number;
}

export function figureSize(settings: ExportSettings): FigureSize {
  return { widthMm: EXPORT_PRESETS[settings.preset].widthMm, heightMm: settings.heightMm };
}

/** Pixel size of a PNG at the given dots per inch: pixels = mm / 25.4 × dpi. */
export function pixelSize(size: FigureSize, dpi: number): { width: number; height: number } {
  return {
    width: Math.round((size.widthMm / 25.4) * dpi),
    height: Math.round((size.heightMm / 25.4) * dpi),
  };
}

/**
 * Renders the figure as a standalone SVG document string. Sizes are physical (mm) and the
 * drawing units are points, so the font size and line width come out exactly as chosen.
 */
export function renderSvgString(
  series: readonly PlotSeries[],
  xDomain: Domain,
  labels: AxisLabels,
  settings: ExportSettings,
): string {
  const size = figureSize(settings);
  const host = document.createElement('div');
  render(
    h(PlotSvg, {
      series,
      xDomain,
      width: size.widthMm * PT_PER_MM,
      height: size.heightMm * PT_PER_MM,
      labels,
      samples: VECTOR_SAMPLES,
      legend: true,
      style: {
        fontSize: settings.fontSizePt,
        lineWidth: settings.lineWidthPt,
        print: { fontFamily: EXPORT_FONTS[settings.font].family },
      },
      svgAttributes: { width: `${size.widthMm}mm`, height: `${size.heightMm}mm` },
    }),
    host,
  );
  const svg = host.firstElementChild;
  const markup = svg ? new XMLSerializer().serializeToString(svg) : '';
  render(null, host);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}

/** Draws an SVG string onto a white canvas and returns a PNG tagged with the given dpi. */
export async function svgToPng(svg: string, size: FigureSize, dpi: number): Promise<Blob> {
  const { width, height } = pixelSize(size, dpi);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('image too large');
    const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turns a pattern name into a safe file name stem. */
export function fileStem(name: string): string {
  return (
    name
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plot'
  );
}
