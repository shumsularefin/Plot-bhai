import { useState } from 'preact/hooks';
import { Advanced } from '../Advanced';
import { HelpTip } from '../HelpTip';
import {
  downloadBlob,
  EXPORT_FONTS,
  EXPORT_PRESETS,
  figureSize,
  fileStem,
  minimumHeightMm,
  pixelSize,
  renderSvgString,
  svgToPng,
  type ExportFont,
  type ExportPreset,
  type ExportSettings,
  type LowerAxis,
} from './export';
import type { FigureStyle } from './figure';
import { JOURNAL_STYLES, journalProblems, type JournalId, type JournalStyle } from './journals';
import type { PeakLabelSet } from './peakLabels';
import { svgToPdf } from './pdf';
import type { ReferenceLane } from './ReferenceLanes';
import type { AxisLabels, Domain, PlotBand, PlotMarker, PlotSeries } from './types';

interface ExportPanelProps {
  series: readonly PlotSeries[];
  domain: Domain;
  labels: AxisLabels;
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  exportName: string;
  /** Data points drawn as circles in the exported figure. */
  points?: readonly PlotMarker[] | undefined;
  /** Shaded x ranges drawn behind the curves in the exported figure. */
  bands?: readonly PlotBand[] | undefined;
  /** Residual curve drawn in a panel under the exported figure. */
  residual?: readonly PlotSeries[] | undefined;
  /** Labels above peaks, drawn in the exported figure with their key. */
  peakLabels?: PeakLabelSet | undefined;
  /** Reference stick patterns drawn in lanes under the exported figure. */
  lanes?: readonly ReferenceLane[] | undefined;
  /** Y axis of the panel under the plot when it is not a residual. */
  lowerAxis?: LowerAxis | undefined;
  /** Styling from the figure editor. */
  figure?: FigureStyle | undefined;
}

/**
 * Figure export under the plot: SVG, PNG (300 or 600 dpi) and PDF at a journal width, with height,
 * font and line width under Advanced.
 */
