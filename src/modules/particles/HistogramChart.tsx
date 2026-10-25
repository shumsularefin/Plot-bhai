import { h, render } from 'preact';
import { Dock } from '../../ui/Dock';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Histogram } from '../../core/particles/distribution';
import { niceTicks } from '../../ui/plot/axes';
import {
  downloadBlob,
  EXPORT_FONTS,
  EXPORT_PRESETS,
  figureSize,
  fileStem,
  svgToPng,
  type ExportFont,
  type ExportPreset,
  type ExportSettings,
} from '../../ui/plot/export';
import { PRINT_COLORS } from '../../ui/plot/palette';

export interface HistogramFigure {
  histogram: Histogram;
  /** Density curve of the fit already scaled to counts per bin, over the range of the bins. */
  fit: { name: string; x: number[]; y: number[] } | null;
  /** Share of particles (0 to 1) up to each size, drawn against the right-hand axis. */
  cumulative: { x: ArrayLike<number>; share: ArrayLike<number> } | null;
  /** Axis label with unit, for example "Equal-area diameter (nm)". */
  xLabel: string;
}

interface SvgProps extends HistogramFigure {
  width: number;
  height: number;
  fontSize: number;
  lineWidth: number;
  /** For export: explicit font and colours instead of the page's CSS. */
  print?: { fontFamily: string };
  svgAttributes?: Record<string, string>;
}

/** Histogram bars with an optional fitted curve and cumulative curve, inward ticks, numbered axes. */
export function HistogramSvg(props: SvgProps) {
  const { histogram, fit, cumulative, xLabel, width, height, fontSize, lineWidth, print } = props;
  const m = {
    top: fontSize * (fit && cumulative ? 3.4 : fit || cumulative ? 2.2 : 0.8),
    right: fontSize * (cumulative ? 3.6 : 1),
    bottom: fontSize * 3.4,
    left: fontSize * 4.2,
  };
  const innerW = Math.max(1, width - m.left - m.right);
  const innerH = Math.max(1, height - m.top - m.bottom);
  const x0 = histogram.edges[0] as number;
  const x1 = histogram.edges[histogram.edges.length - 1] as number;
  const px = (v: number) => ((v - x0) / (x1 - x0 || 1)) * innerW;
  const top = Math.max(1, ...histogram.counts, ...(fit?.y ?? []));
  const yTicks = niceTicks(0, top, Math.max(2, Math.round(innerH / (fontSize * 4))));
  const yMax = Math.max(top, (yTicks[yTicks.length - 1]?.value ?? top) as number);
  const py = (v: number) => innerH - (v / yMax) * innerH;
  const pc = (share: number) => innerH - share * innerH;
  const xTicks = niceTicks(x0, x1, Math.max(3, Math.round(innerW / (fontSize * 4.5))));
  const cumTicks = [0, 0.25, 0.5, 0.75, 1];
  const ink = print ? '#000000' : undefined;
  const text = print ? { 'font-family': print.fontFamily, 'font-size': fontSize, fill: ink } : {};
  const tick = fontSize * 0.45;
  const fitColor = print ? PRINT_COLORS[3] : undefined;
  const cumColor = print ? PRINT_COLORS[2] : undefined;
  const line = (xs: ArrayLike<number>, ys: ArrayLike<number>, y: (v: number) => number) => {
    let d = '';
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      if (x < x0 || x > x1) continue;
      d += `${d ? 'L' : 'M'}${px(x).toFixed(2)} ${y(ys[i] as number).toFixed(2)}`;
    }
    return d;
  };
  // At most about 300 points keep the curve smooth and the file small.
  const step = Math.max(1, Math.ceil((cumulative?.x.length ?? 0) / 300));
  const cumX = cumulative ? Array.from(cumulative.x).filter((_, i) => i % step === 0) : [];
  const cumY = cumulative ? Array.from(cumulative.share).filter((_, i) => i % step === 0) : [];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      class={print ? undefined : 'plot-svg'}
      {...props.svgAttributes}
    >
      {print && <rect width={width} height={height} fill="#ffffff" />}
      <g transform={`translate(${m.left} ${m.top})`}>
        {histogram.counts.map((count, i) => {
          const left = px(histogram.edges[i] as number);
          const right = px(histogram.edges[i + 1] as number);
          return (
            <rect
              key={i}
              class={print ? undefined : 'hist-bar'}
              x={left}
              y={py(count)}
              width={Math.max(0, right - left)}
              height={Math.max(0, innerH - py(count))}
              fill={print ? PRINT_COLORS[0] : undefined}
              stroke={print ? '#ffffff' : undefined}
              stroke-width={print ? lineWidth * 0.5 : undefined}
            />
          );
        })}
        {fit && (
          <path
            class={print ? undefined : 'hist-fit'}
            d={line(fit.x, fit.y, py)}
            stroke={fitColor}
            stroke-width={lineWidth * 1.5}
            fill="none"
          />
        )}
        {cumulative && (
          <path
            class={print ? undefined : 'hist-cum'}
            d={line(cumX, cumY, pc)}
            stroke={cumColor}
            stroke-width={lineWidth * 1.5}
            stroke-dasharray={`${lineWidth * 4} ${lineWidth * 2}`}
            fill="none"
          />
        )}
        <g class={print ? undefined : 'plot-ink'} stroke={ink} stroke-width={print ? 0.75 : 1}>
          <rect width={innerW} height={innerH} fill="none" />
          {yTicks.map((t) => (
            <path key={t.value} d={`M0 ${py(t.value).toFixed(2)}h${tick}`} />
          ))}
          {xTicks.map((t) => (
            <path key={t.value} d={`M${px(t.value).toFixed(2)} ${innerH}v${-tick}`} />
          ))}
          {cumulative &&
            cumTicks.map((t) => <path key={t} d={`M${innerW} ${pc(t).toFixed(2)}h${-tick}`} />)}
        </g>
        <g class={print ? undefined : 'plot-text'} {...text}>
          {yTicks.map((t) => (
            <text key={t.value} x={-fontSize * 0.4} y={py(t.value)} dy="0.35em" text-anchor="end">
              {t.label}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={t.value} x={px(t.value)} y={innerH + fontSize * 1.3} text-anchor="middle">
              {t.label}
            </text>
          ))}
          {cumulative &&
            cumTicks.map((t) => (
              <text key={t} x={innerW + fontSize * 0.4} y={pc(t)} dy="0.35em">
                {Math.round(t * 100)}
              </text>
            ))}
          <text x={innerW / 2} y={innerH + fontSize * 2.8} text-anchor="middle">
            {xLabel}
          </text>
          <text
            transform={`translate(${-fontSize * 3.2} ${innerH / 2}) rotate(-90)`}
            text-anchor="middle"
          >
            Number of particles
          </text>
          {cumulative && (
            <text
              transform={`translate(${innerW + fontSize * 2.8} ${innerH / 2}) rotate(90)`}
              text-anchor="middle"
            >
              Cumulative (%)
            </text>
          )}
          {fit && (
            <text
              x={0}
              y={-fontSize * 1.1}
              fill={fitColor}
              class={print ? undefined : 'hist-fit-text'}
            >
              ― {fit.name}
            </text>
          )}
          {cumulative && (
            <text
              x={0}
              y={-fontSize * (fit ? 2.4 : 1.1)}
              fill={cumColor}
              class={print ? undefined : 'hist-cum-text'}
            >
              - - Cumulative (%)
            </text>
          )}
        </g>
      </g>
    </svg>
  );
}

