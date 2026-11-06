import {
  fitEllipse,
  greyStats,
  type EllipseFit,
  type GreyStats,
} from '../../core/particles/detect/measure';
import { runsBounds, type Runs } from '../../core/particles/detect/regions';
import type { MeasureGroup, Particle } from './data';
import { shapeFor } from './particleView';

/** The groups offered, in ImageJ's order and with its names where it has one. */
export const MEASURE_GROUPS: { group: MeasureGroup; label: string; hint: string }[] = [
  { group: 'area', label: 'Area', hint: 'Pixel count, in px² or nm² / µm².' },
  { group: 'perimeter', label: 'Perimeter', hint: 'Length of the outline, corners cut.' },
  { group: 'centroid', label: 'Centroid', hint: 'X and Y of the centre of the particle.' },
  {
    group: 'bounds',
    label: 'Bounding rectangle',
    hint: 'Left, top, width and height of the box around it.',
  },
  {
    group: 'ellipse',
    label: 'Fit ellipse',
    hint: 'Major and minor axis and angle of the ellipse with the same area and spread.',
  },
  {
    group: 'shape',
    label: 'Shape descriptors',
    hint: 'Aspect ratio and roundness of the ellipse, and solidity.',
  },
  { group: 'feret', label: 'Feret angle', hint: 'Direction of the longest caliper.' },
  {
    group: 'grey',
    label: 'Mean, standard deviation and modal grey value',
    hint: 'Of the original image.',
  },
  { group: 'minmax', label: 'Min and max grey value', hint: 'Of the original image.' },
  { group: 'median', label: 'Median grey value', hint: 'Of the original image.' },
  {
    group: 'intden',
    label: 'Integrated density',
    hint: 'Sum of grey values (RawIntDen) and area × mean (IntDen).',
  },
  {
    group: 'moments',
    label: 'Skewness and kurtosis',
    hint: 'Of the grey values, from their moments.',
  },
];

/** Groups that read grey values, so they need the image. */
export const GREY_GROUPS: ReadonlySet<MeasureGroup> = new Set<MeasureGroup>([
  'grey',
  'minmax',
  'median',
  'intden',
  'moments',
]);

/** How a column's value is shown: a length or area converts with the scale; the others do not. */
export type ColumnKind = 'length' | 'area' | 'angle' | 'number';

export interface MeasureColumn {
  /** Short header with its unit added by the caller for lengths and areas. */
  header: string;
  kind: ColumnKind;
  /** Value in original pixels (length), original px² (area), degrees or plain numbers. */
  value: (p: Particle) => number;
}

export interface ColumnContext {
  /** Working copy size divided by original size. */
  scale: number;
  /** The working copy as grayscale (unadjusted), for grey-value groups; null when not needed. */
  gray: { gray: Uint8Array; width: number } | null;
  /** Length of one original pixel in nm, or null: used for IntDen's calibrated area. */
  nmPerPixel: number | null;
}

const ellipses = new WeakMap<Runs, EllipseFit>();
const ellipseOf = (runs: Runs) => {
  let fit = ellipses.get(runs);
  if (!fit) {
    fit = fitEllipse(runs);
    ellipses.set(runs, fit);
  }
  return fit;
};

/** The columns of the chosen groups, in the order of MEASURE_GROUPS. */
export function measureColumns(
  groups: readonly MeasureGroup[],
  context: ColumnContext,
): MeasureColumn[] {
  const { scale } = context;
  const greys = new WeakMap<Runs, GreyStats>();
  const grey = (p: Particle): GreyStats => {
    let stats = greys.get(p.runs);
    if (!stats) {
      stats = context.gray
        ? greyStats(p.runs, context.gray.gray, context.gray.width)
        : greyStats(new Int32Array(), new Uint8Array(), 1);
      greys.set(p.runs, stats);
    }
    return stats;
  };
  const area = (p: Particle) => shapeFor(p.runs).area / scale ** 2;
  const all: Record<MeasureGroup, MeasureColumn[]> = {
    area: [{ header: 'Area', kind: 'area', value: area }],
    perimeter: [
      { header: 'Perimeter', kind: 'length', value: (p) => shapeFor(p.runs).perimeter / scale },
    ],
    centroid: [
      { header: 'X', kind: 'length', value: (p) => shapeFor(p.runs).cx / scale },
      { header: 'Y', kind: 'length', value: (p) => shapeFor(p.runs).cy / scale },
    ],
    bounds: [
      { header: 'BX', kind: 'length', value: (p) => runsBounds(p.runs).x0 / scale },
      { header: 'BY', kind: 'length', value: (p) => runsBounds(p.runs).y0 / scale },
      {
        header: 'Width',
        kind: 'length',
        value: (p) => {
          const b = runsBounds(p.runs);
          return (b.x1 - b.x0) / scale;
        },
      },
      {
        header: 'Height',
        kind: 'length',
        value: (p) => {
          const b = runsBounds(p.runs);
          return (b.y1 - b.y0) / scale;
        },
      },
    ],
    ellipse: [
      { header: 'Major', kind: 'length', value: (p) => ellipseOf(p.runs).major / scale },
      { header: 'Minor', kind: 'length', value: (p) => ellipseOf(p.runs).minor / scale },
      { header: 'Angle', kind: 'angle', value: (p) => ellipseOf(p.runs).angle },
    ],
    shape: [
      {
        header: 'AR (ellipse)',
        kind: 'number',
        value: (p) => {
          const e = ellipseOf(p.runs);
          return e.minor > 0 ? e.major / e.minor : Number.NaN;
        },
      },
      {
        header: 'Round',
        kind: 'number',
        value: (p) => {
          const e = ellipseOf(p.runs);
          return e.major > 0 ? (4 * shapeFor(p.runs).area) / (Math.PI * e.major ** 2) : Number.NaN;
        },
      },
      {
        header: 'Solidity',
        kind: 'number',
        value: (p) => {
          const s = shapeFor(p.runs);
          return s.convexArea > 0 ? Math.min(1, s.area / s.convexArea) : Number.NaN;
        },
      },
    ],
    feret: [{ header: 'FeretAngle', kind: 'angle', value: (p) => shapeFor(p.runs).feretAngle }],
    grey: [
      { header: 'Mean', kind: 'number', value: (p) => grey(p).mean },
      { header: 'StdDev', kind: 'number', value: (p) => grey(p).sd },
      { header: 'Mode', kind: 'number', value: (p) => grey(p).mode },
    ],
    minmax: [
      { header: 'Min', kind: 'number', value: (p) => grey(p).min },
      { header: 'Max', kind: 'number', value: (p) => grey(p).max },
    ],
    median: [{ header: 'Median', kind: 'number', value: (p) => grey(p).median }],
    intden: [
      {
        header: 'IntDen',
        kind: 'number',
        // Area in the calibrated unit (nm²) when there is a scale, as ImageJ does; else px².
        value: (p) => area(p) * (context.nmPerPixel ?? 1) ** 2 * grey(p).mean,
      },
      { header: 'RawIntDen', kind: 'number', value: (p) => grey(p).sum },
    ],
    moments: [
      { header: 'Skew', kind: 'number', value: (p) => grey(p).skewness },
      { header: 'Kurt', kind: 'number', value: (p) => grey(p).kurtosis },
    ],
  };
  return MEASURE_GROUPS.filter((g) => groups.includes(g.group)).flatMap((g) => all[g.group]);
}
