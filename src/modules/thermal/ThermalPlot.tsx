import { useMemo } from 'preact/hooks';
import { PlotPanel, type PlotInteraction, type PlotSettings } from '../../ui/plot/PlotPanel';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { SeriesSource } from '../../ui/plot/series';
import type { AxisLabels, PlotBand } from '../../ui/plot/types';

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
  /** Shaded temperature ranges, for example the mass loss steps. */
  bands?: readonly PlotBand[];
  /** Numbers or short labels above points of the mass curve. */
  peakLabels?: PeakLabelSet;
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
      {...(props.peakLabels && { peakLabels: props.peakLabels })}
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
