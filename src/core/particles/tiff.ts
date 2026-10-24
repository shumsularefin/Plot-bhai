import type { TiffIfd } from 'tiff';

export interface Rgba {
  width: number;
  height: number;
  /** Interleaved red, green, blue, alpha; 8 bits each. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Turns a decoded TIFF page into 8-bit RGBA for display. Grayscale of any bit depth (SEM files
 * are often 16 bit) is mapped linearly from the page's lowest to highest value to 0–255, so a
 * dim 16-bit image is still visible; for 8-bit data the values are used as they are, and for fewer
 * bits they are scaled up to 255. White-is-zero files are already inverted by the decoder, so no
 * inversion is done here. RGB pages are used as they are (16-bit values
 * are scaled down by 256). Palette and other layouts are refused with a plain message.
 * The display mapping never changes the stored file, and the mapping is for viewing only.
 */
export function ifdToRgba(
  ifd: Pick<TiffIfd, 'width' | 'height' | 'data' | 'type' | 'samplesPerPixel' | 'bitsPerSample'>,
): Rgba | { error: string } {
  const { width, height, data, samplesPerPixel: samples, bitsPerSample: bits } = ifd;
  const photometric = ifd.type;
  if (!(width > 0 && height > 0)) return { error: 'This TIFF has no image size.' };
  if (data.length < width * height * samples) {
    return { error: 'This TIFF is incomplete or uses a layout this site cannot read.' };
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const n = width * height;

  if (photometric === 2 && samples >= 3) {
    const shift = bits > 8 ? 8 : 0;
    for (let i = 0; i < n; i++) {
      out[4 * i] = (data[i * samples] as number) >> shift;
      out[4 * i + 1] = (data[i * samples + 1] as number) >> shift;
      out[4 * i + 2] = (data[i * samples + 2] as number) >> shift;
      out[4 * i + 3] = 255;
    }
    return { width, height, data: out };
  }
  if ((photometric === 0 || photometric === 1) && samples >= 1) {
    let lo = Infinity;
    let hi = -Infinity;
    if (bits > 8) {
      for (let i = 0; i < n; i++) {
        const v = data[i * samples] as number;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    } else {
      lo = 0;
      hi = bits < 8 ? 2 ** bits - 1 : 255;
    }
    const span = hi > lo ? hi - lo : 1;
    for (let i = 0; i < n; i++) {
      const g = (255 * ((data[i * samples] as number) - lo)) / span;
      out[4 * i] = g;
      out[4 * i + 1] = g;
      out[4 * i + 2] = g;
      out[4 * i + 3] = 255;
    }
    return { width, height, data: out };
  }
  return {
    error:
      'This TIFF uses a colour layout (such as a palette) that this site cannot read. Save it as a grayscale or RGB TIFF, or as PNG.',
  };
}
