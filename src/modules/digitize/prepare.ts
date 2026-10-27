import { useEffect, useState } from 'preact/hooks';
import type { RgbaImage } from '../../core/digitize/extract';
import type { ViewerImage } from '../particles/ImageViewer';
import type { ShotImageInfo } from './data';
import { loadShot } from './imageStore';

/** Longer images are scaled down to this many pixels: a figure needs no more, and memory stays low. */
export const MAX_SIDE = 4000;

export type ShotFormat = 'png' | 'jpeg' | 'webp';

/** The format from the first bytes of the file. */
export function sniffShot(bytes: Uint8Array): ShotFormat | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

export type DecodeShot =
  | { ok: true; bitmap: ImageBitmap; width: number; height: number; notes: string[] }
  | { ok: false; error: string };

/** Decodes the file with the browser, scaled down when its long side is over MAX_SIDE. */
export async function decodeShot(blob: Blob): Promise<DecodeShot> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!sniffShot(bytes))
    return {
      ok: false,
      error:
        'This is not a PNG, JPEG or WebP image. Take a screenshot of the figure, or export it from the PDF as PNG, and load that.',
    };
  try {
    const whole = await createImageBitmap(blob);
    const long = Math.max(whole.width, whole.height);
    if (long <= MAX_SIDE)
      return { ok: true, bitmap: whole, width: whole.width, height: whole.height, notes: [] };
    const scale = MAX_SIDE / long;
    const small = await createImageBitmap(blob, {
      resizeWidth: Math.round(whole.width * scale),
      resizeHeight: Math.round(whole.height * scale),
      resizeQuality: 'high',
    });
    const notes = [
      `The image is ${whole.width} × ${whole.height} pixels; it is used at ${small.width} × ${small.height}, which keeps every detail a figure needs.`,
    ];
    whole.close();
    return { ok: true, bitmap: small, width: small.width, height: small.height, notes };
  } catch {
    return { ok: false, error: 'This image could not be decoded. The file may be damaged.' };
  }
}

/** The image turned by `degrees` (clockwise) on a white canvas just large enough to hold it. */
export function rotated(bitmap: ImageBitmap, degrees: number): HTMLCanvasElement {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const width = Math.round(bitmap.width * cos + bitmap.height * sin);
  const height = Math.round(bitmap.width * sin + bitmap.height * cos);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.rotate(a);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  }
  return canvas;
}

/** The working image: what is shown and digitized (after rotation), with its pixels. */
export interface ShotImage extends ViewerImage {
  pixels: RgbaImage;
}

function prepare(bitmap: ImageBitmap, degrees: number): ShotImage {
  const canvas = rotated(bitmap, degrees);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    source: canvas,
    width: canvas.width,
    height: canvas.height,
    workScale: 1,
    pixels: {
      width: canvas.width,
      height: canvas.height,
      data: data ?? new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255),
    },
  };
}

/** The decoded file of the current image and its last rotated copy. */
let decoded: { id: string; bitmap: ImageBitmap } | undefined;
let prepared: { key: string; image: ShotImage } | undefined;

/** Keeps a freshly decoded file, so the first screen after loading needs no second decode. */
export function cacheShot(id: string, bitmap: ImageBitmap): void {
  if (decoded && decoded.id !== id) decoded.bitmap.close();
  decoded = { id, bitmap };
  prepared = undefined;
}

export function clearShotCache(): void {
  decoded?.bitmap.close();
  decoded = undefined;
  prepared = undefined;
}

function preparedFor(id: string, bitmap: ImageBitmap, degrees: number): ShotImage {
  const key = `${id}@${degrees}`;
  if (prepared?.key !== key) prepared = { key, image: prepare(bitmap, degrees) };
  return prepared.image;
}

export type ShotState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; image: ShotImage }
  | { status: 'error'; error: string };

/** The rotated working image of the saved state: from the cache, or from the file stored under `key`. */
export function useShotImage(key: string, info: ShotImageInfo | null, degrees: number): ShotState {
  const cached = () =>
    info && decoded?.id === info.id
      ? ({ status: 'ready', image: preparedFor(info.id, decoded.bitmap, degrees) } as const)
      : null;
  const [state, setState] = useState<ShotState>(
    () => cached() ?? { status: info ? 'loading' : 'none' },
  );
  const id = info?.id;
  useEffect(() => {
    if (!info) {
      setState({ status: 'none' });
      return;
    }
    const ready = cached();
    if (ready) {
      setState(ready);
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void (async () => {
      const blob = await loadShot(key, info.id).catch(() => undefined);
      if (!blob) {
        if (active)
          setState({
            status: 'error',
            error: 'The image is no longer stored in this browser. Load it again in step 1.',
          });
        return;
      }
      const result = await decodeShot(blob);
      if (!active) return;
      if (!result.ok) {
        setState({ status: 'error', error: result.error });
        return;
      }
      cacheShot(info.id, result.bitmap);
      setState({ status: 'ready', image: preparedFor(info.id, result.bitmap, degrees) });
    })();
    return () => {
      active = false;
    };
    // The image is identified by its id; the rest of the info does not change the file.
  }, [id, degrees]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
