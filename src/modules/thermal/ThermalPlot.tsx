import { useMemo } from 'preact/hooks';
import { PlotPanel, type PlotInteraction, type PlotSettings } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { AxisLabels, PlotBand } from '../../ui/plot/types';
import type { StepResult } from '../../core/thermal/steps';

/** One mass curve to draw: mass against temperature (°C). */
export interface MassCurve {
  id: string;
  name: string;
  temperatureC: Float64Array;
  /** Mass in % (or mg when `unit` says so). */
  mass: Float64Array;
  dashed?: boolean;
  colorIndex?: number;
}

export interface DtgCurve {
  temperatureC: Float64Array;
  /** DTG values in the unit given by `unit`. */
  values: Float64Array;
  /** Axis unit text, for example "%/°C". */
  unit: string;
}

interface ThermalPlotProps {
  curves: readonly MassCurve[];
  /** Unit of the mass values: "%" or "mg". */
  massUnit: '%' | 'mg';
  dtg?: DtgCurve;
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
  exportName: string;
  interaction?: PlotInteraction;
  /** Steps to shade and number (only for a curve in %). */
  steps?: readonly StepResult[];
  /** Further x ranges to shade, for example the plateau above the calcination minimum. */
  shade?: readonly PlotBand[];
  /** Extra text for a step in the key, for example its assigned event. */
  stepNote?: (step: StepResult) => string;
}

const temperatureLabel = 'Temperature (°C)';

/** Mass against temperature, with the DTG curve in a panel underneath when given. */
export function ThermalPlot(props: ThermalPlotProps) {
  const { curves, massUnit, dtg } = props;
  const sources = useMemo<SeriesSource[]>(
    () =>
      curves.map((c) => ({
        id: c.id,
        name: c.name,
        x: c.temperatureC,
        y: c.mass,
        unit: massUnit,
        ...(c.dashed && { dashed: true }),
        ...(c.colorIndex !== undefined && { colorIndex: c.colorIndex }),
      })),
    [curves, massUnit],
  );
  const labels = useMemo(
    () => (): AxisLabels => ({
      x: temperatureLabel,
      y: massUnit === '%' ? 'Mass (%)' : 'Mass (mg)',
      yValues: true,
    }),
    [massUnit],
  );
  const lower = useMemo<SeriesSource | undefined>(
    () =>
      dtg
        ? {
            id: 'dtg',
            name: 'DTG',
            x: dtg.temperatureC,
            y: dtg.values,
            unit: dtg.unit,
          }
        : undefined,
    [dtg],
  );
  const bands = useMemo<PlotBand[] | undefined>(
    () => [
      ...(props.steps ?? []).map((s) => ({ from: s.fromC, to: s.toC })),
      ...(props.shade ?? []),
    ],
    [props.steps, props.shade],
  );
  const { stepNote } = props;
  const peakLabels = useMemo<PeakLabelSet | undefined>(() => {
    const steps = props.steps;
    if (!steps || steps.length === 0 || massUnit !== '%') return undefined;
    return {
      labels: steps.map((s) => ({ x: s.peakC, y: s.massBeforePct, text: String(s.id) })),
      key: steps.map(
        (s) =>
          `${s.id}: ${s.lossPct.toFixed(1)} % loss, ${s.onsetC.toFixed(0)} to ${s.endsetC.toFixed(0)} °C${stepNote ? stepNote(s) : ''}`,
      ),
    };
  }, [props.steps, massUnit, stepNote]);
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
      {...(bands && bands.length > 0 && { bands })}
      {...(peakLabels && { peakLabels })}
      {...(lower &&
        dtg && {
          residual: lower,
          lowerAxis: {
            y: `DTG (${dtg.unit})`,
            yValues: true,
            description: `Derivative thermogravimetry, ${dtg.unit}, against temperature.`,
          },
        })}
    />
  );
}
