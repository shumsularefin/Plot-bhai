import type { ComponentChildren, SVGAttributes } from 'preact';
import { useId } from 'preact/hooks';
import { niceTicks } from './axes';
import { decimate, lowerBound, type Decimated } from './decimate';
import {
  dashArray,
  styledLabels,
  styledPeakLabels,
  styledSeries,
  styledYDomain,
  type Annotation,
  type FigureStyle,
} from './figure';
import { PRINT_COLORS } from './palette';
import { labelRoom, placeLabels, textWidth, type PeakLabelSet } from './peakLabels';
import type { AxisLabels, Domain, PlotBand, PlotMarker, PlotSeries } from './types';

/** Visual settings. All lengths are in the SVG's own units (px on screen, pt for export). */
export interface PlotStyle {
  fontSize: number;
  /** Data line width. */
  lineWidth: number;
  /** For export: explicit fonts and colours instead of the page's CSS. */
  print?: { fontFamily: string };
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Space around the plot area, sized from the font so labels never clip. */
export function plotMargins(fontSize: number, yValues = false): Margins {
  return {
    top: fontSize * 0.8,
    right: fontSize * 1.2,
    bottom: fontSize * 3.3,
    left: fontSize * (yValues ? 4.6 : 2.1),
  };
}

interface PlotSvgProps {
  series: readonly PlotSeries[];
  xDomain: Domain;
  width: number;
  height: number;
  style: PlotStyle;
  labels: AxisLabels;
  /** Number of columns to reduce the data to; use at least the output's pixel width. */
  samples: number;
  /** Draw a legend inside the plot (used for export; the screen shows an HTML legend). */
  legend?: boolean;
  /** Fixed y range; computed from the visible data when omitted. */
  yDomain?: Domain;
  markers?: readonly PlotMarker[];
  /** Shaded x ranges drawn behind the curves, each with its label at the top. */
  bands?: readonly PlotBand[];
  /** Text labels above peaks, and the key explaining them (the key is drawn in exports only). */
  peakLabels?: PeakLabelSet;
  /** Styling chosen in the figure editor (colours, fills, annotations, axes, legend). */
  figure?: FigureStyle;
  /** Extra attributes for the root element, for example physical width and height for export. */
  svgAttributes?: SVGAttributes<SVGSVGElement>;
  children?: ComponentChildren;
}

/**
 * y range of the data and markers visible between xDomain[0] and xDomain[1], padded a little
 * so lines do not touch the frame. extraTopFraction leaves room at the top (for a legend or
 * peak labels), extraBottomFraction at the bottom (for labels under minima).
 */
export function visibleYDomain(
  series: readonly PlotSeries[],
  xDomain: Domain,
  extraTopFraction = 0,
  markers: readonly PlotMarker[] = [],
  extraBottomFraction = 0,
): Domain {
  let lo = Infinity;
  let hi = -Infinity;
  for (const marker of markers) {
    if (marker.x < xDomain[0] || marker.x > xDomain[1]) continue;
    lo = Math.min(lo, marker.y);
    hi = Math.max(hi, marker.y);
  }
  for (const s of series) {
    const end = Math.min(s.y.length, lowerBound(s.x, xDomain[1]) + 1);
    for (let i = Math.max(0, lowerBound(s.x, xDomain[0]) - 1); i < end; i++) {
      const v = s.y[i] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi === lo) hi = lo + 1;
  const range = hi - lo;
  return [lo - (0.03 + extraBottomFraction) * range, hi + (0.06 + extraTopFraction) * range];
}

/**
 * Publication-style intensity plot: a closed frame, inward ticks on the bottom and top edges,
 * 2θ tick labels below, and no intensity numbers (arbitrary units). Used for both the screen
 * and exported files, so what is exported matches what is shown.
 */
export function PlotSvg(props: PlotSvgProps) {
  const { xDomain, width, height, style, samples, legend, markers, bands, figure } = props;
  const { svgAttributes, children } = props;
  const series = styledSeries(props.series, figure);
  const labels = styledLabels(props.labels, figure);
  const peakLabels = styledPeakLabels(props.peakLabels, figure);
  const clipId = `plot-clip-${useId()}`;
  const m = plotMargins(style.fontSize, labels.yValues);
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const [x0, x1] = xDomain;

  const lines = series.map((s) => decimate(s.x, s.y, x0, x1, samples));
  const lineHeight = style.fontSize * 1.3;
  const showLegend = legend === true && (figure?.legend.show ?? true);
  const position = figure?.legend.position ?? 'top-right';
  const legendAtBottom = position.startsWith('bottom');
  const legendAtLeft = position.endsWith('left');
  const legendSeries = showLegend ? series.filter((s) => !s.quiet) : [];
  const legendKey = showLegend && peakLabels ? peakLabels.key : [];
  const legendRows = (legendSeries.length > 1 ? legendSeries.length : 0) + legendKey.length;
  const legendHeight = legendRows > 0 ? legendRows * lineHeight + style.fontSize * 0.4 : 0;
  const below = peakLabels?.below === true;
  const labelSpace = peakLabels ? labelRoom(style.fontSize) : 0;
  const reserved = (legendAtBottom ? 0 : legendHeight) + (below ? 0 : labelSpace);
  const bottomReserved = (legendAtBottom ? legendHeight : 0) + (below ? labelSpace : 0);
  const legendTop = legendAtBottom ? innerH - legendHeight : 0;
  const usable = Math.max(innerH - reserved - bottomReserved, 1);
  const [y0, y1] = styledYDomain(
    props.yDomain ??
      visibleYDomain(series, xDomain, reserved / usable, markers, bottomReserved / usable),
    figure,
  );
  const px = (x: number) => ((x - x0) / (x1 - x0)) * innerW;
  const py = (y: number) => innerH - ((y - y0) / (y1 - y0)) * innerH;
  const digits = style.print ? 3 : 1;
  // NaN values leave a gap: the line stops and restarts after them.
  const pathOf = (line: Decimated) => {
    let d = '';
    let move = true;
    line.x.forEach((x, i) => {
      const y = line.y[i] as number;
      if (Number.isNaN(y)) {
        move = true;
        return;
      }
      d += `${move ? 'M' : 'L'}${px(x).toFixed(digits)} ${py(y).toFixed(digits)}`;
      move = false;
    });
    return d;
  };

  const placedLabels = (() => {
    const visible = (peakLabels?.labels ?? []).filter((l) => l.x >= x0 && l.x <= x1);
    // Labels under minima are placed by the same rule on the plot turned upside down.
    const flip = (y: number) => (below ? innerH - y : y);
    const placements = placeLabels(
      visible.map((l) => ({
        x: px(l.x),
        y: flip(py(l.y)),
        width: textWidth(l.text, style.fontSize),
      })),
      lineHeight,
      0,
    );
    return visible.map((label, i) => {
      const placed = placements[i] as (typeof placements)[number];
      return {
        label,
        placed: below
          ? { ...placed, baseline: innerH - placed.baseline + lineHeight * 0.6 }
          : placed,
      };
    });
  })();

  const tickLength = style.fontSize * 0.45;
  const xTickCount = Math.max(2, Math.round(innerW / (style.fontSize * 6)));
  const xTicks = labels.reversed
    ? niceTicks(-x1, -x0, xTickCount).map((t) => ({ value: -t.value, label: t.label }))
    : niceTicks(x0, x1, xTickCount);
  const allYTicks = niceTicks(y0, y1, Math.max(2, Math.round(innerH / (style.fontSize * 5))));
  const yTicks = labels.yValues ? allYTicks : [];
  const grid = figure?.axes.grid ?? 'none';
  const ticksOut = figure?.axes.ticks === 'out';
  const print = style.print;
  const ink = print ? '#000000' : undefined;
  const frameWidth = print ? 0.75 : 1;
  const text = print
    ? { 'font-family': print.fontFamily, 'font-size': style.fontSize, fill: ink }
    : {};
  const own = (s: PlotSeries) => figure?.series[s.id];
  const widthOf = (s: PlotSeries) => style.lineWidth * (own(s)?.width ?? 1);
  const dash = (s: PlotSeries) =>
    dashArray(own(s)?.dash ?? (s.dashed ? 'dashed' : 'solid'), widthOf(s));
  const color = (s: PlotSeries) =>
    own(s)?.color ?? (print ? PRINT_COLORS[s.colorIndex % PRINT_COLORS.length] : undefined);
  /** Inline style wins over the theme's CSS classes, so a chosen colour shows on screen too. */
  const lineStyle = (s: PlotSeries) => {
    const o = own(s);
    return o?.color || o?.opacity !== undefined
      ? {
          ...(o.color && { stroke: o.color }),
          ...(o.opacity !== undefined && { opacity: o.opacity }),
        }
      : undefined;
  };
  const fills = series.flatMap((s, i) => {
    const fill = own(s)?.fill;
    if (!fill || fill === 'none') return [];
    const line = lines[i] as Decimated;
    const points: [number, number][] = [];
    line.x.forEach((x, k) => {
      const y = line.y[k] as number;
      if (!Number.isNaN(y)) points.push([px(x), py(y)]);
    });
    if (points.length < 2) return [];
    let edge: [number, number][];
    if (fill === 'below') {
      const base = py(Math.min(Math.max(0, y0), y1));
      edge = [
        [(points[points.length - 1] as [number, number])[0], base],
        [(points[0] as [number, number])[0], base],
      ];
    } else {
      const j = series.findIndex((t) => t.id === fill.between);
      if (j < 0) return [];
      const other = lines[j] as Decimated;
      edge = [];
      for (let k = other.x.length - 1; k >= 0; k--) {
        const y = other.y[k] as number;
        if (!Number.isNaN(y)) edge.push([px(other.x[k] as number), py(y)]);
      }
    }
    const d = [...points, ...edge]
      .map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${x.toFixed(digits)} ${y.toFixed(digits)}`)
      .join('');
    return [
      {
        id: s.id,
        d: `${d}Z`,
        color: color(s),
        colorIndex: s.colorIndex,
        opacity: own(s)?.fillOpacity ?? 0.25,
      },
    ];
  });
  const annotations = figure?.annotations ?? [];
  /** Plotted x of an annotation stored in shown units (negative on a reversed axis). */
  const ax = (x: number) => px(labels.reversed ? -x : x);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      class={style.print ? undefined : 'plot-svg'}
      {...svgAttributes}
    >
      {print && <rect width={width} height={height} fill="#ffffff" />}
      <g transform={`translate(${m.left} ${m.top})`}>
        <clipPath id={clipId}>
          <rect width={innerW} height={innerH} />
        </clipPath>
        <g clip-path={`url(#${clipId})`} fill="none" stroke-linejoin="round" stroke-linecap="round">
          {bands?.map((b, i) => (
            <rect
              key={`band-${i}`}
              class={print ? undefined : 'plot-band'}
              x={px(Math.min(b.fromX, b.toX))}
              width={Math.max(0, px(Math.max(b.fromX, b.toX)) - px(Math.min(b.fromX, b.toX)))}
              y={0}
              height={innerH}
              fill={print ? (i % 2 === 0 ? '#e6e6e6' : '#f2f2f2') : undefined}
              stroke="none"
            />
          ))}
          {grid !== 'none' && (
            <g
              stroke={print ? '#cccccc' : undefined}
              class={print ? undefined : 'plot-grid'}
              stroke-width={frameWidth * 0.5}
            >
              {(grid === 'x' || grid === 'both') &&
                xTicks.map((t) => (
                  <path key={`gx${t.value}`} d={`M${px(t.value).toFixed(2)} 0V${innerH}`} />
                ))}
              {(grid === 'y' || grid === 'both') &&
                allYTicks.map((t) => (
                  <path key={`gy${t.value}`} d={`M0 ${py(t.value).toFixed(2)}H${innerW}`} />
                ))}
            </g>
          )}
          {annotations
            .filter((a) => a.kind === 'region')
            .map((a) => (
              <rect
                key={a.id}
                x={Math.min(ax(a.x), ax(a.x2 ?? a.x))}
                width={Math.abs(ax(a.x2 ?? a.x) - ax(a.x))}
                y={0}
                height={innerH}
                fill={a.color || (print ? '#000000' : 'currentColor')}
                fill-opacity={a.opacity}
                stroke="none"
              />
            ))}
          {fills.map((f) => (
            <path
              key={`fill-${f.id}`}
              class={
                print || f.color
                  ? undefined
                  : `plot-fill series-${f.colorIndex % PRINT_COLORS.length}`
              }
              d={f.d}
              fill={f.color ?? (print ? '#888888' : undefined)}
              fill-opacity={f.opacity}
              stroke="none"
            />
          ))}
          {series.map((s, i) => (
            <path
              key={s.id}
              class={print ? undefined : `plot-line series-${s.colorIndex % PRINT_COLORS.length}`}
              d={pathOf(lines[i] as Decimated)}
              stroke={color(s)}
              style={lineStyle(s)}
              stroke-width={widthOf(s)}
              stroke-dasharray={dash(s)}
            />
          ))}
          {annotations.map((a) => (
            <AnnotationLines
              key={a.id}
              a={a}
              fontFamily={print?.fontFamily}
              ink={print ? '#000000' : 'currentColor'}
              ax={ax}
              py={py}
              innerW={innerW}
              innerH={innerH}
              lineWidth={style.lineWidth}
              fontSize={style.fontSize}
            />
          ))}
          {bands?.map((b, i) => (
            <text
              key={`band-label-${i}`}
              class={print ? undefined : 'plot-text'}
              {...text}
              x={(px(Math.min(b.fromX, b.toX)) + px(Math.max(b.fromX, b.toX))) / 2}
              y={style.fontSize * 1.1}
              text-anchor="middle"
              stroke="none"
              fill={print ? ink : undefined}
            >
              {b.label}
            </text>
          ))}
          {markers?.map((m, i) => (
            <circle
              key={i}
              class={print ? undefined : 'plot-marker'}
              cx={px(m.x)}
              cy={py(m.y)}
              r={style.fontSize * 0.35}
              fill={print ? '#ffffff' : undefined}
              stroke={print ? ink : undefined}
              stroke-width={style.lineWidth}
            />
          ))}
        </g>

        <g class={print ? undefined : 'plot-ink'} stroke={ink} stroke-width={frameWidth}>
          <rect width={innerW} height={innerH} fill="none" />
          {xTicks.map((t) => (
            <path
              key={t.value}
              d={
                ticksOut
                  ? `M${px(t.value).toFixed(2)} ${innerH}v${tickLength}`
                  : `M${px(t.value).toFixed(2)} ${innerH}v${-tickLength}M${px(t.value).toFixed(2)} 0v${tickLength}`
              }
            />
          ))}
          {yTicks.map((t) => (
            <path
              key={t.value}
              d={
                ticksOut
                  ? `M0 ${py(t.value).toFixed(2)}h${-tickLength}`
                  : `M0 ${py(t.value).toFixed(2)}h${tickLength}M${innerW} ${py(t.value).toFixed(2)}h${-tickLength}`
              }
            />
          ))}
        </g>

        <g class={print ? undefined : 'plot-text'} {...text} text-anchor="middle">
          {xTicks.map((t) => (
            <text
              key={t.value}
              x={px(t.value)}
              y={innerH + style.fontSize * (ticksOut ? 1.65 : 1.25)}
            >
              {t.label}
            </text>
          ))}
          <text x={innerW / 2} y={innerH + style.fontSize * 2.75}>
            {labels.x}
          </text>
          <text
            transform={`translate(${-style.fontSize * (labels.yValues ? 4 : 0.7)} ${innerH / 2}) rotate(-90)`}
          >
            {labels.y}
          </text>
        </g>
        {yTicks.length > 0 && (
          <g class={print ? undefined : 'plot-text'} {...text} text-anchor="end">
            {yTicks.map((t) => (
              <text
                key={t.value}
                x={-style.fontSize * (ticksOut ? 0.8 : 0.4)}
                y={py(t.value)}
                dy="0.35em"
              >
                {t.label}
              </text>
            ))}
          </g>
        )}

        {legendHeight > 0 && (
          <g
            class={print ? undefined : 'plot-text'}
            {...text}
            text-anchor={legendAtLeft ? 'start' : 'end'}
          >
            {(legendSeries.length > 1 ? legendSeries : []).map((s, i) => {
              const y = legendTop + style.fontSize * 0.4 + (i + 0.5) * lineHeight;
              const swatch = style.fontSize * 1.6;
              const edge = legendAtLeft ? style.fontSize * 0.6 : innerW - style.fontSize * 0.6;
              const swatchStart = legendAtLeft ? edge : edge - swatch;
              const textX = legendAtLeft
                ? edge + swatch + style.fontSize * 0.4
                : edge - swatch - style.fontSize * 0.4;
              return (
                <g key={s.id}>
                  <text x={textX} y={y} dy="0.35em">
                    {s.name}
                  </text>
                  <path
                    class={
                      print ? undefined : `plot-line series-${s.colorIndex % PRINT_COLORS.length}`
                    }
                    d={`M${swatchStart} ${y}h${swatch}`}
                    stroke={color(s)}
                    style={lineStyle(s)}
                    stroke-width={widthOf(s)}
                    stroke-dasharray={dash(s)}
                  />
                </g>
              );
            })}
            {legendKey.map((entry, i) => (
              <text
                key={entry}
                x={legendAtLeft ? style.fontSize * 0.6 : innerW - style.fontSize * 0.6}
                y={
                  legendTop +
                  style.fontSize * 0.4 +
                  ((legendSeries.length > 1 ? legendSeries.length : 0) + i + 0.5) * lineHeight
                }
                dy="0.35em"
              >
                {entry}
              </text>
            ))}
          </g>
        )}
        {placedLabels.length > 0 && (
          <g class={print ? undefined : 'plot-text'} {...text} text-anchor="middle">
            {placedLabels.map(({ label, placed }, i) => (
              <g key={i}>
                {placed.leader && (
                  <path
                    d={
                      below
                        ? `M${placed.x.toFixed(2)} ${(placed.baseline - style.fontSize * 0.95).toFixed(2)}V${(py(label.y) + style.fontSize * 0.3).toFixed(2)}`
                        : `M${placed.x.toFixed(2)} ${(placed.baseline + style.fontSize * 0.25).toFixed(2)}V${(py(label.y) - style.fontSize * 0.3).toFixed(2)}`
                    }
                    fill="none"
                    stroke={ink ?? 'currentColor'}
                    stroke-width={style.lineWidth * 0.5}
                  />
                )}
                <text
                  x={placed.x}
                  y={placed.baseline}
                  font-weight={label.strong ? 'bold' : undefined}
                >
                  {label.text}
                </text>
              </g>
            ))}
          </g>
        )}
        {children}
      </g>
    </svg>
  );
}

interface AnnotationProps {
  a: Annotation;
  /** Plotted x (px) of a value in shown units. */
  ax: (x: number) => number;
  py: (y: number) => number;
  innerW: number;
  innerH: number;
  lineWidth: number;
  fontSize: number;
  /** Export font, or undefined on screen (the page font applies). */
  fontFamily: string | undefined;
  /** Colour used when the annotation has none: black in exports, the text colour on screen. */
  ink: string;
}

/** One annotation in plot coordinates; regions are drawn behind the curves, elsewhere. */
function AnnotationLines(props: AnnotationProps) {
  const { ax, py, innerW, innerH, lineWidth, fontSize, fontFamily, ink } = props;
  const a = { ...props.a, color: props.a.color || ink };
  const size = fontSize * a.size;
  const label = a.text.trim() !== '' && (
    <text x={0} y={0} fill={a.color} stroke="none" font-size={size} font-family={fontFamily}>
      {a.text}
    </text>
  );
  const at = (x: number, y: number, children: ComponentChildren) => (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>{children}</g>
  );
  switch (a.kind) {
    case 'text':
      return at(ax(a.x), py(a.y), label);
    case 'marker':
      return (
        <g>
          <circle cx={ax(a.x)} cy={py(a.y)} r={size * 0.35} fill={a.color} stroke="none" />
          {label && at(ax(a.x) + size * 0.6, py(a.y) + size * 0.35, label)}
        </g>
      );
    case 'vline':
      return (
        <g>
          <path
            d={`M${ax(a.x).toFixed(2)} 0V${innerH}`}
            stroke={a.color}
            stroke-width={lineWidth}
            stroke-dasharray={`${lineWidth * 4} ${lineWidth * 3}`}
          />
          {label && at(ax(a.x) + size * 0.3, size * 1.1, label)}
        </g>
      );
    case 'hline':
      return (
        <g>
          <path
            d={`M0 ${py(a.y).toFixed(2)}H${innerW}`}
            stroke={a.color}
            stroke-width={lineWidth}
            stroke-dasharray={`${lineWidth * 4} ${lineWidth * 3}`}
          />
          {label && at(size * 0.3, py(a.y) - size * 0.3, label)}
        </g>
      );
    case 'region':
      return label ? at(Math.min(ax(a.x), ax(a.x2 ?? a.x)) + size * 0.3, size * 1.1, label) : null;
    case 'arrow': {
      const x1 = ax(a.x2 ?? a.x);
      const y1 = py(a.y2 ?? a.y);
      const x2 = ax(a.x);
      const y2 = py(a.y);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = size * 0.7;
      const left = [x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4)];
      const right = [x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4)];
      const f = (v: number | undefined) => (v as number).toFixed(2);
      return (
        <g>
          <path
            d={`M${f(x1)} ${f(y1)}L${f(x2 - head * 0.8 * Math.cos(angle))} ${f(y2 - head * 0.8 * Math.sin(angle))}`}
            stroke={a.color}
            stroke-width={lineWidth}
          />
          <path
            d={`M${f(x2)} ${f(y2)}L${f(left[0])} ${f(left[1])}L${f(right[0])} ${f(right[1])}Z`}
            fill={a.color}
            stroke="none"
          />
          {label &&
            at(
              x1 + (x1 <= x2 ? -size * 0.3 : size * 0.3),
              y1,
              <g text-anchor={x1 <= x2 ? 'end' : 'start'}>{label}</g>,
            )}
        </g>
      );
    }
  }
}
