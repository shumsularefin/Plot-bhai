import { useMemo } from 'preact/hooks';
import { energyFromWavelength } from '../../core/uvvis/conversions';
import type { DisplayQuantity } from '../../core/uvvis/process';
import { PlotPanel, type PlotSettings } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { ViewSettings } from './data';
import { quantityUnit, uvvisLabels } from './labels';

/** One curve to draw, in nm, before the x axis choice is applied. */
export interface Curve {
  id: string;
  name: string;
  wavelengthNm: Float64Array;
  values: Float64Array;
  colorIndex?: number;
  dashed?: boolean;
}

/**
 * Builds plot sources: points whose value could not be calculated are left out, and for an
 * energy axis the curves are turned around so x still increases (E = hc / λ).
 */
export function curveSources(
  curves: readonly Curve[],
  xUnit: ViewSettings['xUnit'],
): SeriesSource[] {
  return curves.map((curve) => {
    const keep: number[] = [];
    for (let i = 0; i < curve.values.length; i++)
      if (Number.isFinite(curve.values[i])) keep.push(i);
    const ordered = xUnit === 'ev' ? keep.reverse() : keep;
    return {
      id: curve.id,
      name: curve.name,
      x: Float64Array.from(ordered, (i) =>
        xUnit === 'ev'
          ? energyFromWavelength(curve.wavelengthNm[i] as number)
          : (curve.wavelengthNm[i] as number),
      ),
      y: Float64Array.from(ordered, (i) => curve.values[i] as number),
      unit: '',
      ...(curve.colorIndex !== undefined && { colorIndex: curve.colorIndex }),
      ...(curve.dashed && { dashed: true }),
    };
  });
}

interface UvvisPlotProps {
  curves: readonly Curve[];
  view: ViewSettings;
  /** What the y axis shows; null when spectra of different kinds are drawn together. */
  quantity: DisplayQuantity | null;
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
  exportName: string;
}

/** The shared plot panel set up for UV-Vis spectra. */
export function UvvisPlot({
  curves,
  view,
  quantity,
  settings,
  onSettingsChange,
  exportName,
}: UvvisPlotProps) {
  const unit = quantityUnit(quantity);
  const sources = useMemo(
    () => curveSources(curves, view.xUnit).map((s) => ({ ...s, unit })),
    [curves, view.xUnit, unit],
  );
  const labels = useMemo(() => uvvisLabels(view, quantity), [view, quantity]);
  return (
    <PlotPanel
      sources={sources}
      settings={settings}
      onSettingsChange={onSettingsChange}
      labels={labels}
      xName={view.xUnit === 'nm' ? 'λ' : 'E'}
      xUnit={view.xUnit === 'nm' ? ' nm' : ' eV'}
      exportName={exportName}
    />
  );
}
