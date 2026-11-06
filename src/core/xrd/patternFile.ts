import type { Pattern } from './types';

/**
 * Plain-text pattern files for other programs (GSAS-II, FullProf, Origin and others):
 *
 *   .xy    two columns: 2θ (degrees), intensity
 *   .xye   three columns: 2θ (degrees), intensity, σ (standard uncertainty of the intensity,
 *          same unit as the intensity)
 *
 * Lines starting with # are comments (GSAS-II and this site both skip them). Numbers are written
 * with JavaScript's shortest exact form, so reading the file back gives the same numbers.
 */

export type SigmaResult =
  { ok: true; sigma: Float64Array; how: string } | { ok: false; reason: string };

/**
 * Standard uncertainty of each intensity from counting statistics.
 *
 * Detector counts N follow Poisson statistics, so var(N) = N and σ(N) = √N (counts).
 * For a count rate R = N / t (cps) measured for t seconds per step, σ(R) = √N / t = √(R·t) / t.
 * A point with zero counts gets σ = 1 count (σ = 1/t for a rate), the convention GSAS-II uses
 * (its readers weight each point by 1 / max(1, I)), because σ = 0 would give the point
 * infinite weight in a fit.
 *
 * Uses the σ stored in the file when there is one. Refuses (with the reason) when the
 * intensities cannot be raw counts: negative values, or a rate without a known counting time.
 */
export function countingSigma(
  pattern: Pick<Pattern, 'intensity' | 'sigma' | 'intensityUnit' | 'countingTimeS'>,
): SigmaResult {
  if (pattern.sigma)
    return { ok: true, sigma: pattern.sigma, how: 'sigma as given in the loaded file' };
  const { intensity } = pattern;
  if (intensity.some((v) => v < 0)) {
    return {
      ok: false,
      reason:
        'Some intensities are negative, so they are not raw counts and σ cannot be worked out from counting statistics.',
    };
  }
  if (pattern.intensityUnit === 'counts') {
    return {
      ok: true,
      sigma: intensity.map((n) => (n > 0 ? Math.sqrt(n) : 1)),
      how: 'sigma = sqrt(counts) (Poisson counting statistics); points with 0 counts have sigma = 1',
    };
  }
  const t = pattern.countingTimeS;
  if (t !== undefined && t > 0) {
    return {
      ok: true,
      sigma: intensity.map((r) => (r > 0 ? Math.sqrt(r * t) / t : 1 / t)),
      how: `sigma = sqrt(cps * t) / t with t = ${t} s per step (Poisson counting statistics); points with 0 counts have sigma = 1/t`,
    };
  }
  return {
    ok: false,
    reason:
      'The intensities are a count rate (cps) and the counting time per step is not known, so σ cannot be worked out. Set the unit to counts in Upload if the values are raw counts.',
  };
}

export interface PatternFileOptions {
  /** Header lines (without the # mark) describing where the numbers came from. */
  header: string[];
  /** Kα1 wavelength in Å, written so other programs and this site can read it back. */
  wavelengthA?: number;
  /** Intensity column name with its unit, for example "intensity (counts)". */
  intensityLabel: string;
}

/** Writes 2θ (degrees) and intensity as .xy text. */
export function patternXy(
  twoTheta: Float64Array,
  intensity: Float64Array,
  options: PatternFileOptions,
): string {
  const lines = headerLines(options, ['2theta (deg)', options.intensityLabel]);
  for (let i = 0; i < twoTheta.length; i++) lines.push(`${twoTheta[i]} ${intensity[i]}`);
  return `${lines.join('\n')}\n`;
}

/** Writes 2θ (degrees), intensity and σ as .xye text. */
export function patternXye(
  twoTheta: Float64Array,
  intensity: Float64Array,
  sigma: Float64Array,
  options: PatternFileOptions,
): string {
  const lines = headerLines(options, ['2theta (deg)', options.intensityLabel, 'sigma (same unit)']);
  for (let i = 0; i < twoTheta.length; i++) {
    lines.push(`${twoTheta[i]} ${intensity[i]} ${sigma[i]}`);
  }
  return `${lines.join('\n')}\n`;
}

function headerLines(options: PatternFileOptions, columns: string[]): string[] {
  const lines = options.header.map((line) => `# ${line}`);
  if (options.wavelengthA !== undefined) lines.push(`# Wavelength: ${options.wavelengthA}`);
  lines.push(`# Columns: ${columns.join(', ')}`);
  return lines;
}
