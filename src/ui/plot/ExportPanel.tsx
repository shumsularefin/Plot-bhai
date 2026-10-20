import { useState } from 'preact/hooks';
import { HelpTip } from '../HelpTip';
import {
  downloadBlob,
  EXPORT_FONTS,
  EXPORT_PRESETS,
  figureSize,
  fileStem,
  pixelSize,
  renderSvgString,
  svgToPng,
  type ExportFont,
  type ExportPreset,
  type ExportSettings,
} from './export';
import type { AxisLabels, Domain, PlotMarker, PlotSeries } from './types';

interface ExportPanelProps {
  series: readonly PlotSeries[];
  domain: Domain;
  labels: AxisLabels;
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  exportName: string;
  /** Data points drawn as circles in the exported figure. */
  points?: readonly PlotMarker[] | undefined;
}

/** Figure export: journal width presets, font, sizes, and SVG or PNG (300 or 600 dpi) download. */
export function ExportPanel({
  series,
  domain,
  labels,
  settings,
  onChange,
  exportName,
  points,
}: ExportPanelProps) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const size = figureSize(settings);
  const stem = fileStem(exportName);

  const numberField = (
    key: 'heightMm' | 'fontSizePt' | 'lineWidthPt',
    min: number,
    max: number,
    step: number,
  ) => (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={settings[key]}
      onChange={(e) => {
        const value = Number(e.currentTarget.value);
        if (Number.isFinite(value)) onChange({ [key]: Math.min(max, Math.max(min, value)) });
      }}
    />
  );

  const exportSvg = () => {
    const svg = renderSvgString(series, domain, labels, settings, points);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${stem}.svg`);
    setStatus({ text: `Saved ${stem}.svg.`, error: false });
  };

  const exportPng = async (dpi: number) => {
    setStatus({ text: `Creating the ${dpi} dpi image…`, error: false });
    try {
      const svg = renderSvgString(series, domain, labels, settings, points);
      downloadBlob(await svgToPng(svg, size, dpi), `${stem}-${dpi}dpi.png`);
      setStatus({ text: `Saved ${stem}-${dpi}dpi.png.`, error: false });
    } catch {
      setStatus({
        text: `This browser could not create a ${dpi} dpi image this large. Try 300 dpi, a smaller height, or SVG.`,
        error: true,
      });
    }
  };

  const px = (dpi: number) => {
    const p = pixelSize(size, dpi);
    return `${p.width} × ${p.height} px`;
  };

  return (
    <section class="export-panel" aria-labelledby="export-heading">
      <h3 id="export-heading" class="export-title">
        Export figure
      </h3>
      <p class="field-hint">
        Exports the range shown above, with black axes on a white background.
      </p>

      <div class="export-grid">
        <fieldset class="export-preset">
          <legend>Width</legend>
          {(Object.keys(EXPORT_PRESETS) as ExportPreset[]).map((key) => (
            <label key={key} class="check">
              <input
                type="radio"
                name="export-preset"
                checked={settings.preset === key}
                onChange={() => onChange({ preset: key, heightMm: EXPORT_PRESETS[key].heightMm })}
              />
              {EXPORT_PRESETS[key].label} ({EXPORT_PRESETS[key].widthMm} mm)
            </label>
          ))}
        </fieldset>

        <label class="export-field">
          Height (mm)
          {numberField('heightMm', 30, 230, 1)}
        </label>
        <label class="export-field">
          Font
          <select
            value={settings.font}
            onChange={(e) => onChange({ font: e.currentTarget.value as ExportFont })}
          >
            {(Object.keys(EXPORT_FONTS) as ExportFont[]).map((key) => (
              <option key={key} value={key}>
                {EXPORT_FONTS[key].label}
              </option>
            ))}
          </select>
        </label>
        <label class="export-field">
          Font size (pt)
          {numberField('fontSizePt', 5, 14, 0.5)}
        </label>
        <label class="export-field">
          Line width (pt)
          {numberField('lineWidthPt', 0.25, 3, 0.25)}
        </label>
      </div>

      <div class="export-actions">
        <button type="button" class="btn" onClick={exportSvg}>
          Download SVG
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(300)} title={px(300)}>
          PNG 300 dpi
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(600)} title={px(600)}>
          PNG 600 dpi
        </button>
        <HelpTip term="dpi">
          <p>
            Dots per inch: how many pixels the image has per inch of printed width. At{' '}
            {size.widthMm} × {size.heightMm} mm, 300 dpi is {px(300)} and 600 dpi is {px(600)}.
            Check your journal's figure guidelines for the resolution it needs. SVG is a vector
            format and stays sharp at any size.
          </p>
        </HelpTip>
      </div>
      <p class={status?.error ? 'export-status is-error' : 'export-status'} role="status">
        {status?.text}
      </p>
    </section>
  );
}
