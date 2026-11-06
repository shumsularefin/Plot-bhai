import { rgbaToGray } from '../../core/particles/detect/image';
import type { Rect } from '../../core/particles/geometry';
import type { DecodedImage } from './decode';

/** Size of the image that is on screen (the working copy), which detection runs on. */
export function workingSize(image: DecodedImage): { width: number; height: number; scale: number } {
  const source = image.source as { width: number; height: number };
  return { width: source.width, height: source.height, scale: source.width / image.width };
}

/** The working copy as 8-bit grayscale. Needs a canvas, so only in the browser. */
export function grayOf(image: DecodedImage): { gray: Uint8Array; width: number; height: number } {
  const { width, height } = workingSize(image);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('A canvas is not available in this browser.');
  ctx.drawImage(image.source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { gray: rgbaToGray(data, width * height), width, height };
}

/** A canvas the size of the working copy with the mask drawn in a signal colour (transparent elsewhere). */
export function maskCanvas(mask: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      image.data[4 * i] = 255;
      image.data[4 * i + 1] = 0;
      image.data[4 * i + 2] = 170;
      image.data[4 * i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** A canvas showing a grayscale image (one byte per pixel) in shades of grey. */
export function grayCanvas(gray: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] as number;
    image.data[4 * i] = v;
    image.data[4 * i + 1] = v;
    image.data[4 * i + 2] = v;
    image.data[4 * i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** The crop (original pixels) on the working copy grid, or null for the whole image. */
export function workingArea(crop: Rect | null, scale: number): Rect | null {
  return crop
    ? {
        x: crop.x * scale,
        y: crop.y * scale,
        width: crop.width * scale,
        height: crop.height * scale,
      }
    : null;
}
