import type { ComponentChildren } from 'preact';

/** One line on a plot. x must be increasing. */
export interface PlotSeries {
  id: string;
  name: string;
  x: Float64Array;
  /** Values as drawn (after normalising and offsetting). */
  y: Float64Array;
  /** Original values, shown in the hover readout. */
  readoutY: Float64Array;
  /** Unit of readoutY, for example "counts". */
  readoutUnit: string;
  /** Index into the plot palette. */
  colorIndex: number;
  /** Draw as a dashed line (for example a background curve). */
  dashed?: boolean;
}

/** A point drawn as a small circle, in data units. */
export interface PlotMarker {
  x: number;
  y: number;
}

export interface AxisLabels {
  x: ComponentChildren;
  y: ComponentChildren;
}

export type Domain = readonly [number, number];
