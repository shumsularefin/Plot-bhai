import { useId, useState } from 'preact/hooks';
import {
  ANNOTATION_LABELS,
  DEFAULT_FIGURE,
  labelKey,
  MARKER_SHAPE_LABELS,
  type MarkerShape,
  type Annotation,
  type AnnotationKind,
  type AxisStyle,
  type DashStyle,
  type FigureStyle,
  type LegendPosition,
  type SeriesStyle,
} from './figure';
import { PRINT_COLORS } from './palette';
import type { PeakLabelSet } from './peakLabels';
import type { PlotSeries } from './types';

/** What a click on the plot will do while the editor waits for one. */
export type Placement =
  | { kind: AnnotationKind; first?: { x: number; y: number }; shape?: MarkerShape }
  | { move: string };

interface FigureEditorProps {
  figure: FigureStyle;
  onChange: (next: FigureStyle) => void;
  /** Series as given by the tool (hidden ones included, original names). */
  series: readonly PlotSeries[];
  peakLabels: PeakLabelSet | undefined;
  /** Axis name and unit for position fields, for example "2θ" and "°". */
  xName: string;
  xUnit: string;
  placement: Placement | null;
  onPlacement: (placement: Placement | null) => void;
}

/** Kinds placed with two clicks that keep both points (start and end, or two corners). */
const twoPoint = (kind: AnnotationKind) => kind === 'line' || kind === 'rect' || kind === 'ellipse';

const DASH_LABELS: Record<DashStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  'dash-dot': 'Dash-dot',
};
const LEGEND_LABELS: Record<LegendPosition, string> = {
  'top-right': 'Top right',
  'top-left': 'Top left',
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
};

/** Browser key for whether the editor is open (shown in Simple and Advanced mode alike). */
const OPEN_KEY = 'figure-editor-open';

/** A number box that reports finite values (or null when emptied). */
function NumberBox(props: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label class="figure-field">
      {props.label}
      <input
        type="number"
        inputMode="decimal"
        step={props.step ?? 'any'}
        {...(props.min !== undefined && { min: props.min })}
        {...(props.max !== undefined && { max: props.max })}
        value={props.value ?? ''}
        onChange={(e) => {
          const text = e.currentTarget.value.trim();
          const v = Number(text);
          if (text === '') props.onChange(null);
          else if (Number.isFinite(v)) props.onChange(v);
        }}
      />
    </label>
  );
}

/** Colour picker with an "automatic" choice. */
function ColorBox(props: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <span class="figure-color">
      <label class="figure-field">
        {props.label}
        <input
          type="color"
          value={props.value || props.fallback}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </label>
      {props.value && (
        <button type="button" class="btn btn-quiet" onClick={() => props.onChange(undefined)}>
          Automatic
        </button>
      )}
    </span>
  );
}

/**
 * The figure editor: line colours, widths, styles, opacity and fills; text, arrows, markers,
 * reference lines and shaded regions; axis titles, y limits, ticks, grid and legend; peak label
 * text. It edits only the figure's appearance, never the data or any result.
 */
