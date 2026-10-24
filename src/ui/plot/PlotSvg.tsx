import type { ComponentChildren, SVGAttributes } from 'preact';
import { useId } from 'preact/hooks';
import { niceTicks } from './axes';
import { decimate, lowerBound, type Decimated } from './decimate';
import { PRINT_COLORS } from './palette';
import { labelRoom, placeLabels, textWidth, type PeakLabelSet } from './peakLabels';
import type { AxisLabels, Domain, PlotMarker, PlotSeries } from './types';

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
  /** Text labels above peaks, and the key explaining them (the key is drawn in exports only). */
  peakLabels?: PeakLabelSet;
  /** Extra attributes for the root element, for example physical width and height for export. */
  svgAttributes?: SVGAttributes<SVGSVGElement>;
  children?: ComponentChildren;
}

/**
 * y range of the data and markers visible between xDomain[0] and xDomain[1], padded a little
 * so lines do not touch the frame. extraTopFraction leaves room at the top (for a legend).
 */
export function visibleYDomain(
  series: readonly PlotSeries[],
  xDomain: Domain,
  extraTopFraction = 0,
  markers: readonly PlotMarker[] = [],
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
  return [lo - 0.03 * range, hi + (0.06 + extraTopFraction) * range];
}

/**
 * Publication-style intensity plot: a closed frame, inward ticks on the bottom and top edges,
 * 2θ tick labels below, and no intensity numbers (arbitrary units). Used for both the screen
 * and exported files, so what is exported matches what is shown.
 */
export function PlotSvg(props: PlotSvgProps) {
  const {
    series,
    xDomain,
    width,
    height,
    style,
    labels,
    samples,
    legend,
    markers,
    peakLabels,
    svgAttributes,
    children,
  } = props;
  const clipId = `plot-clip-${useId()}`;
  const m = plotMargins(style.fontSize, labels.yValues);
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const [x0, x1] = xDomain;

  const lines = series.map((s) => decimate(s.x, s.y, x0, x1, samples));
  const lineHeight = style.fontSize * 1.3;
  const legendSeries = legend ? series.filter((s) => !s.quiet) : [];
  const legendKey = legend && peakLabels ? peakLabels.key : [];
  const legendRows = (legendSeries.length > 1 ? legendSeries.length : 0) + legendKey.length;
  const legendHeight = legendRows > 0 ? legendRows * lineHeight + style.fontSize * 0.4 : 0;
  const reserved = legendHeight + (peakLabels ? labelRoom(style.fontSize) : 0);
  const [y0, y1] =
    props.yDomain ??
    visibleYDomain(series, xDomain, reserved / Math.max(innerH - reserved, 1), markers);
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
    const placements = placeLabels(
      visible.map((l) => ({
        x: px(l.x),
        y: py(l.y),
        width: textWidth(l.text, style.fontSize),
      })),
      lineHeight,
      0,
    );
    return visible.map((label, i) => ({
      label,
      placed: placements[i] as (typeof placements)[number],
    }));
  })();

  const tickLength = style.fontSize * 0.45;
  const xTickCount = Math.max(2, Math.round(innerW / (style.fontSize * 6)));
  const xTicks = labels.reversed
    ? niceTicks(-x1, -x0, xTickCount).map((t) => ({ value: -t.value, label: t.label }))
    : niceTicks(x0, x1, xTickCount);
  const yTicks = labels.yValues
    ? niceTicks(y0, y1, Math.max(2, Math.round(innerH / (style.fontSize * 5))))
    : [];
  const print = style.print;
  const ink = print ? '#000000' : undefined;
  const frameWidth = print ? 0.75 : 1;
  const text = print
    ? { 'font-family': print.fontFamily, 'font-size': style.fontSize, fill: ink }
    : {};
  const dash = (s: PlotSeries) =>
    s.dashed ? `${style.lineWidth * 4} ${style.lineWidth * 3}` : undefined;
  const color = (s: PlotSeries) =>
    print ? PRINT_COLORS[s.colorIndex % PRINT_COLORS.length] : undefined;

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
          {series.map((s, i) => (
            <path
              key={s.id}
              class={print ? undefined : `plot-line series-${s.colorIndex % PRINT_COLORS.length}`}
              d={pathOf(lines[i] as Decimated)}
              stroke={color(s)}
              stroke-width={style.lineWidth}
              stroke-dasharray={dash(s)}
            />
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
              d={`M${px(t.value).toFixed(2)} ${innerH}v${-tickLength}M${px(t.value).toFixed(2)} 0v${tickLength}`}
            />
          ))}
          {yTicks.map((t) => (
            <path
              key={t.value}
              d={`M0 ${py(t.value).toFixed(2)}h${tickLength}M${innerW} ${py(t.value).toFixed(2)}h${-tickLength}`}
            />
          ))}
        </g>

        <g class={print ? undefined : 'plot-text'} {...text} text-anchor="middle">
          {xTicks.map((t) => (
            <text key={t.value} x={px(t.value)} y={innerH + style.fontSize * 1.25}>
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
              <text key={t.value} x={-style.fontSize * 0.4} y={py(t.value)} dy="0.35em">
                {t.label}
              </text>
            ))}
          </g>
        )}

        {legendHeight > 0 && (
          <g class={print ? undefined : 'plot-text'} {...text} text-anchor="end">
            {(legendSeries.length > 1 ? legendSeries : []).map((s, i) => {
              const y = style.fontSize * 0.4 + (i + 0.5) * lineHeight;
              const right = innerW - style.fontSize * 0.6;
              const swatch = style.fontSize * 1.6;
              return (
                <g key={s.id}>
                  <text x={right - swatch - style.fontSize * 0.4} y={y} dy="0.35em">
                    {s.name}
                  </text>
                  <path
                    class={
                      print ? undefined : `plot-line series-${s.colorIndex % PRINT_COLORS.length}`
                    }
                    d={`M${right - swatch} ${y}h${swatch}`}
                    stroke={color(s)}
                    stroke-width={style.lineWidth}
                    stroke-dasharray={dash(s)}
                  />
                </g>
              );
            })}
            {legendKey.map((entry, i) => (
              <text
                key={entry}
                x={innerW - style.fontSize * 0.6}
                y={
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
                    d={`M${placed.x.toFixed(2)} ${(placed.baseline + style.fontSize * 0.25).toFixed(2)}V${(py(label.y) - style.fontSize * 0.3).toFixed(2)}`}
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
