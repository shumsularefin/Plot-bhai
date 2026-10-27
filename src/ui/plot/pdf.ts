/*
 * A one-page PDF holding a figure as an RGB image, written by hand (PDF 1.4, ISO 32000-1
 * structure: header, numbered objects, cross-reference table, trailer). The figure is first
 * rendered to pixels from its SVG at the chosen resolution, so text and lines are raster in the
 * PDF; SVG remains the vector format. No library is needed.
 */

import type { FigureSize } from './export';

const encoder = new TextEncoder();

/** zlib-compressed bytes (the PDF FlateDecode filter), or null where the browser cannot compress. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * PDF bytes for one page of widthPt × heightPt points showing an image of width × height pixels
 * (rgb: 3 bytes per pixel, rows from the top). `compressed` says whether rgb is already
 * zlib-compressed (FlateDecode).
 */
export function pdfFromRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  widthPt: number,
  heightPt: number,
  compressed: boolean,
): Uint8Array {
  const w = widthPt.toFixed(3);
  const h = heightPt.toFixed(3);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | Uint8Array[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body.forEach(push);
    push('\nendobj\n');
  };
  // %âãÏÓ marks the file as binary for transfer programs, as the PDF specification suggests.
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(4, [
    encoder.encode(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8${compressed ? ' /Filter /FlateDecode' : ''} /Length ${rgb.length} >>\nstream\n`,
    ),
    rgb,
    encoder.encode('\nendstream'),
  ]);
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  object(6, '<< /Producer (Plot Bhai) >>');
  const xref = length;
  const rows = offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`);
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${rows.join('')}`);
  push(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Renders an SVG figure at `dpi` on white and returns a one-page PDF of the figure's size. */
export async function svgToPdf(svg: string, size: FigureSize, dpi: number): Promise<Blob> {
  const width = Math.round((size.widthMm / 25.4) * dpi);
  const height = Math.round((size.heightMm / 25.4) * dpi);
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
    const rgba = context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i] as number;
      rgb[j + 1] = rgba[i + 1] as number;
      rgb[j + 2] = rgba[i + 2] as number;
    }
    const packed = await deflate(rgb);
    const pt = 72 / 25.4;
    const bytes = pdfFromRgb(
      packed ?? rgb,
      width,
      height,
      size.widthMm * pt,
      size.heightMm * pt,
      packed !== null,
    );
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
