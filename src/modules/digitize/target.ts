import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { AxisNames } from '../../core/digitize/calibration';
import type { DigitizedCurve } from '../../core/digitize/curve';
import type { Rgb } from '../../core/digitize/extract';
import type { Point, Rect } from '../../core/particles/geometry';
import type { AxisLabels } from '../../ui/plot/types';
import type { MarkId, ShotData } from './data';
import type { Digitization } from './digitized';

/** A generated example figure with the marks and trace start a careful user would choose. */
export interface ExampleFigure {
  blob: Blob;
  marks: Record<MarkId, { at: Point; value: number }>;
  seed: Point;
  color: Rgb;
  crop: Rect;
  /** Says what was drawn, and that it is synthetic. */
  description: string;
}

/** What the graph-image reader needs to know about the tool the curve is for. */
export interface DigitizeTarget {
  /** The analysis tool, as named in buttons: "XRD", "FTIR", "UV-Vis", "TGA or DSC". */
  tool: string;
  /** Hash route of the analysis tool. */
  route: string;
  /** Keys of the saved reader state and of the stored image. */
  storeKey: string;
  imageKey: string;
  /** What kind of figure is loaded, for the first step: "an XRD pattern". */
  figure: string;
  axes: AxisNames & {
    /** Short symbols for the calibration marks, for example 2θ and I. */
    xShort: string;
    yShort: string;
    /** Unit of x as written after a number, for example "°" or " cm⁻¹". */
    xUnit: string;
    /** Column header of x in CSV files, ASCII only. */
    xCsv: string;
    /** Digits shown for x values. */
    xDigits: number;
    /** True when values below zero are normal (heat flow), so they raise no warning. */
    yMayBeNegative: boolean;
  };
  /** Axis labels of the preview plot. Reversed axes are drawn high on the left. */
  labels: AxisLabels;
  example: () => Promise<ExampleFigure>;
  /** The last step: how the curve is added to the analysis. */
  Send: (props: SendProps) => ComponentChildren;
}

export interface SendProps {
  data: ShotData;
  curve: DigitizedCurve;
  result: Digitization;
}

const TargetContext = createContext<DigitizeTarget | null>(null);
export const TargetProvider = TargetContext.Provider;

/** The target of the reader that is open. */
export function useTarget(): DigitizeTarget {
  const target = useContext(TargetContext);
  if (!target) throw new Error('The graph-image reader was opened without a target.');
  return target;
}