const PT_PER_MM = 72 / 25.4;

function histogramSvgString(figure: HistogramFigure, settings: ExportSettings): string {
  const size = figureSize(settings);
  const host = document.createElement('div');
  render(
    h(HistogramSvg, {
      ...figure,
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

interface ChartProps {
  figure: HistogramFigure;
  description: string;
  exportName: string;
  settings: ExportSettings;
  onSettings: (patch: Partial<ExportSettings>) => void;
}

/** Histogram that fills its container's width, with figure size controls and SVG / PNG export. */
export function HistogramChart({
  figure,
  description,
  exportName,
  settings,
  onSettings,
}: ChartProps) {
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
  const height = Math.round(Math.min(380, Math.max(260, width * 0.55)));
  const stem = fileStem(exportName);
  const size = figureSize(settings);
  const exportPng = async (dpi: number) => {
    try {
      const svg = histogramSvgString(figure, settings);
      downloadBlob(await svgToPng(svg, size, dpi), `${stem}-${dpi}dpi.png`);
      setStatus(`Saved ${stem}-${dpi}dpi.png.`);
    } catch {
      setStatus(`This browser could not create a ${dpi} dpi image. Try 300 dpi or SVG.`);
    }
  };
  return (
    <figure class="bar-chart">
      <Dock label="Histogram">
        <div ref={ref} role="img" aria-label={description}>
          {width > 0 && (
            <HistogramSvg
              {...figure}
              width={width}
              height={height}
              fontSize={12}
              lineWidth={1.25}
            />
          )}
        </div>
      </Dock>
      <div class="export-grid">
        <fieldset class="export-preset">
          <legend>Figure width</legend>
          {(Object.keys(EXPORT_PRESETS) as ExportPreset[]).map((key) => (
            <label key={key} class="check">
              <input
                type="radio"
                name="histogram-preset"
                checked={settings.preset === key}
                onChange={() => onSettings({ preset: key, heightMm: EXPORT_PRESETS[key].heightMm })}
              />
              {EXPORT_PRESETS[key].label} ({EXPORT_PRESETS[key].widthMm} mm)
            </label>
          ))}
        </fieldset>
        <label class="export-field">
          Font
          <select
            value={settings.font}
            onChange={(e) => onSettings({ font: e.currentTarget.value as ExportFont })}
          >
            {(Object.keys(EXPORT_FONTS) as ExportFont[]).map((key) => (
              <option key={key} value={key}>
                {EXPORT_FONTS[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="export-actions">
        <button
          type="button"
          class="btn"
          onClick={() => {
            downloadBlob(
              new Blob([histogramSvgString(figure, settings)], { type: 'image/svg+xml' }),
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
          {status ?? 'Black axes on white, at the width chosen above.'}
        </p>
      </div>
    </figure>
  );
}
