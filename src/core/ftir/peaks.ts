/** One peak found in a spectrum. Wavenumber in cm⁻¹. */
export interface FtirPeak {
  /** Position of the maximum, refined with a parabola through the three highest points. */
  wavenumber: number;
  /** Absorbance at the highest data point of the peak (same unit as the spectrum). */
  height: number;
  /** Height above the higher of the two surrounding valleys. */
  prominence: number;
  /** Height as a percentage of the highest picked peak. */
  relative: number;
}

export interface PeakOptions {
  /** Smallest prominence to keep, in the unit of the spectrum. */
  minProminence: number;
  /** Search only between these wavenumbers (cm⁻¹). */
  fromCm?: number;
  toCm?: number;
}

/**
 * Peaks of an absorbance spectrum: local maxima whose prominence is at least minProminence.
 * Prominence is the height of the peak above the higher of its two bases, where each base is the
 * lowest point between the peak and the next higher point on that side (or the end of the data);
 * this is the usual topographic definition. The position is the vertex of the parabola through
 * the maximum and its two neighbours (kept between them), which refines it below the data step.
 * Peaks are returned in order of increasing wavenumber.
 */
export function pickPeaks(x: Float64Array, y: Float64Array, options: PeakOptions): FtirPeak[] {
  const n = y.length;
  const found: Omit<FtirPeak, 'relative'>[] = [];
  const from = options.fromCm ?? -Infinity;
  const to = options.toCm ?? Infinity;
  for (let i = 1; i < n - 1; i++) {
    const yi = y[i] as number;
    if (!(yi > (y[i - 1] as number) && yi >= (y[i + 1] as number))) continue;
    const xi = x[i] as number;
    if (xi < from || xi > to) continue;
    let leftMin = yi;
    for (let j = i - 1; j >= 0 && (y[j] as number) <= yi; j--)
      leftMin = Math.min(leftMin, y[j] as number);
    let rightMin = yi;
    for (let j = i + 1; j < n && (y[j] as number) <= yi; j++)
      rightMin = Math.min(rightMin, y[j] as number);
    const prominence = yi - Math.max(leftMin, rightMin);
    if (!(prominence >= options.minProminence)) continue;
    found.push({ wavenumber: vertex(x, y, i), height: yi, prominence });
  }
  const top = found.reduce((m, p) => Math.max(m, p.height), 0);
  return found.map((p) => ({ ...p, relative: top > 0 ? (100 * p.height) / top : 0 }));
}

function vertex(x: Float64Array, y: Float64Array, i: number): number {
  const [x0, x1, x2] = [x[i - 1] as number, x[i] as number, x[i + 1] as number];
  const [y0, y1, y2] = [y[i - 1] as number, y[i] as number, y[i + 1] as number];
  const d1 = (y1 - y0) / (x1 - x0);
  const d2 = (y2 - y1) / (x2 - x1);
  const curvature = (d2 - d1) / ((x2 - x0) / 2);
  if (!(curvature < 0)) return x1;
  const xv = (x0 + x1) / 2 - d1 / curvature;
  return Math.min(Math.max(xv, x0), x2);
}
