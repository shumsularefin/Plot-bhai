import { detectPeaks, type DetectedPeak, type DetectionOptions } from './detect';
import { regionValue, type RegionFit } from './fit';

/**
 * Peaks the fit has missed: maxima of the residual (data − fitted total) inside the fitted
 * regions that pass the same tests as automatic detection.
 *
 * An unfitted peak or shoulder leaves a positive hump in the residual (the straight background
 * of its region tilts or lifts to take part of it, which is why it is worth adding). For each
 * region, peaks of r_i = y_i − y_fit(2θ_i) are found with detectPeaks (topographic prominence),
 * with these tests, all taken from the detection settings so the rule matches step 5's search:
 * - prominence ≥ prominencePercent % of the range of the whole pattern (not of the residual);
 * - prominence ≥ minSnr × the local noise of the residual (second differences, see noise.ts);
 * - width at half prominence ≥ minWidthSteps data steps;
 * - the residual at the maximum is positive (a dip means too much model, not a missing peak);
 * - no existing peak within minSeparationDeg.
 *
 * x: 2θ in degrees, increasing; y: intensity in the units of the fit. Returns the candidates
 * sorted by position. These are suggestions to check by eye, not detections.
 */
export function missedPeaks(
  x: Float64Array,
  y: Float64Array,
  regions: readonly RegionFit[],
  detection: DetectionOptions,
): DetectedPeak[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of y) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const threshold = ((hi - lo) * detection.prominencePercent) / 100;
  const existing = regions.flatMap((r) => r.peaks.map((p) => p.center));
  const found: DetectedPeak[] = [];
  for (const region of regions) {
    const xs: number[] = [];
    const rs: number[] = [];
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      if (v < region.start || v > region.end) continue;
      xs.push(v);
      rs.push((y[i] as number) - regionValue(region, v));
    }
    if (xs.length < 5) continue;
    const residual = Float64Array.from(rs);
    let rLo = Infinity;
    let rHi = -Infinity;
    for (const v of residual) {
      if (v < rLo) rLo = v;
      if (v > rHi) rHi = v;
    }
    if (!(rHi > rLo)) continue;
    const peaks = detectPeaks(Float64Array.from(xs), residual, {
      ...detection,
      // The same absolute threshold as detection on the pattern, as a percentage of this range.
      prominencePercent: Math.min(100, (100 * threshold) / (rHi - rLo)),
    });
    for (const p of peaks) {
      if (p.height <= 0) continue;
      if (existing.some((c) => Math.abs(c - p.center) < detection.minSeparationDeg)) continue;
      found.push(p);
    }
  }
  return found.sort((a, b) => a.center - b.center);
}
