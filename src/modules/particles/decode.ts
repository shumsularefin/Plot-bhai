import { workingScale } from '../../core/particles/geometry';
import { ifdToRgba } from '../../core/particles/tiff';
import type { ImageInfo } from './data';

/** Images with more pixels than this are refused: decoding them would exhaust a phone's memory. */
export const MAX_PIXELS = 150_000_000;

export interface DecodedImage {
  /** What is drawn on screen: the whole image, or a smaller working copy of it. */
  source: CanvasImageSource;
  /** Size of the original image in pixels. */
  width: number;
  height: number;
  /** Working copy size divided by original size (1 when the image is shown as it is). */
  workScale: number;
  format: ImageInfo['format'];
  notes: string[];
}

export type DecodeResult = { ok: true; image: DecodedImage } | { ok: false; error: string };

const EXPORT_HINT =
  'Save or export the image as PNG, JPEG or TIFF (in the microscope software or in a program such as ImageJ), then load that file.';

/** The file type from the first bytes, or from the extension for formats we only name. */
export function sniffFormat(
  name: string,
  bytes: Uint8Array,
): { format: ImageInfo['format'] } | { error: string } {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return { format: 'png' };
  if (startsWith(0xff, 0xd8, 0xff)) return { format: 'jpeg' };
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) {
    return { format: 'tiff' };
  }
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'dm3' || extension === 'dm4') {
    return {
      error: `Gatan DigitalMicrograph (.${extension}) files are a proprietary format that this site cannot read. ${EXPORT_HINT}`,
    };
  }
  return {
    error: `This does not look like a PNG, JPEG or TIFF image. ${EXPORT_HINT}`,
  };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Decodes an image file. PNG and JPEG use the browser's decoder; TIFF uses a decoder that is
 * loaded only when a TIFF is opened. Images whose long side is over the working limit also get
 * a smaller working copy for the screen; measurements always stay in original pixels.
 */
export async function decodeImage(
  name: string,
  bytes: Uint8Array,
  blob: Blob,
): Promise<DecodeResult> {
  const sniffed = sniffFormat(name, bytes);
  if ('error' in sniffed) return { ok: false, error: sniffed.error };
  const { format } = sniffed;
  const notes: string[] = [];

  try {
    if (format === 'tiff') {
      const { decode } = await import('tiff');
      let pages;
      try {
        pages = decode(bytes);
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        return {
          ok: false,
          error: `This TIFF could not be read${reason ? ` (${reason})` : ''}. ${EXPORT_HINT}`,
        };
      }
      const page = pages[0];
      if (!page) return { ok: false, error: 'This TIFF contains no image.' };
      if (pages.length > 1) {
        notes.push(`This TIFF has ${pages.length} pages. Only the first page is used.`);
      }
      if (page.width * page.height > MAX_PIXELS)
        return { ok: false, error: tooBig(page.width, page.height) };
      const rgba = ifdToRgba(page);
      if ('error' in rgba) return { ok: false, error: rgba.error };
      const full = makeCanvas(rgba.width, rgba.height);
      full.getContext('2d')?.putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
      const scale = workingScale(rgba.width, rgba.height);
      let source: CanvasImageSource = full;
      if (scale < 1) {
        const small = makeCanvas(Math.round(rgba.width * scale), Math.round(rgba.height * scale));
        const ctx = small.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(full, 0, 0, small.width, small.height);
        }
        source = small;
      }
      return {
        ok: true,
        image: { source, width: rgba.width, height: rgba.height, workScale: scale, format, notes },
      };
    }

    const whole = await createImageBitmap(blob);
    const { width, height } = whole;
    if (width * height > MAX_PIXELS) {
      whole.close();
      return { ok: false, error: tooBig(width, height) };
    }
    const scale = workingScale(width, height);
    if (scale >= 1)
      return { ok: true, image: { source: whole, width, height, workScale: 1, format, notes } };
    const small = await createImageBitmap(blob, {
      resizeWidth: Math.round(width * scale),
      resizeHeight: Math.round(height * scale),
      resizeQuality: 'high',
    });
    whole.close();
    return { ok: true, image: { source: small, width, height, workScale: scale, format, notes } };
  } catch {
    return {
      ok: false,
      error: `This image could not be decoded. The file may be damaged. ${EXPORT_HINT}`,
    };
  }
}

const tooBig = (width: number, height: number) =>
  `This image is ${width} × ${height} pixels (${Math.round((width * height) / 1e6)} megapixels), which is too large to open in a browser tab. Reduce its size first (for example in ImageJ) and load that file.`;
