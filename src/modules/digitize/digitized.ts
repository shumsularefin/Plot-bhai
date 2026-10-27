import {
  calibrationError,
  calibrationWarnings,
  xPerPixel,
  type AxisNames,
  type Calibration,
} from '../../core/digitize/calibration';
import { applyEdits, toCurve, type DigitizedCurve } from '../../core/digitize/curve';
import { extractCurve, type ExtractResult } from '../../core/digitize/extract';
import type { Point } from '../../core/particles/geometry';
import type { DataMessage } from '../../core/xrd/types';
import type { ShotData } from './data';
import type { ShotImage } from './prepare';
import type { DigitizeTarget } from './target';

/** The calibration from the four marks, or the reason it cannot be made yet. */
export function calibrationOf(
  data: ShotData,
  names: AxisNames,
): { calibration: Calibration } | { problem: string } {
  const { x1, x2, y1, y2 } = data.marks;
  const missing = [
    [x1, `first ${names.x} point`],
    [x2, `second ${names.x} point`],
    [y1, `first ${names.y} point`],
    [y2, `second ${names.y} point`],
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
  const error = calibrationError(calibration, names);
  return error ? { problem: error } : { calibration };
}

export { calibrationWarnings };

export interface Digitization {
  extraction: ExtractResult;
  /** Traced points after the user's corrections (image pixels). */
  points: Point[];
  curve: DigitizedCurve | null;
  warnings: string[];
}

/** Traces the curve and converts it. Null until a curve colour and a calibration exist. */
export function digitize(
  data: ShotData,
  image: ShotImage,
  calibration: Calibration | null,
  axes: DigitizeTarget['axes'],
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
  const converted = calibration ? toCurve(points, calibration) : null;
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
  if (converted && calibration) {
    const x = (v: number) => `${v.toFixed(axes.xDigits)}${axes.xUnit}`;
    if (converted.gaps.length > 0)
      warnings.push(
        `No curve was found at ${converted.gaps.map(([a, b]) => `${a.toFixed(axes.xDigits)}–${x(b)}`).join(', ')}; these stretches are bridged by straight lines. Check them on the image.`,
      );
    const step = xPerPixel(calibration);
    warnings.push(
      `One image pixel is ${x(step)} along the ${axes.x} axis, so peaks narrower than about ${x(5 * step)} (5 pixels) have poorly known widths. A larger or sharper image gives better widths.`,
    );
    if (extraction.lineWidth >= 3)
      warnings.push(
        `The curve is drawn ${extraction.lineWidth} pixels thick, which rounds off the tops of narrow peaks: their heights come out a few per cent low and their widths a little wide.`,
      );
    if (converted.y.some((v) => v < 0) && data.yScale === 'linear' && !axes.yMayBeNegative)
      warnings.push(`Some ${axes.y} values came out below zero. Check the ${axes.y} calibration.`);
  }
  return { extraction, points, curve: converted, warnings };
}

/** Notes that travel with a digitized curve into the analysis tool, so it is never taken for a measurement. */
export function digitizedNotes(curve: DigitizedCurve, axes: DigitizeTarget['axes']): DataMessage[] {
  const x = (v: number) => `${v.toFixed(axes.xDigits)}${axes.xUnit}`;
  return [
    {
      level: 'warning',
      text: 'Digitized from a figure image: positions, heights and widths are approximate, and the y values are in whatever unit the figure used.',
    },
    ...curve.gaps.map(([a, b]) => ({
      level: 'warning' as const,
      text: `No curve was found between ${x(a)} and ${x(b)}; that stretch is a straight line.`,
    })),
  ];
}

/** The name the curve gets in the analysis tool. */
export function curveName(data: ShotData): string {
  return data.name.trim() || (data.image?.name.replace(/\.[^.]+$/, '') ?? 'Digitized curve');
}
