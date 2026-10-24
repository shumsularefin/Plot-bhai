import { useMemo } from 'preact/hooks';
import type { DscEvent } from '../../../core/thermal/dsc';
import { displayExoUp, type DscCurve, type DscSetup } from '../../../core/thermal/dscClean';
import { PlotPanel, type PlotInteraction, type PlotSettings } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import type { AxisLabels, PlotBand } from '../../../ui/plot/types';

/** One curve to draw: exo-positive heat flow against increasing temperature. */
export interface DscLine {
  id: string;
  name: string;
  temperatureC: Float64Array;
  exo: Float64Array;
  dashed?: boolean;
  colorIndex?: number;
}

/** The axis text that states the convention; it appears on every DSC plot. */
export const heatFlowLabel = (unit: DscCurve['unit'], exoUp: boolean) =>
  `Heat flow (${unit}), exo ${exoUp ? '↑' : '↓'}`;

interface DscPlotProps {
  lines: readonly DscLine[];
  unit: DscCurve['unit'];
  setup: DscSetup;
  /** Events whose baselines are drawn (dashed). */
  events?: readonly DscEvent[];
  bands?: readonly PlotBand[];
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
  exportName: string;
  interaction?: PlotInteraction;
}

/**
 * Heat flow against temperature. The analysis is exo-positive; for exo down the series are
 * negated here so the axis shows the convention the user chose, and the axis label says which.
 */
export function DscPlot(props: DscPlotProps) {
  const { lines, unit, setup, events } = props;
  const exoUp = displayExoUp(setup);
  const sign = exoUp ? 1 : -1;
  const sources = useMemo<SeriesSource[]>(
    () => [
      ...lines.map((l) => ({
        id: l.id,
        name: l.name,
        x: l.temperatureC,
        y: sign === 1 ? l.exo : l.exo.map((v) => -v),
        unit,
        ...(l.dashed && { dashed: true }),
        ...(l.colorIndex !== undefined && { colorIndex: l.colorIndex }),
      })),
      ...(events ?? []).map((e) => ({
        id: `baseline-${e.id}`,
        name: `Baseline, event ${e.id}`,
        x: e.curve.temperatureC,
        y: sign === 1 ? e.curve.baseline : e.curve.baseline.map((v) => -v),
        unit,
        dashed: true,
        colorIndex: 2,
        quiet: true,
      })),
    ],
    [lines, events, unit, sign],
  );
  const labels = useMemo(
    () => (): AxisLabels => ({
      x: 'Temperature (°C)',
      y: heatFlowLabel(unit, exoUp),
      yValues: true,
    }),
    [unit, exoUp],
  );
  return (
    <PlotPanel
      sources={sources}
      settings={props.settings}
      onSettingsChange={props.onSettingsChange}
      labels={labels}
      xName="T"
      xUnit=" °C"
      exportName={props.exportName}
      showOverlayOptions={false}
      {...(props.interaction && { interaction: props.interaction })}
      {...(props.bands && { bands: props.bands })}
    />
  );
}
