/*
 * Figure styling: how a plot looks, kept apart from the data it shows. Nothing here changes a
 * value, a fit or a result; it only decides colours, line styles, fills, annotations, axis
 * titles and limits, grid, legend and label text. The same style is used on screen and in every
 * exported file, so what is shown is what is saved.
 */

export type DashStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';

export interface SeriesStyle {
  /** Line colour as #rrggbb; the palette colour when missing. */
  color?: string | undefined;
  /** Line width as a multiple of the figure's line width. */
  width?: number;
  dash?: DashStyle;
  /** Line opacity, 0 to 1. */
  opacity?: number;
  /** Fill under the curve (to zero, or the bottom of the plot), or between it and another series (its id). */
  fill?: 'none' | 'below' | { between: string };
  /** Fill opacity, 0 to 1. */
  fillOpacity?: number;
  /** Name in the legend. */
  label?: string;
  /** Leave the series out of the figure. */
  hidden?: boolean;
}

export type AnnotationKind = 'text' | 'arrow' | 'marker' | 'vline' | 'hline' | 'region';

/**
 * Something drawn on top of the data. Positions are in the units shown on the axes (for a
 * reversed wavenumber axis, the positive wavenumber). An arrow points from (x2, y2) to (x, y);
 * a region spans x to x2.
 */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  text: string;
  /** #rrggbb, or '' for automatic (black in exports, the text colour on screen). */
  color: string;
  /** Text size as a multiple of the figure's font size. */
  size: number;
  /** Opacity of a shaded region, 0 to 1. */
  opacity: number;
}

export interface AxisStyle {
  /** Axis titles; null keeps the tool's title. */
  xTitle: string | null;
  yTitle: string | null;
  /** Fixed y limits; null fits the visible data. (The x range is set with the range boxes.) */
  yMin: number | null;
  yMax: number | null;
  ticks: 'in' | 'out';
  grid: 'none' | 'x' | 'y' | 'both';
  /** Numbers on the y axis: the tool's choice, or always shown, or never. */
  yValues: 'auto' | 'show' | 'hide';
}

export type LegendPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface FigureStyle {
  /** Per series id. */
  series: Record<string, SeriesStyle>;
  annotations: Annotation[];
  axes: AxisStyle;
  legend: { show: boolean; position: LegendPosition };
  /** Peak labels: shown or not, and edited text keyed by the label's x position (see labelKey). */
  peakLabels: { show: boolean; text: Record<string, string> };
}

export const DEFAULT_FIGURE: FigureStyle = {
  series: {},
  annotations: [],
  axes: {
    xTitle: null,
    yTitle: null,
    yMin: null,
    yMax: null,
    ticks: 'in',
    grid: 'none',
    yValues: 'auto',
  },
  legend: { show: true, position: 'top-right' },
  peakLabels: { show: true, text: {} },
};

/** A stored style merged over the defaults, so styles saved by older versions keep working. */
export function resolveFigure(saved: Partial<FigureStyle> | undefined): FigureStyle {
  if (!saved) return DEFAULT_FIGURE;
  return {
    series: saved.series ?? {},
    annotations: saved.annotations ?? [],
    axes: { ...DEFAULT_FIGURE.axes, ...saved.axes },
    legend: { ...DEFAULT_FIGURE.legend, ...saved.legend },
    peakLabels: { ...DEFAULT_FIGURE.peakLabels, ...saved.peakLabels },
  };
}

/** Key of a peak label for edited text: its x position, rounded so tiny refits keep the edit. */
export const labelKey = (x: number): string => x.toFixed(3);

/** SVG stroke-dasharray for a dash style and line width, or undefined for a solid line. */
export function dashArray(dash: DashStyle | undefined, width: number): string | undefined {
  switch (dash) {
    case 'dashed':
      return `${width * 4} ${width * 3}`;
    case 'dotted':
      return `${width * 0.01} ${width * 2.2}`;
    case 'dash-dot':
      return `${width * 5} ${width * 2.5} ${width * 0.01} ${width * 2.5}`;
    default:
      return undefined;
  }
}

/** Default colour of new annotations: automatic (see Annotation.color). */
export const ANNOTATION_COLOR = '';

/** A new annotation of a kind at a position (shown units), with sensible text and size. */
export function newAnnotation(
  kind: AnnotationKind,
  x: number,
  y: number,
  second?: { x: number; y: number },
): Annotation {
  const text: Record<AnnotationKind, string> = {
    text: 'Text',
    arrow: '',
    marker: '',
    vline: '',
    hline: '',
    region: '',
  };
  return {
    id: crypto.randomUUID(),
    kind,
    x,
    y,
    ...(second && { x2: second.x, y2: second.y }),
    text: text[kind],
    color: ANNOTATION_COLOR,
    size: 1,
    opacity: kind === 'region' ? 0.15 : 1,
  };
}

/** How many clicks on the plot an annotation needs: two for arrows (tail, then head) and regions. */
export const clicksFor = (kind: AnnotationKind): 1 | 2 =>
  kind === 'arrow' || kind === 'region' ? 2 : 1;

export const ANNOTATION_LABELS: Record<AnnotationKind, string> = {
  text: 'Text',
  arrow: 'Arrow',
  marker: 'Marker',
  vline: 'Vertical line',
  hline: 'Horizontal line',
  region: 'Shaded region',
};

/** Series as styled: hidden ones left out, legend names replaced. */
export function styledSeries<S extends { id: string; name: string }>(
  series: readonly S[],
  figure: FigureStyle | undefined,
): S[] {
  if (!figure) return [...series];
  return series
    .filter((s) => !figure.series[s.id]?.hidden)
    .map((s) => {
      const label = figure.series[s.id]?.label;
      return label ? { ...s, name: label } : s;
    });
}

/** Axis titles and the y-number choice, as styled. */
export function styledLabels<L extends { x: unknown; y: unknown; yValues?: boolean }>(
  labels: L,
  figure: FigureStyle | undefined,
): L {
  if (!figure) return labels;
  const { xTitle, yTitle, yValues } = figure.axes;
  return {
    ...labels,
    ...(xTitle !== null && xTitle.trim() !== '' && { x: xTitle }),
    ...(yTitle !== null && yTitle.trim() !== '' && { y: yTitle }),
    ...(yValues !== 'auto' && { yValues: yValues === 'show' }),
  };
}

/** Peak labels as styled: none when switched off, edited text where the user changed it. */
export function styledPeakLabels<P extends { labels: readonly { x: number; text: string }[] }>(
  set: P | undefined,
  figure: FigureStyle | undefined,
): P | undefined {
  if (!set || !figure) return set;
  if (!figure.peakLabels.show) return undefined;
  const edits = figure.peakLabels.text;
  return {
    ...set,
    labels: set.labels
      .map((l) => {
        const edited = edits[labelKey(l.x)];
        return edited === undefined ? l : { ...l, text: edited };
      })
      .filter((l) => l.text.trim() !== ''),
  };
}

/** The y range with the user's fixed limits applied over the automatic one. */
export function styledYDomain(
  auto: readonly [number, number],
  figure: FigureStyle | undefined,
): readonly [number, number] {
  if (!figure) return auto;
  const lo = figure.axes.yMin ?? auto[0];
  const hi = figure.axes.yMax ?? auto[1];
  return hi > lo ? [lo, hi] : auto;
}