export function ExportPanel({
  series,
  domain,
  labels,
  settings,
  onChange,
  exportName,
  points,
  bands,
  residual,
  peakLabels,
  lanes,
  lowerAxis,
  figure,
}: ExportPanelProps) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const size = figureSize(settings);
  const shownSeries = series.filter(
    (s) => !s.quiet && !(figure?.series[s.id]?.hidden ?? false),
  ).length;
  const legendRows =
    (figure?.legend.show ?? true)
      ? (shownSeries > 1 ? shownSeries : 0) + (peakLabels?.key.length ?? 0)
      : 0;
  const minHeight = minimumHeightMm(settings, {
    residual: residual !== undefined,
    lanes: lanes?.length ?? 0,
    legendRows,
    peakLabels: peakLabels !== undefined && (figure?.peakLabels.show ?? true),
  });
  const stem = fileStem(exportName);
  const journalId = settings.journal;
  const journal: JournalStyle | undefined = journalId ? JOURNAL_STYLES[journalId] : undefined;
  const problems = journal
    ? journalProblems(journal, { ...size, fontSizePt: settings.fontSizePt })
    : [];
  // A journal asking for more than 600 dpi (Elsevier line art) gets its own PNG button.
  const extraDpi = journal?.lineArtDpi && journal.lineArtDpi > 600 ? journal.lineArtDpi : null;

  const chooseJournal = (id: JournalId | '') => {
    if (id === '') {
      onChange({
        journal: undefined,
        preset: 'single',
        heightMm: EXPORT_PRESETS.single.heightMm,
      });
      return;
    }
    const style: JournalStyle = JOURNAL_STYLES[id];
    const first = style.widths[0]?.mm ?? EXPORT_PRESETS.custom.widthMm;
    onChange({
      journal: id,
      preset: 'custom',
      customWidthMm: first,
      heightMm: Math.min(settings.heightMm, style.maxHeightMm ?? Infinity),
      ...(style.font && { font: style.font }),
      ...(style.fontSizePt !== undefined && { fontSizePt: style.fontSizePt }),
    });
  };

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
    const svg = renderSvgString(
      series,
      domain,
      labels,
      settings,
      points,
      residual,
      peakLabels,
      lanes,
      lowerAxis,
      bands,
      figure,
    );
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${stem}.svg`);
    setStatus({ text: `Saved ${stem}.svg.`, error: false });
  };

  const exportPng = async (dpi: number) => {
    setStatus({ text: `Creating the ${dpi} dpi image…`, error: false });
    try {
      const svg = renderSvgString(
        series,
        domain,
        labels,
        settings,
        points,
        residual,
        peakLabels,
        lanes,
        lowerAxis,
        bands,
        figure,
      );
      downloadBlob(await svgToPng(svg, size, dpi), `${stem}-${dpi}dpi.png`);
      setStatus({ text: `Saved ${stem}-${dpi}dpi.png.`, error: false });
    } catch {
      setStatus({
        text: `This browser could not create a ${dpi} dpi image this large. Try 300 dpi, a smaller height, or SVG.`,
        error: true,
      });
    }
  };

  const exportPdf = async () => {
    setStatus({ text: 'Creating the PDF…', error: false });
    try {
      const svg = renderSvgString(
        series,
        domain,
        labels,
        settings,
        points,
        residual,
        peakLabels,
        lanes,
        lowerAxis,
        bands,
        figure,
      );
      downloadBlob(await svgToPdf(svg, size, 600), `${stem}.pdf`);
      setStatus({ text: `Saved ${stem}.pdf.`, error: false });
    } catch {
      setStatus({
        text: 'This browser could not create the PDF. Try a smaller height, or SVG.',
        error: true,
      });
    }
  };

  const px = (dpi: number) => {
    const p = pixelSize(size, dpi);
    return `${p.width} × ${p.height} px`;
  };

  return (
    <section class="export-panel" aria-label="Export figure">
      <div class="export-actions">
        <span class="export-label">Export</span>
        <button type="button" class="btn" onClick={exportSvg} aria-label="Download SVG">
          SVG
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(300)} title={px(300)}>
          PNG 300 dpi
        </button>
        <button type="button" class="btn" onClick={() => void exportPng(600)} title={px(600)}>
          PNG 600 dpi
        </button>
        {extraDpi !== null && (
          <button
            type="button"
            class="btn"
            onClick={() => void exportPng(extraDpi)}
            title={px(extraDpi)}
          >
            PNG {extraDpi} dpi
          </button>
        )}
        <button type="button" class="btn" onClick={() => void exportPdf()}>
          PDF
        </button>
        <label class="export-field export-width">
          <span class="visually-hidden">Journal style</span>
          <select
            value={journalId ?? ''}
            onChange={(e) => chooseJournal(e.currentTarget.value as JournalId | '')}
          >
            <option value="">Any journal</option>
            {(Object.keys(JOURNAL_STYLES) as JournalId[]).map((id) => (
              <option key={id} value={id}>
                {JOURNAL_STYLES[id].label} style
              </option>
            ))}
          </select>
        </label>
        <label class="export-field export-width">
          <span class="visually-hidden">Figure width</span>
          {journal ? (
            <select
              value={String(size.widthMm)}
              onChange={(e) => onChange({ customWidthMm: Number(e.currentTarget.value) })}
            >
              {!journal.widths.some((w) => w.mm === size.widthMm) && (
                <option value={String(size.widthMm)}>Your width ({size.widthMm} mm)</option>
              )}
              {journal.widths.map((w) => (
                <option key={w.mm} value={String(w.mm)}>
                  {w.label} ({w.mm} mm)
                </option>
              ))}
            </select>
          ) : (
            <select
              value={settings.preset}
              onChange={(e) => {
                const key = e.currentTarget.value as ExportPreset;
                onChange({ preset: key, heightMm: EXPORT_PRESETS[key].heightMm });
              }}
            >
              {(Object.keys(EXPORT_PRESETS) as ExportPreset[]).map((key) => (
                <option key={key} value={key}>
                  {EXPORT_PRESETS[key].label}
                  {key !== 'custom' && ` (${EXPORT_PRESETS[key].widthMm} mm)`}
                </option>
              ))}
            </select>
          )}
        </label>
        <HelpTip term="the figure export">
          <p>
            Exports the range shown, with black axes on a white background, at the chosen journal
            width ({size.widthMm} × {size.heightMm} mm). Dots per inch (dpi) is how many pixels the
            image has per inch of printed width: 300 dpi is {px(300)} and 600 dpi is {px(600)}.
            Check your journal&apos;s figure guidelines. SVG is a vector format and stays sharp at
            any size. The PDF holds the figure as a 600 dpi image at its exact size; use SVG when
            you need editable lines and text.
          </p>
          <p>
            <strong>Journal style</strong> sets the width, font and font size from the
            publisher&apos;s own figure rules (Elsevier, Nature, Wiley). Publishers mostly fix the
            size, font, text size and resolution, not the look of the graph, and a single journal
            can ask for more, so read its guide too. ACS and RSC are not offered yet because their
            pages could not be checked.
          </p>
        </HelpTip>
      </div>
      {journal && (
        <div class="journal-rules">
          <p>
            <strong>{journal.label} figure rules</strong> (from the{' '}
            <a href={journal.source} target="_blank" rel="noopener noreferrer">
              publisher&apos;s guide
            </a>
            ; your journal may ask for more):
          </p>
          <ul>
            {journal.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          {problems.map((problem) => (
            <p key={problem} class="message is-warning">
              <strong>Check:</strong> {problem}
            </p>
          ))}
        </div>
      )}
      <p class={status?.error ? 'export-status is-error' : 'export-status'} role="status">
        {status?.text}
      </p>

      {settings.heightMm < minHeight && (
        <p class="message is-warning">
          <strong>Check:</strong> at {settings.heightMm} mm the plot itself gets very little room
          next to the legend, labels{residual ? ', residual panel' : ''}
          {lanes?.length ? ' and reference lanes' : ''}. A height of at least {minHeight} mm keeps
          about 25 mm for the data.{' '}
          {minHeight <= 230 && (
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() => onChange({ heightMm: minHeight })}
            >
              Use {minHeight} mm
            </button>
          )}
        </p>
      )}

      <Advanced id="export-size" title="Figure size and font">
        <div class="export-grid">
          {settings.preset === 'custom' && (
            <label class="export-field">
              Width (mm)
              <input
                type="number"
                inputMode="decimal"
                min={30}
                max={300}
                step={1}
                value={settings.customWidthMm ?? EXPORT_PRESETS.custom.widthMm}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (Number.isFinite(value))
                    onChange({ customWidthMm: Math.min(300, Math.max(30, value)) });
                }}
              />
            </label>
          )}
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
      </Advanced>
    </section>
  );
}
