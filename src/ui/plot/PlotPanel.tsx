import { useEffect, useMemo, useState } from 'preact/hooks';
import { HelpTip } from '../HelpTip';
import { ExportPanel } from './ExportPanel';
import type { ExportSettings, LowerAxis } from './export';
import { InteractivePlot, type InteractivePlotProps } from './InteractivePlot';
import type { PeakLabelSet } from './peakLabels';
import { ReferenceLanes, type ReferenceLane } from './ReferenceLanes';
import { prepareSeries, xExtent, type SeriesSource } from './series';
import type { AxisLabels, Domain, PlotMarker } from './types';
import { zoomDomain } from './view';
import './plot.css';

export interface PlotSettings {
  normalise: boolean;
  /** Vertical offset between overlaid patterns, percent of the tallest pattern. */
  offsetPercent: number;
  export: ExportSettings;
}

interface PlotPanelProps {
  sources: readonly SeriesSource[];
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
  labels: (normalised: boolean) => AxisLabels;
  /** Name of the x quantity for controls and readouts, for example "2θ". */
  xName: string;
  xUnit: string;
  exportName: string;
  /** Show the normalise and offset options (off for single-pattern views such as cleaning). */
  showOverlayOptions?: boolean;
  /** Clicking, marker and hint options passed to the plot. */
  interaction?: PlotInteraction;
  /** Optional curve drawn in a small panel under the plot with the same x range (a residual unless `lowerAxis` says otherwise). */
  residual?: SeriesSource;
  /** Y axis label and description of the lower panel when it is not a residual (for example DTG). */
  lowerAxis?: LowerAxis & { description: string };
  /** Data points drawn as circles, on screen and in the exported figure (unlike markers). */
  points?: readonly PlotMarker[];
  /** Reference stick patterns drawn under the plot on the same 2θ range (on screen and in the exported figure). */
  lanes?: readonly ReferenceLane[];
  /** Labels above peaks (for example hkl), on screen and in the exported figure. */
  peakLabels?: PeakLabelSet;
  /** When it changes, the view jumps to this x range (in plotted x, so −wavenumber on a reversed axis). */
  focusRange?: Domain | null;
}

export type PlotInteraction = Pick<
  InteractivePlotProps,
  'markers' | 'onPlotClick' | 'hint' | 'onMarkerClick' | 'onMarkerDrag' | 'onMarkerDragEnd'
>;

const residualHeight = (width: number) => Math.round(Math.min(160, Math.max(90, width * 0.18)));

const round = (value: number) => Number(value.toFixed(3));

