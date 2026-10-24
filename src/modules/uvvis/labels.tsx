import { DISPLAY_LABELS, type DisplayQuantity } from '../../core/uvvis/process';
import type { SignalUnit, TransitionId } from '../../core/uvvis/tauc';
import type { SpectrumKind } from '../../core/uvvis/types';
import type { AxisLabels } from '../../ui/plot/types';
import type { ViewSettings } from './data';

const MEASURED: Record<SpectrumKind, DisplayQuantity> = {
  absorbance: 'absorbance',
  transmittance: 'transmittance',
  reflectance: 'reflectance',
};

/** The quantity an axis shows when every spectrum is drawn as measured. Null when kinds are mixed. */
export function measuredQuantity(kinds: readonly SpectrumKind[]): DisplayQuantity | null {
  const first = kinds[0];
  return first && kinds.every((k) => k === first) ? MEASURED[first] : null;
}

/** Unit of the plotted values, for the hover readout. */
export function quantityUnit(quantity: DisplayQuantity | null): string {
  return quantity === 'transmittance' || quantity === 'reflectance' ? '%' : 'a.u.';
}

/** Publication-style axis labels for the chosen view. */
export function uvvisLabels(view: ViewSettings, quantity: DisplayQuantity | null) {
  return (normalised: boolean): AxisLabels => {
    const base = quantity ? DISPLAY_LABELS[quantity] : 'Signal (a.u.)';
    const withUnit =
      quantity === 'absorbance' || quantity === 'kubelka-munk' ? `${base} (a.u.)` : base;
    return {
      x: view.xUnit === 'nm' ? 'Wavelength (nm)' : 'Photon energy (eV)',
      y: normalised
        ? `Normalised ${withUnit.charAt(0).toLowerCase()}${withUnit.slice(1)}`
        : withUnit,
    };
  };
}

/** Superscript that survives SVG and PNG export: a smaller, raised span, then back down. */
const Sup = ({ children }: { children: string }) => (
  <>
    <tspan dy="-0.45em" font-size="70%">
      {children}
    </tspan>
    <tspan dy="0.45em"> </tspan>
  </>
);

/** Axis labels of the Tauc plot, for example (αhν)² (eV cm⁻¹)². */
export function taucLabels(transition: TransitionId, unit: SignalUnit): AxisLabels {
  const power = EXPONENT_TEXT[transition];
  const symbol = unit === 'kubelka-munk' ? 'F(R)' : unit === 'alpha' ? 'α' : 'A';
  const units = unit === 'alpha' ? '(eV cm⁻¹)' : unit === 'kubelka-munk' ? '(eV)' : '(eV a.u.)';
  return {
    x: 'Photon energy (eV)',
    y: (
      <>
        (<tspan font-style="italic">{symbol}</tspan>h<tspan font-style="italic">ν</tspan>)
        <Sup>{power}</Sup>
        {units}
        <Sup>{power}</Sup>
      </>
    ),
    yValues: true,
  };
}

/** Axis labels of the Urbach plot: ln of the absorption quantity against photon energy. */
export function urbachLabels(unit: SignalUnit): AxisLabels {
  const symbol = unit === 'kubelka-munk' ? 'F(R)' : unit === 'alpha' ? 'α' : 'A';
  return {
    x: 'Photon energy (eV)',
    y: (
      <>
        ln <tspan font-style="italic">{symbol}</tspan>
      </>
    ),
    yValues: true,
  };
}

const EXPONENT_TEXT: Record<TransitionId, string> = {
  'direct-allowed': '2',
  'indirect-allowed': '1/2',
  'direct-forbidden': '2/3',
  'indirect-forbidden': '1/3',
};
