import type { ComponentChildren, SVGAttributes } from 'preact';
import { useId } from 'preact/hooks';
import { niceTicks } from './axes';
import { decimate, type Decimated } from './decimate';
import { PRINT_COLORS } from './palette';
import type { AxisLabels, Domain, PlotSeries } from './types';

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
export function plotMargins(fontSize: number): Margins {
  return {
    top: fontSize * 0.8,
    right: fontSize * 1.2,
    bottom: fontSize * 3.3,
    left: fontSize * 2.1,
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
  /** Extra attributes for the root element, for example physical width and height for export. */
  svgAttributes?: SVGAttributes<SVGSVGElement>;
  children?: ComponentChildren;
}

/** Visible y range of the decimated data, padded a little so lines do not touch the frame. */
function yDomainOf(lines: readonly Decimated[], extraTopFraction: number): Domain {
  let lo = Infinity;
  let hi = -Infinity;
  for (const line of lines) {
    for (const v of line.y) {
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
    svgAttributes,
    children,
  } = props;
  const clipId = `plot-clip-${useId()}`;
  const m = plotMargins(style.fontSize);
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const [x0, x1] = xDomain;

  const lines = series.map((s) => decimate(s.x, s.y, x0, x1, samples));
  const lineHeight = style.fontSize * 1.3;
  const legendHeight =
    legend && series.length > 1 ? series.length * lineHeight + style.fontSize * 0.4 : 0;
  const [y0, y1] = yDomainOf(lines, legendHeight / Math.max(innerH - legendHeight, 1));
  const px = (x: number) => ((x - x0) / (x1 - x0)) * innerW;
  const py = (y: number) => innerH - ((y - y0) / (y1 - y0)) * innerH;
  const digits = style.print ? 3 : 1;
  const pathOf = (line: Decimated) =>
    line.x
      .map(
        (x, i) =>
          `${i === 0 ? 'M' : 'L'}${px(x).toFixed(digits)} ${py(line.y[i] as number).toFixed(digits)}`,
      )
      .join('');

  const tickLength = style.fontSize * 0.45;
  const xTicks = niceTicks(x0, x1, Math.max(2, Math.round(innerW / (style.fontSize * 6))));
  const print = style.print;
  const ink = print ? '#000000' : undefined;
  const frameWidth = print ? 0.75 : 1;
  const text = print
    ? { 'font-family': print.fontFamily, 'font-size': style.fontSize, fill: ink }
    : {};
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
          <text transform={`translate(${-style.fontSize * 0.7} ${innerH / 2}) rotate(-90)`}>
            {labels.y}
          </text>
        </g>

        {legendHeight > 0 && (
          <g class={print ? undefined : 'plot-text'} {...text} text-anchor="end">
            {series.map((s, i) => {
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
                  />
                </g>
              );
            })}
          </g>
        )}
        {children}
      </g>
    </svg>
  );
}
