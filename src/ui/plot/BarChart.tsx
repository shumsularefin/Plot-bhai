import { h, render } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { niceTicks } from './axes';
import {
  downloadBlob,
  EXPORT_FONTS,
  figureSize,
  fileStem,
  svgToPng,
  type ExportSettings,
} from './export';
import { PRINT_COLORS } from './palette';

export interface Bar {
  label: string;
  /** NaN draws no bar and writes "no value" instead. */
  value: number;
  /** Error bar half-length (same unit); NaN or 0 draws none. */
  sigma: number;
}

interface BarSvgProps {
  bars: readonly Bar[];
  yLabel: string;
  width: number;
  height: number;
  fontSize: number;
  lineWidth: number;
  /** For export: explicit font and colours instead of the page's CSS. */
  print?: { fontFamily: string };
  svgAttributes?: Record<string, string>;
}

/** Bars from zero with ± error bars, inward ticks and a numbered value axis. */
export function BarSvg(props: BarSvgProps) {
  const { bars, yLabel, width, height, fontSize, lineWidth, print } = props;
  const slot0 = (width - fontSize * 6) / Math.max(bars.length, 1);
  const rotate = slot0 < fontSize * 6;
  const m = {
    top: fontSize * 0.8,
    right: fontSize,
    bottom: fontSize * (rotate ? 6 : 2.2),
    left: fontSize * 4.6,
  };
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const top = Math.max(
    0,
    ...bars.map((b) => (Number.isFinite(b.value) ? b.value + (b.sigma > 0 ? b.sigma : 0) : 0)),
  );
  const yMax = top > 0 ? top * 1.1 : 1;
  const py = (v: number) => innerH - (v / yMax) * innerH;
  const slot = innerW / Math.max(bars.length, 1);
  const barW = slot * 0.6;
  const ticks = niceTicks(0, yMax, Math.max(2, Math.round(innerH / (fontSize * 5))));
  const ink = print ? '#000000' : undefined;
  const text = print ? { 'font-family': print.fontFamily, 'font-size': fontSize, fill: ink } : {};
  const tick = fontSize * 0.45;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      class={print ? undefined : 'plot-svg'}
      {...props.svgAttributes}
    >
      {print && <rect width={width} height={height} fill="#ffffff" />}
      <g transform={`translate(${m.left} ${m.top})`}>
        {bars.map((b, i) => {
          const cx = slot * (i + 0.5);
          if (!Number.isFinite(b.value)) {
            return (
              <text
                key={i}
                class={print ? undefined : 'plot-text'}
                {...text}
                x={cx}
                y={innerH - fontSize * 0.6}
                text-anchor="middle"
              >
                no value
              </text>
            );
          }
          const hasError = b.sigma > 0 && Number.isFinite(b.sigma);
          return (
            <g key={i}>
              <rect
                class={print ? undefined : 'plot-bar'}
                x={cx - barW / 2}
                y={py(b.value)}
                width={barW}
                height={Math.max(0, innerH - py(b.value))}
                fill={print ? PRINT_COLORS[0] : undefined}
              />
              {hasError && (
                <path
                  class={print ? undefined : 'plot-ink'}
                  d={`M${cx} ${py(Math.max(0, b.value - b.sigma))}V${py(b.value + b.sigma)}M${cx - barW / 4} ${py(b.value + b.sigma)}h${barW / 2}M${cx - barW / 4} ${py(Math.max(0, b.value - b.sigma))}h${barW / 2}`}
                  stroke={ink}
                  stroke-width={lineWidth}
                  fill="none"
                />
              )}
            </g>
          );
        })}
        <g class={print ? undefined : 'plot-ink'} stroke={ink} stroke-width={print ? 0.75 : 1}>
          <rect width={innerW} height={innerH} fill="none" />
          {ticks.map((t) => (
            <path key={t.value} d={`M0 ${py(t.value).toFixed(2)}h${tick}`} />
          ))}
        </g>
        <g class={print ? undefined : 'plot-text'} {...text}>
          {ticks.map((t) => (
            <text key={t.value} x={-fontSize * 0.4} y={py(t.value)} dy="0.35em" text-anchor="end">
              {t.label}
            </text>
          ))}
          {bars.map((b, i) => {
            const cx = slot * (i + 0.5);
            const y = innerH + fontSize * 1.3;
            return rotate ? (
              <text
                key={i}
                transform={`translate(${cx} ${innerH + fontSize * 0.8}) rotate(-40)`}
                text-anchor="end"
                dy="0.7em"
              >
                {b.label}
              </text>
            ) : (
              <text key={i} x={cx} y={y} text-anchor="middle">
                {b.label}
              </text>
            );
          })}
          <text
            transform={`translate(${-fontSize * 4} ${innerH / 2}) rotate(-90)`}
            text-anchor="middle"
          >
            {yLabel}
          </text>
        </g>
      </g>
    </svg>
  );
}

const PT_PER_MM = 72 / 25.4;

function barSvgString(bars: readonly Bar[], yLabel: string, settings: ExportSettings): string {
  const size = figureSize(settings);
  const host = document.createElement('div');
  render(
    h(BarSvg, {
      bars,
      yLabel,
      width: size.widthMm * PT_PER_MM,
      height: size.heightMm * PT_PER_MM,
      fontSize: settings.fontSizePt,
      lineWidth: settings.lineWidthPt,
      print: { fontFamily: EXPORT_FONTS[settings.font].family },
      svgAttributes: { width: `${size.widthMm}mm`, height: `${size.heightMm}mm` },
    }),
    host,
  );
  const svg = host.firstElementChild;
  const markup = svg ? new XMLSerializer().serializeToString(svg) : '';
  render(null, host);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}

interface BarChartProps {
  bars: readonly Bar[];
  yLabel: string;
  /** Accessible description, for example "Crystallite size by method". */
  description: string;
  /** Figure size, font and line width shared with the other plots. */
  exportSettings: ExportSettings;
  exportName: string;
}

/** Screen bar chart that fills its container's width, with SVG and PNG export. */
export function BarChart({ bars, yLabel, description, exportSettings, exportName }: BarChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  const height = Math.round(Math.min(360, Math.max(240, width * 0.5)));
  const stem = fileStem(exportName);
  const exportPng = async (dpi: number) => {
    try {
      const svg = barSvgString(bars, yLabel, exportSettings);
      downloadBlob(await svgToPng(svg, figureSize(exportSettings), dpi), `${stem}-${dpi}dpi.png`);
      setStatus(`Saved ${stem}-${dpi}dpi.png.`);
    } catch {
      setStatus(`This browser could not create a ${dpi} dpi image. Try 300 dpi or SVG.`);
    }
  };
  return (
    <figure class="bar-chart">
      <div ref={ref} role="img" aria-label={description}>
        {width > 0 && (
          <BarSvg
            bars={bars}
            yLabel={yLabel}
            width={width}
            height={height}
            fontSize={12}
            lineWidth={1.25}
          />
        )}
      </div>
      <div class="export-actions">
        <button
          type="button"
          class="btn"
          onClick={() => {
            downloadBlob(
              new Blob([barSvgString(bars, yLabel, exportSettings)], { type: 'image/svg+xml' }),
              `${stem}.svg`,
            );
            setStatus(`Saved ${stem}.svg.`);
          }}
        >
          Download SVG
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(300)}>
          PNG 300 dpi
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(600)}>
          PNG 600 dpi
        </button>
        <p class="field-hint" role="status">
          {status ?? 'Uses the figure size, font and line width set under Export figure.'}
        </p>
      </div>
    </figure>
  );
}
