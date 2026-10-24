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
  /** Leave out of the legend and the hover readout (for example the 2nd…nth fit component). */
  quiet?: boolean;
}

/** A point drawn as a small circle, in data units. */
export interface PlotMarker {
  x: number;
  y: number;
}

/** A shaded x range (for example one mass loss step) with a short label at its top, in data units. */
export interface PlotBand {
  fromX: number;
  toX: number;
  label: string;
}

export interface AxisLabels {
  x: ComponentChildren;
  y: ComponentChildren;
  /** Number the y axis, for quantities with real units such as a width in degrees. */
  yValues?: boolean;
  /**
   * Reversed x axis, as for wavenumber (high on the left). The series are given as −x so x still
   * increases; tick labels, the readout and the range boxes show the positive value.
   */
  reversed?: boolean;
}

export type Domain = readonly [number, number];
