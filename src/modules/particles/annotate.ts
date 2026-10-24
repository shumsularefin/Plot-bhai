import type { Rect } from '../../core/particles/geometry';
import type { Particle } from './data';
import type { DecodedImage } from './decode';
import { outlinePath, sizesOf } from './particleView';

/**
 * The image with the outline and number of every kept particle drawn on it, as PNG. It is made
 * on the working copy (at most 4096 px on the long side), which is also what the detection saw.
 * `crop` is in original pixels and is drawn as a dashed rectangle when given.
 */
export async function annotatedImage(
  image: DecodedImage,
  particles: readonly Particle[],
  crop: Rect | null,
): Promise<Blob> {
  const source = image.source as { width: number; height: number };
  const { width, height } = source;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A canvas is not available in this browser.');
  ctx.drawImage(image.source, 0, 0, width, height);
  // Line and text sizes follow the image so they are readable at any size.
  const unit = Math.max(1, Math.max(width, height) / 1000);
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = '#ff00aa';
  ctx.fillStyle = '#ffff00';
  ctx.font = `${Math.round(12 * unit)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const particle of particles) {
    const d = outlinePath(particle.runs);
    if (d) ctx.stroke(new Path2D(d));
  }
  for (const particle of particles) {
    const s = sizesOf(particle.runs, 1);
    const label = String(particle.id);
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(label, s.cx, s.cy);
    ctx.fillText(label, s.cx, s.cy);
  }
  if (crop) {
    const k = width / image.width;
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = '#00ffff';
    ctx.setLineDash([8 * unit, 6 * unit]);
    ctx.strokeRect(crop.x * k, crop.y * k, crop.width * k, crop.height * k);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image is too large for this browser.');
  return blob;
}