export function FigureEditor(props: FigureEditorProps) {
  const { figure, onChange, series, peakLabels, xName, xUnit, placement, onPlacement } = props;
  const uid = useId();
  const [markerShape, setMarkerShape] = useState<MarkerShape>('circle');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setSeries = (id: string, patch: Partial<SeriesStyle>) =>
    onChange({ ...figure, series: { ...figure.series, [id]: { ...figure.series[id], ...patch } } });
  const setAxes = (patch: Partial<AxisStyle>) =>
    onChange({ ...figure, axes: { ...figure.axes, ...patch } });
  const setAnnotation = (id: string, patch: Partial<Annotation>) =>
    onChange({
      ...figure,
      annotations: figure.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  const removeAnnotation = (id: string) =>
    onChange({ ...figure, annotations: figure.annotations.filter((a) => a.id !== id) });
  const named = series.filter((s) => !s.quiet);
  const xLabel = (what: string) => `${what} ${xName}${xUnit ? ` (${xUnit.trim()})` : ''}`;

  return (
    <details
      class="advanced figure-editor"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(OPEN_KEY, next ? '1' : '0');
        } catch {
          // Blocked storage: the editor simply starts closed next time.
        }
      }}
    >
      <summary>Edit graph: lines, fills, text, shapes, axes, legend</summary>
      <div class="advanced-body">
        <p class="field-hint">
          These settings change how the figure looks, here and in every exported file. They never
          change your data or any calculated value.
        </p>

        {peakLabels && peakLabels.labels.length > 0 && (
          <fieldset class="figure-group">
            <legend>Peak labels (Miller indices)</legend>
            <p class="field-hint">
              The labels are written automatically from the phase assignment. Edit any of them here,
              for example to add spaces, a bar for a negative index or a phase symbol.
            </p>
            <label class="check">
              <input
                type="checkbox"
                checked={figure.peakLabels.show}
                onChange={(e) =>
                  onChange({
                    ...figure,
                    peakLabels: { ...figure.peakLabels, show: e.currentTarget.checked },
                  })
                }
              />
              Show peak labels
            </label>
            {figure.peakLabels.show && (
              <div class="figure-labels">
                {peakLabels.labels.map((l) => {
                  const key = labelKey(l.x);
                  return (
                    <label key={key} class="figure-field">
                      At {Number(Math.abs(l.x).toFixed(2))}
                      {xUnit.trim()}
                      <input
                        value={figure.peakLabels.text[key] ?? l.text}
                        onInput={(e) =>
                          onChange({
                            ...figure,
                            peakLabels: {
                              ...figure.peakLabels,
                              text: { ...figure.peakLabels.text, [key]: e.currentTarget.value },
                            },
                          })
                        }
                      />
                    </label>
                  );
                })}
                <p class="field-hint">Empty a box to hide that one label.</p>
              </div>
            )}
          </fieldset>
        )}

        <fieldset class="figure-group">
          <legend>Lines and fills</legend>
          {named.map((s) => {
            const own = figure.series[s.id] ?? {};
            const fill = own.fill ?? 'none';
            const fillValue = typeof fill === 'string' ? fill : `between:${fill.between}`;
            return (
              <div key={s.id} class="figure-row">
                <label class="figure-field figure-name">
                  Name in legend
                  <input
                    value={own.label ?? s.name}
                    onInput={(e) => setSeries(s.id, { label: e.currentTarget.value })}
                  />
                </label>
                <ColorBox
                  label="Colour"
                  value={own.color}
                  fallback={PRINT_COLORS[s.colorIndex % PRINT_COLORS.length] as string}
                  onChange={(color) => setSeries(s.id, { color })}
                />
                <NumberBox
                  label="Width (×, 0 for symbols only)"
                  value={own.width ?? 1}
                  step={0.25}
                  min={0}
                  max={6}
                  onChange={(v) => v !== null && v >= 0 && setSeries(s.id, { width: v })}
                />
                <label class="figure-field">
                  Style
                  <select
                    value={own.dash ?? (s.dashed ? 'dashed' : 'solid')}
                    onChange={(e) => setSeries(s.id, { dash: e.currentTarget.value as DashStyle })}
                  >
                    {(Object.keys(DASH_LABELS) as DashStyle[]).map((d) => (
                      <option key={d} value={d}>
                        {DASH_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberBox
                  label="Opacity (0–1)"
                  value={own.opacity ?? 1}
                  step={0.1}
                  min={0}
                  max={1}
                  onChange={(v) =>
                    v !== null && v >= 0 && v <= 1 && setSeries(s.id, { opacity: v })
                  }
                />
                <label class="figure-field">
                  Fill
                  <select
                    value={fillValue}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setSeries(s.id, {
                        fill: v.startsWith('between:')
                          ? { between: v.slice(8) }
                          : (v as 'none' | 'below'),
                      });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="below">Under the curve</option>
                    {named
                      .filter((t) => t.id !== s.id)
                      .map((t) => (
                        <option key={t.id} value={`between:${t.id}`}>
                          Between this and {figure.series[t.id]?.label ?? t.name}
                        </option>
                      ))}
                  </select>
                </label>
                {fill !== 'none' && (
                  <ColorBox
                    label="Fill colour"
                    value={own.fillColor}
                    fallback={
                      own.color ?? (PRINT_COLORS[s.colorIndex % PRINT_COLORS.length] as string)
                    }
                    onChange={(fillColor) => setSeries(s.id, { fillColor })}
                  />
                )}
                <label class="figure-field">
                  Symbols
                  <select
                    value={own.symbol ?? 'none'}
                    onChange={(e) =>
                      setSeries(s.id, { symbol: e.currentTarget.value as MarkerShape | 'none' })
                    }
                  >
                    <option value="none">None (line only)</option>
                    {(Object.keys(MARKER_SHAPE_LABELS) as MarkerShape[]).map((shape) => (
                      <option key={shape} value={shape}>
                        {MARKER_SHAPE_LABELS[shape]}
                      </option>
                    ))}
                  </select>
                </label>
                {own.symbol && own.symbol !== 'none' && (
                  <NumberBox
                    label="Symbol size (×)"
                    value={own.symbolSize ?? 1}
                    step={0.25}
                    min={0.25}
                    max={4}
                    onChange={(v) => v !== null && v > 0 && setSeries(s.id, { symbolSize: v })}
                  />
                )}
                {fill !== 'none' && (
                  <NumberBox
                    label="Fill opacity (0–1)"
                    value={own.fillOpacity ?? 0.25}
                    step={0.05}
                    min={0}
                    max={1}
                    onChange={(v) =>
                      v !== null && v >= 0 && v <= 1 && setSeries(s.id, { fillOpacity: v })
                    }
                  />
                )}
                <label class="check">
                  <input
                    type="checkbox"
                    checked={own.hidden === true}
                    onChange={(e) => setSeries(s.id, { hidden: e.currentTarget.checked })}
                  />
                  Hide
                </label>
              </div>
            );
          })}
        </fieldset>

        <fieldset class="figure-group">
          <legend>Annotations</legend>
          <div class="figure-buttons">
            {(Object.keys(ANNOTATION_LABELS) as AnnotationKind[]).map((kind) => {
              const active = placement !== null && 'kind' in placement && placement.kind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  class="btn"
                  aria-pressed={active}
                  onClick={() =>
                    onPlacement(
                      active ? null : { kind, ...(kind === 'marker' && { shape: markerShape }) },
                    )
                  }
                >
                  Add {ANNOTATION_LABELS[kind].toLowerCase()}
                </button>
              );
            })}
            <label class="figure-field">
              Marker shape
              <select
                value={markerShape}
                onChange={(e) => {
                  const shape = e.currentTarget.value as MarkerShape;
                  setMarkerShape(shape);
                  if (placement && 'kind' in placement && placement.kind === 'marker')
                    onPlacement({ kind: 'marker', shape });
                }}
              >
                {(Object.keys(MARKER_SHAPE_LABELS) as MarkerShape[]).map((shape) => (
                  <option key={shape} value={shape}>
                    {MARKER_SHAPE_LABELS[shape]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {placement && (
            <p class="message is-info" role="status">
              {'move' in placement
                ? 'Click or tap the plot where the annotation should go.'
                : placement.kind === 'arrow'
                  ? placement.first
                    ? 'Now click where the arrow should point.'
                    : 'Click where the arrow should start (its tail).'
                  : placement.kind === 'region' || placement.kind === 'line'
                    ? placement.first
                      ? `Now click where the ${placement.kind} should end.`
                      : `Click where the ${placement.kind} should start.`
                    : placement.kind === 'rect' || placement.kind === 'ellipse'
                      ? placement.first
                        ? 'Now click the opposite corner.'
                        : 'Click one corner of the box.'
                      : `Click or tap the plot to place a ${ANNOTATION_LABELS[placement.kind].toLowerCase()}; keep clicking to add more.`}{' '}
              <button type="button" class="btn btn-quiet" onClick={() => onPlacement(null)}>
                Done
              </button>
            </p>
          )}
          {figure.annotations.length === 0 && !placement && (
            <p class="field-hint">None yet. Choose one above, then click the plot.</p>
          )}
          {figure.annotations.map((a) => (
            <div key={a.id} class="figure-row">
              <strong class="figure-kind">{ANNOTATION_LABELS[a.kind]}</strong>
              <label class="figure-field figure-name">
                Text
                <input
                  value={a.text}
                  onInput={(e) => setAnnotation(a.id, { text: e.currentTarget.value })}
                />
              </label>
              {a.kind !== 'hline' && (
                <NumberBox
                  label={xLabel(a.kind === 'arrow' ? 'Points to' : 'At')}
                  value={a.x}
                  onChange={(v) => v !== null && setAnnotation(a.id, { x: v })}
                />
              )}
              {a.kind !== 'vline' && a.kind !== 'region' && (
                <NumberBox
                  label={a.kind === 'arrow' ? 'Points to y' : twoPoint(a.kind) ? 'From y' : 'y'}
                  value={a.y}
                  onChange={(v) => v !== null && setAnnotation(a.id, { y: v })}
                />
              )}
              {(a.kind === 'arrow' || a.kind === 'region' || twoPoint(a.kind)) && (
                <NumberBox
                  label={xLabel(a.kind === 'arrow' ? 'Starts at' : 'To')}
                  value={a.x2}
                  onChange={(v) => v !== null && setAnnotation(a.id, { x2: v })}
                />
              )}
              {(a.kind === 'arrow' || twoPoint(a.kind)) && (
                <NumberBox
                  label={a.kind === 'arrow' ? 'Starts at y' : 'To y'}
                  value={a.y2}
                  onChange={(v) => v !== null && setAnnotation(a.id, { y2: v })}
                />
              )}
              {a.kind === 'marker' && (
                <label class="figure-field">
                  Shape
                  <select
                    value={a.shape ?? 'circle'}
                    onChange={(e) =>
                      setAnnotation(a.id, { shape: e.currentTarget.value as MarkerShape })
                    }
                  >
                    {(Object.keys(MARKER_SHAPE_LABELS) as MarkerShape[]).map((shape) => (
                      <option key={shape} value={shape}>
                        {MARKER_SHAPE_LABELS[shape]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <ColorBox
                label="Colour"
                value={a.color || undefined}
                fallback="#000000"
                onChange={(color) => setAnnotation(a.id, { color: color ?? '' })}
              />
              <NumberBox
                label={a.kind === 'marker' ? 'Size (×)' : 'Text size (×)'}
                value={a.size}
                step={0.1}
                min={0.5}
                max={4}
                onChange={(v) => v !== null && v > 0 && setAnnotation(a.id, { size: v })}
              />
              {a.kind !== 'text' && a.kind !== 'marker' && a.kind !== 'region' && (
                <>
                  <NumberBox
                    label="Line width (×)"
                    value={a.lineWidth ?? 1}
                    step={0.25}
                    min={0.25}
                    max={6}
                    onChange={(v) => v !== null && v > 0 && setAnnotation(a.id, { lineWidth: v })}
                  />
                  <label class="figure-field">
                    Line style
                    <select
                      value={
                        a.dash ?? (a.kind === 'vline' || a.kind === 'hline' ? 'dashed' : 'solid')
                      }
                      onChange={(e) =>
                        setAnnotation(a.id, { dash: e.currentTarget.value as DashStyle })
                      }
                    >
                      {(Object.keys(DASH_LABELS) as DashStyle[]).map((d) => (
                        <option key={d} value={d}>
                          {DASH_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {(a.kind === 'rect' || a.kind === 'ellipse') && (
                <>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={Boolean(a.fill)}
                      onChange={(e) =>
                        setAnnotation(a.id, { fill: e.currentTarget.checked ? '#cccccc' : '' })
                      }
                    />
                    Fill
                  </label>
                  {a.fill && (
                    <>
                      <ColorBox
                        label="Fill colour"
                        value={a.fill}
                        fallback="#cccccc"
                        onChange={(fill) => setAnnotation(a.id, { fill: fill ?? '#cccccc' })}
                      />
                      <NumberBox
                        label="Fill opacity (0–1)"
                        value={a.fillOpacity ?? 0.25}
                        step={0.05}
                        min={0}
                        max={1}
                        onChange={(v) =>
                          v !== null && v >= 0 && v <= 1 && setAnnotation(a.id, { fillOpacity: v })
                        }
                      />
                    </>
                  )}
                </>
              )}
              <label class="check">
                <input
                  type="checkbox"
                  checked={a.bold === true}
                  onChange={(e) => setAnnotation(a.id, { bold: e.currentTarget.checked })}
                />
                Bold
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={a.italic === true}
                  onChange={(e) => setAnnotation(a.id, { italic: e.currentTarget.checked })}
                />
                Italic
              </label>
              {a.kind === 'region' && (
                <NumberBox
                  label="Opacity (0–1)"
                  value={a.opacity}
                  step={0.05}
                  min={0}
                  max={1}
                  onChange={(v) =>
                    v !== null && v >= 0 && v <= 1 && setAnnotation(a.id, { opacity: v })
                  }
                />
              )}
              <span class="figure-buttons">
                <button type="button" class="btn" onClick={() => onPlacement({ move: a.id })}>
                  Move
                </button>
                <button
                  type="button"
                  class="btn"
                  aria-label={`Remove ${ANNOTATION_LABELS[a.kind].toLowerCase()} ${a.text}`.trim()}
                  onClick={() => removeAnnotation(a.id)}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </fieldset>

        <fieldset class="figure-group">
          <legend>Axes, grid and legend</legend>
          <div class="figure-row">
            <label class="figure-field figure-name">
              x-axis title
              <input
                value={figure.axes.xTitle ?? ''}
                placeholder="the tool's title"
                onInput={(e) => setAxes({ xTitle: e.currentTarget.value || null })}
              />
            </label>
            <label class="figure-field figure-name">
              y-axis title
              <input
                value={figure.axes.yTitle ?? ''}
                placeholder="the tool's title"
                onInput={(e) => setAxes({ yTitle: e.currentTarget.value || null })}
              />
            </label>
          </div>
          <div class="figure-row">
            <NumberBox
              label="y from"
              value={figure.axes.yMin}
              onChange={(yMin) => setAxes({ yMin })}
            />
            <NumberBox
              label="y to"
              value={figure.axes.yMax}
              onChange={(yMax) => setAxes({ yMax })}
            />
            <label class="figure-field">
              Numbers on the y axis
              <select
                value={figure.axes.yValues}
                onChange={(e) =>
                  setAxes({ yValues: e.currentTarget.value as AxisStyle['yValues'] })
                }
              >
                <option value="auto">As the tool chooses</option>
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </select>
            </label>
            <label class="figure-field">
              Tick marks
              <select
                value={figure.axes.ticks}
                onChange={(e) => setAxes({ ticks: e.currentTarget.value as AxisStyle['ticks'] })}
              >
                <option value="in">Inward</option>
                <option value="out">Outward</option>
              </select>
            </label>
            <label class="figure-field">
              Frame
              <select
                value={figure.axes.frame}
                onChange={(e) => setAxes({ frame: e.currentTarget.value as AxisStyle['frame'] })}
              >
                <option value="box">Closed box</option>
                <option value="open">Left and bottom axes only</option>
              </select>
            </label>
            <NumberBox
              label="Axis line width (×)"
              value={figure.axes.axisWidth}
              step={0.25}
              min={0.25}
              max={4}
              onChange={(v) => v !== null && v > 0 && setAxes({ axisWidth: v })}
            />
            <label class="figure-field">
              Grid lines
              <select
                value={figure.axes.grid}
                onChange={(e) => setAxes({ grid: e.currentTarget.value as AxisStyle['grid'] })}
              >
                <option value="none">None</option>
                <option value="x">Vertical</option>
                <option value="y">Horizontal</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>
          <p class="field-hint">
            Leave the y limits empty to fit the visible data. The {xName} range is set with the
            range boxes under the plot.
          </p>
          <div class="figure-row">
            <label class="check">
              <input
                type="checkbox"
                checked={figure.legend.show}
                onChange={(e) =>
                  onChange({
                    ...figure,
                    legend: { ...figure.legend, show: e.currentTarget.checked },
                  })
                }
              />
              Legend in the exported figure
            </label>
            <label class="figure-field">
              Legend position
              <select
                id={`${uid}-legend`}
                value={figure.legend.position}
                onChange={(e) =>
                  onChange({
                    ...figure,
                    legend: { ...figure.legend, position: e.currentTarget.value as LegendPosition },
                  })
                }
              >
                {(Object.keys(LEGEND_LABELS) as LegendPosition[]).map((p) => (
                  <option key={p} value={p}>
                    {LEGEND_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <p>
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => {
              onPlacement(null);
              onChange(DEFAULT_FIGURE);
            }}
          >
            Reset the figure styling
          </button>
        </p>
      </div>
    </details>
  );
}
