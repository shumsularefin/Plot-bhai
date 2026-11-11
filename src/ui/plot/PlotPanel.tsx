import type { ComponentChildren } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Advanced } from '../Advanced';
import { Dock } from '../Dock';
import { HelpTip } from '../HelpTip';
import { ExportPanel } from './ExportPanel';
import { FigureEditor, type Placement } from './FigureEditor';
import {
  clicksFor,
  newAnnotation,
  resolveFigure,
  styledSeries,
  type EditRef,
  type FigureStyle,
} from './figure';
import { moveObject, ObjectEditor } from './ObjectEditor';
import type { ExportSettings, LowerAxis } from './export';
import { InteractivePlot, type InteractivePlotProps, type PlotEditing } from './InteractivePlot';
import type { PeakLabelSet } from './peakLabels';
import { laneGuides, ReferenceLanes, type ReferenceLane } from './ReferenceLanes';
import { prepareSeries, seriesTransforms, xExtent, type SeriesSource } from './series';
import type { AxisLabels, Domain, PlotBand, PlotMarker } from './types';
import { zoomDomain } from './view';
import './plot.css';

/**
 * How several curves share the plot: on top of each other, lifted by a fixed step (a waterfall
 * whose peaks may still cross), or stacked so that no two curves overlap.
 */
export type PlotLayout = 'overlap' | 'offset' | 'stack';

export interface PlotSettings {
  normalise: boolean;
  /** Vertical offset between overlaid patterns (or gap between stacked ones), percent of the tallest pattern. */
  offsetPercent: number;
  /** Missing in sessions saved before the choice existed: then 'offset' when offsetPercent > 0. */
  layout?: PlotLayout;
  export: ExportSettings;
  /** Figure styling per plot (keyed by the plot's export name), from the figure editor. */
  figures?: Record<string, Partial<FigureStyle>>;
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
  /** Shaded x ranges behind the curves with a label each, on screen and in the exported figure. */
  bands?: readonly PlotBand[];
  /** Reference stick patterns drawn under the plot on the same 2θ range (on screen and in the exported figure). */
  lanes?: readonly ReferenceLane[];
  /** How the lanes' line heights are scaled, shown in their key on screen. */
  lanesKey?: string;
  /** Labels above peaks (for example hkl), on screen and in the exported figure. */
  peakLabels?: PeakLabelSet;
  /** When it changes, the view jumps to this x range (in plotted x, so −wavenumber on a reversed axis). */
  focusRange?: Domain | null;
  /** View controls of the step (for example Before / After), shown with the plot. */
  toolbar?: ComponentChildren;
  /** How the figure is kept in view while settings change (see Dock): 'manual' for secondary plots. */
  dock?: 'auto' | 'manual';
}

export type PlotInteraction = Pick<
  InteractivePlotProps,
  'markers' | 'onPlotClick' | 'hint' | 'onMarkerClick' | 'onMarkerDrag' | 'onMarkerDragEnd'
>;

const residualHeight = (width: number) => Math.round(Math.min(160, Math.max(90, width * 0.18)));

const round = (value: number) => Number(value.toFixed(3));

const LAYOUTS: { id: PlotLayout; label: string }[] = [
  { id: 'overlap', label: 'Overlap' },
  { id: 'offset', label: 'Offset' },
  { id: 'stack', label: 'Stack' },
];

/** The layout in use, reading sessions saved before the choice existed from their offset. */
export function plotLayout(settings: PlotSettings): PlotLayout {
  return settings.layout ?? (settings.offsetPercent > 0 ? 'offset' : 'overlap');
}