/** Plot with range controls, normalise and offset options, legend and figure export. */
export function PlotPanel(props: PlotPanelProps) {
  const { sources, settings, onSettingsChange, labels, xName, xUnit, exportName } = props;
  const overlay = props.showOverlayOptions ?? true;
  const normalise = overlay && settings.normalise;
  const offsetFraction = overlay && sources.length > 1 ? settings.offsetPercent / 100 : 0;
  const series = useMemo(
    () => prepareSeries(sources, { normalise, offsetFraction }),
    [sources, normalise, offsetFraction],
  );
  const [lo, hi] = xExtent(series);
  const extent: Domain = useMemo(() => [lo, hi], [lo, hi]);
  const [domain, setDomain] = useState<Domain>(extent);
  useEffect(() => setDomain(extent), [extent]);

  const focusLo = props.focusRange?.[0];
  const focusHi = props.focusRange?.[1];
  useEffect(() => {
    if (focusLo === undefined || focusHi === undefined) return;
    setDomain([Math.max(lo, Math.min(focusLo, focusHi)), Math.min(hi, Math.max(focusLo, focusHi))]);
  }, [focusLo, focusHi, lo, hi]);

  const minSpan = Math.max((hi - lo) / 2000, 1e-6);
  const axisLabels = labels(normalise);
  const reversed = axisLabels.reversed === true;
  /** The number shown for a plotted x: the same, or its negative on a reversed axis. */
  const shown = (x: number) => (reversed ? -x : x);
  const residual = props.residual;
  const residualSeries = useMemo(
    () => (residual ? prepareSeries([residual], { normalise: false, offsetFraction: 0 }) : null),
    [residual],
  );
  const setRange = (which: 0 | 1, text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const next: [number, number] = [domain[0], domain[1]];
    next[which] = shown(value);
    if (next[1] - next[0] < minSpan) return;
    setDomain([Math.max(lo, next[0]), Math.min(hi, next[1])]);
  };
  const centre = (domain[0] + domain[1]) / 2;
  const zoom = (factor: number) => {
    const [a, b] = zoomDomain(domain, factor, centre);
    const span = Math.min(Math.max(b - a, minSpan), hi - lo);
    const start = Math.min(Math.max(centre - span / 2, lo), hi - span);
    setDomain([start, start + span]);
  };

  return (
    <div class="plot-panel">
      {series.filter((s) => !s.quiet).length > 1 && (
        <ul class="plot-legend" aria-label="Legend">
          {series
            .filter((s) => !s.quiet)
            .map((s) => (
              <li key={s.id}>
                <span class={`plot-swatch series-${s.colorIndex % 8}`} aria-hidden="true" />
                {s.name}
              </li>
            ))}
        </ul>
      )}

      {props.peakLabels && props.peakLabels.key.length > 0 && (
        <ul class="plot-legend" aria-label="Peak labels">
          {props.peakLabels.key.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}

      <InteractivePlot
        series={series}
        labels={axisLabels}
        domain={domain}
        extent={extent}
        minSpan={minSpan}
        onDomainChange={setDomain}
        formatX={(x) => `${xName} ${round(shown(x))}${xUnit}`}
        {...(props.points && { markers: props.points })}
        {...(props.peakLabels && { peakLabels: props.peakLabels })}
        {...props.interaction}
        description={`Plot of intensity against ${xName}, ${series.length} pattern${series.length === 1 ? '' : 's'}.`}
      />
      {props.lanes && props.lanes.length > 0 && (
        <ReferenceLanes lanes={props.lanes} domain={domain} />
      )}
      {residualSeries && (
        <InteractivePlot
          series={residualSeries}
          labels={{
            x: axisLabels.x,
            y: props.lowerAxis?.y ?? 'Residual',
            ...(props.lowerAxis?.yValues && { yValues: true }),
          }}
          domain={domain}
          extent={extent}
          minSpan={minSpan}
          onDomainChange={setDomain}
          formatX={(x) => `${xName} ${round(shown(x))}${xUnit}`}
          heightFor={residualHeight}
          hideReadout
          description={props.lowerAxis?.description ?? 'Residual: data minus fit.'}
        />
      )}

      <div class="plot-controls">
        <fieldset class="plot-range">
          <legend>
            {xName} range{xUnit && ` (${xUnit})`}
          </legend>
          <label>
            From
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={round(shown(domain[0]))}
              onChange={(e) => setRange(0, e.currentTarget.value)}
            />
          </label>
          <label>
            To
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={round(shown(domain[1]))}
              onChange={(e) => setRange(1, e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <div class="plot-buttons">
          <button type="button" class="btn" onClick={() => zoom(1.5)}>
            Zoom in
          </button>
          <button type="button" class="btn" onClick={() => zoom(1 / 1.5)}>
            Zoom out
          </button>
          <button type="button" class="btn" onClick={() => setDomain(extent)}>
            Show all
          </button>
        </div>
      </div>

      {overlay && (
        <div class="plot-options">
          <label class="check">
            <input
              type="checkbox"
              checked={settings.normalise}
              onChange={(e) => onSettingsChange({ normalise: e.currentTarget.checked })}
            />
            Normalise
          </label>
          <HelpTip term="normalising">
            <p>
              Each pattern is divided by its own highest intensity, so every pattern peaks at 1.
              This makes it easier to compare peak positions and shapes when overall intensities
              differ. The stored data are not changed.
            </p>
          </HelpTip>
          {sources.length > 1 && (
            <label class="plot-offset">
              Vertical offset
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.offsetPercent}
                onInput={(e) => onSettingsChange({ offsetPercent: Number(e.currentTarget.value) })}
              />
              <output>{settings.offsetPercent} %</output>
            </label>
          )}
        </div>
      )}

      <ExportPanel
        series={series}
        domain={domain}
        labels={axisLabels}
        settings={settings.export}
        onChange={(patch) => onSettingsChange({ export: { ...settings.export, ...patch } })}
        exportName={exportName}
        points={props.points}
        residual={residualSeries ?? undefined}
        peakLabels={props.peakLabels}
        lanes={props.lanes}
        lowerAxis={props.lowerAxis}
      />
    </div>
  );
}
