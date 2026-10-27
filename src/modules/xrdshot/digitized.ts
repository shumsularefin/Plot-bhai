import {
  calibrationError,
  calibrationWarnings,
  degreesPerPixel,
  type Calibration,
} from '../../core/digitize/calibration';
import { applyEdits, toPattern, type DigitizedPattern } from '../../core/digitize/curve';
import { extractCurve, type ExtractResult } from '../../core/digitize/extract';
import type { Point } from '../../core/particles/geometry';
import type { ShotData } from './data';
import type { ShotImage } from './prepare';

/** The calibration from the four marks, or the reason it cannot be made yet. */
export function calibrationOf(data: ShotData): { calibration: Calibration } | { problem: string } {
  const { x1, x2, y1, y2 } = data.marks;
  const missing = [
    [x1, 'first 2θ point'],
    [x2, 'second 2θ point'],
    [y1, 'first intensity point'],
    [y2, 'second intensity point'],
  ].filter(([m]) => !(m as (typeof data.marks)['x1']).at);
  if (missing.length > 0)
    return { problem: `Mark the ${missing.map(([, name]) => name).join(', ')} on the image.` };
  const value = (v: number | null) => v ?? NaN;
  const calibration: Calibration = {
    x: [
      { at: x1.at as Point, value: value(x1.value) },
      { at: x2.at as Point, value: value(x2.value) },
    ],
    y: [
      { at: y1.at as Point, value: value(y1.value) },
      { at: y2.at as Point, value: value(y2.value) },
    ],
    yScale: data.yScale,
  };
  const error = calibrationError(calibration);
  return error ? { problem: error } : { calibration };
}

export { calibrationWarnings };

export interface Digitization {
  extraction: ExtractResult;
  /** Traced points after the user's corrections (image pixels). */
  points: Point[];
  pattern: DigitizedPattern | null;
  warnings: string[];
}

/** Traces the curve and converts it. Null until a curve colour and a calibration exist. */
export function digitize(
  data: ShotData,
  image: ShotImage,
  calibration: Calibration | null,
): Digitization | null {
  const { curve } = data;
  if (!curve.color || curve.seeds.length === 0) return null;
  const extraction = extractCurve(image.pixels, {
    color: curve.color,
    tolerance: curve.tolerance,
    removeStraightLines: curve.removeLines,
    seeds: curve.seeds,
    ...(data.crop && { region: data.crop }),
  });
  const points = applyEdits(extraction.points, { erased: curve.erased, added: curve.added });
  const pattern = calibration ? toPattern(points, calibration) : null;
  const warnings: string[] = [];
  if (points.length < 20)
    warnings.push(
      'Only a few points were found. Click right on the curve, raise the colour tolerance, or add a start point on each part the trace missed.',
    );
  const width = (data.crop?.width ?? image.width) || 1;
  if (extraction.missingColumns > 0.2 * width)
    warnings.push(
      `The trace covers ${Math.round(100 * (1 - extraction.missingColumns / width))} % of the plot width. If part of the curve is missing, click "Add a start point" on it.`,
    );
  if (pattern && calibration) {
    if (pattern.gaps.length > 0)
      warnings.push(
        `No curve was found at ${pattern.gaps.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}°`).join(', ')}; these stretches are bridged by straight lines. Check them on the image.`,
      );
    const step = degreesPerPixel(calibration);
    warnings.push(
      `One image pixel is ${step.toFixed(3)}° 2θ, so peaks narrower than about ${(5 * step).toFixed(2)}° (5 pixels) have poorly known widths. A larger or sharper image gives better widths.`,
    );
    if (extraction.lineWidth >= 3)
      warnings.push(
        `The curve is drawn ${extraction.lineWidth} pixels thick, which rounds off the tops of narrow peaks: their heights come out a few per cent low and their widths a little wide.`,
      );
    if (pattern.intensity.some((v) => v < 0) && data.yScale === 'linear')
      warnings.push('Some intensities came out below zero. Check the intensity calibration.');
  }
  return { extraction, points, pattern, warnings };
}
