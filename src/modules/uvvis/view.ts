import { availableQuantities, toQuantity, type DisplayQuantity } from '../../core/uvvis/process';
import type { Spectrum } from '../../core/uvvis/types';
import type { ViewSettings } from './data';
import { measuredQuantity } from './labels';
import type { Curve } from './UvvisPlot';

/** The quantity a spectrum is drawn as under the chosen view; null when it cannot be shown that way. */
export function quantityFor(
  spectrum: Pick<Spectrum, 'kind'>,
  view: ViewSettings,
): DisplayQuantity | null {
  if (view.quantity === 'measured') return availableQuantities(spectrum.kind)[0] ?? null;
  return availableQuantities(spectrum.kind).includes(view.quantity) ? view.quantity : null;
}

export interface ShownCurves {
  curves: Curve[];
  /** What the y axis shows; null when spectra of different kinds are drawn as measured. */
  quantity: DisplayQuantity | null;
  /** Names of spectra that cannot be shown in the chosen view. */
  excluded: string[];
}

/**
 * Turns (spectrum, values) pairs into plot curves under the chosen view. Transmittance and
 * reflectance are always drawn in percent, whatever scale they were recorded in.
 */
export function shownCurves(
  items: readonly {
    spectrum: Spectrum;
    id: string;
    name: string;
    wavelengthNm: Float64Array;
    values: Float64Array;
    colorIndex?: number;
    dashed?: boolean;
  }[],
  view: ViewSettings,
): ShownCurves {
  const curves: Curve[] = [];
  const excluded: string[] = [];
  const kinds: Spectrum['kind'][] = [];
  for (const item of items) {
    const quantity = quantityFor(item.spectrum, view);
    const values = quantity ? toQuantity(item.values, item.spectrum, quantity) : null;
    if (!values) {
      excluded.push(item.spectrum.name);
      continue;
    }
    kinds.push(item.spectrum.kind);
    curves.push({
      id: item.id,
      name: item.name,
      wavelengthNm: item.wavelengthNm,
      values,
      ...(item.colorIndex !== undefined && { colorIndex: item.colorIndex }),
      ...(item.dashed && { dashed: true }),
    });
  }
  return {
    curves,
    quantity: view.quantity === 'measured' ? measuredQuantity(kinds) : view.quantity,
    excluded,
  };
}