/** Plot with range controls, normalise and offset options, legend and figure export. */
export function PlotPanel(props: PlotPanelProps) {
  const { sources, settings, onSettingsChange, labels, xName, xUnit, exportName } = props;
  const overlay = props.showOverlayOptions ?? true;
  const normalise = overlay && settings.normalise;
  const layout = plotLayout(settings);
  const layoutId = useId();
  const several = overlay && sources.length > 1;
  const offsetFraction = several && layout !== 'overlap' ? settings.offsetPercent / 100 : 0;
  const stack = several && layout === 'stack';
  const series = useMemo(
    () => prepareSeries(sources, { normalise, offsetFraction, stack }),
    [sources, normalise, offsetFraction, stack],
  );
  // Peak labels follow their curve when it is normalised, offset or stacked. A label without a
  // curve id belongs to the only curve when there is one, and is left as given otherwise.
  const rawLabels = props.peakLabels;
  const peakLabels = useMemo(() => {
    if (!rawLabels) return undefined;
    const transforms = seriesTransforms(sources, { normalise, offsetFraction, stack });
    const indexOf = new Map(sources.map((src, i) => [src.id, i]));
    return {
      ...rawLabels,
      labels: rawLabels.labels.map((label) => {
        const i =
          label.seriesId !== undefined
            ? indexOf.get(label.seriesId)
            : sources.length === 1
              ? 0
              : undefined;
        const t = i === undefined ? undefined : transforms[i];
        return t && (t.scale !== 1 || t.shift !== 0)
          ? { ...label, y: label.y * t.scale + t.shift }
          : label;
      }),
    };
  }, [rawLabels, sources, normalise, offsetFraction, stack]);
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

  const figure = resolveFigure(settings.figures?.[exportName]);
  const setFigure = (next: FigureStyle) =>
    onSettingsChange({ figures: { ...settings.figures, [exportName]: next } });
  const [placement, setPlacement] = useState<Placement | null>(null);
  // An object picked on the plot, and the figure as it looks while it is being dragged.
  const [selected, setSelected] = useState<EditRef | null>(null);
  const [dragged, setDragged] = useState<FigureStyle | null>(null);
  const draggedRef = useRef<FigureStyle | null>(null);
  draggedRef.current = dragged;
  const plotRef = useRef<HTMLDivElement>(null);
  const placing = placement !== null;
  // The editor sits under the plot; bring the plot into view when it waits for a click.
  // Escape ends placing annotations.
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setPlacement(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);
  useEffect(() => {
    if (!placing) return;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    plotRef.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [placing]);
  const minSpan = Math.max((hi - lo) / 2000, 1e-6);
  const axisLabels = labels(normalise);
  const reversed = axisLabels.reversed === true;
  /** The number shown for a plotted x: the same, or its negative on a reversed axis. */
  const shown = (x: number) => (reversed ? -x : x);
  const residual = props.residual;
  const guides = useMemo(() => laneGuides(props.lanes), [props.lanes]);
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
  /** A click while the figure editor waits for one: place or move an annotation. */
  const place = (plotX: number, y: number) => {
    if (!placement) return;
    const x = shown(plotX);
    if ('move' in placement) {
      setFigure({
        ...figure,
        annotations: figure.annotations.map((a) => {
          if (a.id !== placement.move) return a;
          // Arrows and regions move as a whole, keeping their shape.
          const dx = x - a.x;
          const dy = y - a.y;
          return {
            ...a,
            x,
            y,
            ...(a.x2 !== undefined && { x2: a.x2 + dx }),
            ...(a.y2 !== undefined && { y2: a.y2 + dy }),
          };
        }),
      });
      setPlacement(null);
      return;
    }
    if (clicksFor(placement.kind) === 2 && !placement.first) {
      setPlacement({ ...placement, first: { x, y } });
      return;
    }
    const first = placement.first;
    const annotation =
      placement.kind === 'arrow' && first
        ? newAnnotation('arrow', x, y, first)
        : first
          ? newAnnotation(placement.kind, first.x, first.y, { x, y })
          : newAnnotation(placement.kind, x, y, undefined, placement.shape);
    setFigure({ ...figure, annotations: [...figure.annotations, annotation] });
    // The tool stays chosen, so several markers (or lines, labels) can be placed in a row.
    setPlacement({ kind: placement.kind, ...(placement.shape && { shape: placement.shape }) });
  };
  const interaction: PlotInteraction | undefined = placement
    ? {
        ...(props.interaction?.markers && { markers: props.interaction.markers }),
        onPlotClick: place,
        hint: 'Click or tap the plot to place the annotation.',
      }
    : props.interaction;
  const editing: PlotEditing | undefined = placement
    ? undefined
    : {
        selected,
        onSelect: setSelected,
        onMove: (ref, move) => {
          setSelected(ref);
          setDragged(moveObject(figure, ref, move, reversed));
        },
        onMoveEnd: () => {
          if (draggedRef.current) setFigure(draggedRef.current);
          setDragged(null);
        },
      };
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);
  const legendSeries = styledSeries(series, figure).filter((s) => !s.quiet);
  const centre = (domain[0] + domain[1]) / 2;
  const zoom = (factor: number) => {
    const [a, b] = zoomDomain(domain, factor, centre);
    const span = Math.min(Math.max(b - a, minSpan), hi - lo);
    const start = Math.min(Math.max(centre - span / 2, lo), hi - span);
    setDomain([start, start + span]);
  };

  return (
    <div class="plot-panel">
      <Dock label="Plot" mode={props.dock ?? 'auto'}>
        {props.toolbar}
        {legendSeries.length > 1 && (
          <ul class="plot-legend" aria-label="Legend">
            {legendSeries.map((s) => {
              const color = figure.series[s.id]?.color;
              return (
                <li key={s.id}>
                  <span
                    class={`plot-swatch series-${s.colorIndex % 8}`}
                    style={color ? { background: color } : undefined}
                    aria-hidden="true"
                  />
                  {s.name}
                </li>
              );
            })}
          </ul>
        )}

        {props.peakLabels && props.peakLabels.key.length > 0 && (
          <ul class="plot-legend" aria-label="Peak labels">
            {props.peakLabels.key.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        )}

        {(domain[0] > extent[0] || domain[1] < extent[1]) && (
          <button
            type="button"
            class="btn btn-quiet plot-show-all"
            onClick={() => setDomain(extent)}
          >
            Show the whole range
          </button>
        )}
        <div ref={plotRef}>
          <InteractivePlot
            series={series}
            labels={axisLabels}
            domain={domain}
            extent={extent}
            minSpan={minSpan}
            onDomainChange={setDomain}
            formatX={(x) => `${xName} ${round(shown(x))}${xUnit}`}
            {...(props.points && { markers: props.points })}
            {...(props.bands && { bands: props.bands })}
            {...(peakLabels && { peakLabels })}
            guides={guides}
            {...interaction}
            figure={dragged ?? figure}
            {...(editing && { editing })}
            description={`Plot of intensity against ${xName}, ${series.length} curve${series.length === 1 ? '' : 's'}.`}
          />
        </div>
        {selected && !placement ? (
          <ObjectEditor
            selected={selected}
            figure={figure}
            onChange={setFigure}
            peakLabels={peakLabels}
            onClose={() => setSelected(null)}
          />
        ) : (
          (peakLabels || figure.annotations.length > 0) &&
          !placement && (
            <p class="field-hint plot-edit-hint">
              Click a label or annotation on the plot to edit it; drag it to move it.
            </p>
          )
        )}
        {props.lanes && props.lanes.length > 0 && (
          <ReferenceLanes
            lanes={props.lanes}
            domain={domain}
            {...(props.lanesKey && { keyNote: props.lanesKey })}
          />
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
        {overlay && (
          <div class="plot-options">
            {sources.length > 1 && (
              <div class="plot-layout">
                <span id={layoutId}>Several curves</span>
                <HelpTip term="overlap, offset and stack">
                  <p>
                    <strong>Overlap</strong> draws every curve on the same baseline.{' '}
                    <strong>Offset</strong> lifts each curve by the same step, so tall peaks can
                    still cross the curve above. <strong>Stack</strong> places each curve just above
                    the one below it, so none overlap, like a stacked graph in Origin. The first
                    curve in the list is at the bottom. Only the drawing changes; the stored data
                    and the values read from the plot stay the same.
                  </p>
                </HelpTip>
                <div class="segmented" role="radiogroup" aria-labelledby={layoutId}>
                  {LAYOUTS.map((l) => (
                    <label key={l.id} class={layout === l.id ? 'is-selected' : undefined}>
                      <input
                        type="radio"
                        name={layoutId}
                        checked={layout === l.id}
                        onChange={() =>
                          onSettingsChange({
                            layout: l.id,
                            // A gap of 0 would make Offset look the same as Overlap.
                            ...(l.id !== 'overlap' &&
                              settings.offsetPercent === 0 && { offsetPercent: 20 }),
                          })
                        }
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
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
            {sources.length > 1 && layout !== 'overlap' && (
              <label class="plot-offset">
                {layout === 'stack' ? 'Gap' : 'Step'}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.offsetPercent}
                  onInput={(e) =>
                    onSettingsChange({ offsetPercent: Number(e.currentTarget.value) })
                  }
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
          bands={props.bands}
          residual={residualSeries ?? undefined}
          peakLabels={peakLabels}
          lanes={props.lanes}
          lowerAxis={props.lowerAxis}
          figure={figure}
        />
      </Dock>

      <Advanced id="plot-range" title="Plot range">
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
      </Advanced>

      <FigureEditor
        figure={figure}
        onChange={setFigure}
        series={series}
        peakLabels={peakLabels}
        xName={xName}
        xUnit={xUnit}
        placement={placement}
        onPlacement={setPlacement}
      />
    </div>
  );
}
