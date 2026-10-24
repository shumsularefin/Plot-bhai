import { DISPLAY_LABELS, type DisplayQuantity } from '../../core/uvvis/process';
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
