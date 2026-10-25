import { useMemo } from 'preact/hooks';
import { toPercentTransmittance, type FtirProcessed } from '../../core/ftir/process';
import { PlotPanel, type PlotSettings } from '../../ui/plot/PlotPanel';
import type { FtirPeak } from '../../core/ftir/peaks';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { SeriesSource } from '../../ui/plot/series';
import type { AxisLabels, Domain } from '../../ui/plot/types';
import { valueIn, type FtirQuantity } from './quantity';

/** One curve to draw: absorbance on increasing wavenumber. */
export interface FtirCurve {
  id: string;
  name: string;
  wavenumber: Float64Array;
  absorbance: Float64Array;
  colorIndex?: number;
  dashed?: boolean;
}

export const curveOf = (
  id: string,
  name: string,
  processed: Pick<FtirProcessed, 'wavenumber' | 'absorbance'>,
  extra: Pick<FtirCurve, 'colorIndex' | 'dashed'> = {},
): FtirCurve => ({
  id,
  name,
  wavenumber: processed.wavenumber,
  absorbance: processed.absorbance,
  ...extra,
});

/**
 * Plot sources for a reversed wavenumber axis: x is −wavenumber, reversed so it increases (the
 * plot then shows high wavenumber on the left and its labels show the positive value). Points
 * without a value are left out. Transmittance is shown in percent.
 */
export function ftirSources(curves: readonly FtirCurve[], quantity: FtirQuantity): SeriesSource[] {
  return curves.map((curve) => {
    const values =
      quantity === 'transmittance' ? toPercentTransmittance(curve.absorbance) : curve.absorbance;
    const keep: number[] = [];
    for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) keep.push(i);
    return {
      id: curve.id,
      name: curve.name,
      x: Float64Array.from(keep, (i) => -(curve.wavenumber[i] as number)),
      y: Float64Array.from(keep, (i) => values[i] as number),
      unit: quantity === 'transmittance' ? '%' : 'a.u.',
      ...(curve.colorIndex !== undefined && { colorIndex: curve.colorIndex }),
      ...(curve.dashed && { dashed: true }),
    };
  });
}

export const ftirLabels =
  (quantity: FtirQuantity) =>
  (normalised: boolean): AxisLabels => ({
    x: (
      <>
        Wavenumber (cm
        <tspan dy="-0.45em" font-size="70%">
          −1
        </tspan>
        <tspan dy="0.45em">)</tspan>
      </>
    ),
    y:
      quantity === 'transmittance'
        ? normalised
          ? 'Transmittance / maximum'
          : 'Transmittance (%)'
        : normalised
          ? 'Normalised absorbance (a.u.)'
          : 'Absorbance (a.u.)',
    reversed: true,
  });

/**
 * Wavenumber labels for picked peaks, placed at the band in the shown quantity: above an
 * absorbance maximum, below a transmittance minimum.
 */
export function peakLabelsFor(peaks: readonly FtirPeak[], quantity: FtirQuantity): PeakLabelSet {
  return {
    labels: peaks.map((p) => ({
      x: -p.wavenumber,
      y: valueIn(quantity, p.height),
      text: String(Math.round(p.wavenumber)),
    })),
    key: [],
    ...(quantity === 'transmittance' && { below: true }),
  };
}

interface FtirPlotProps {
  curves: readonly FtirCurve[];
  quantity: FtirQuantity;
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
  exportName: string;
  showOverlayOptions?: boolean;
  peakLabels?: PeakLabelSet;
  /** Jump to this wavenumber range (cm⁻¹, either order). */
  focusCm?: readonly [number, number] | null;
}

/** The shared plot panel set up for FTIR spectra, with the wavenumber axis reversed. */
export function FtirPlot(props: FtirPlotProps) {
  const { curves, quantity, settings, onSettingsChange, exportName } = props;
  const sources = useMemo(() => ftirSources(curves, quantity), [curves, quantity]);
  const labels = useMemo(() => ftirLabels(quantity), [quantity]);
  const focus: Domain | null = props.focusCm ? [-props.focusCm[0], -props.focusCm[1]] : null;
  return (
    <PlotPanel
      sources={sources}
      settings={settings}
      onSettingsChange={onSettingsChange}
      labels={labels}
      xName="ν̃"
      xUnit=" cm⁻¹"
      exportName={exportName}
      {...(props.showOverlayOptions !== undefined && {
        showOverlayOptions: props.showOverlayOptions,
      })}
      {...(props.peakLabels && { peakLabels: props.peakLabels })}
      {...(focus && { focusRange: focus })}
    />
  );
}
