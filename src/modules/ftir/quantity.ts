import { percentTFromAbsorbance } from '../../core/uvvis/conversions';
import type { FtirSpectrum } from '../../core/ftir/types';
import { processingFor, type FtirData, type FtirView } from './data';

export type FtirQuantity = FtirView['quantity'];

/**
 * The display quantity that matches freshly loaded spectra: transmittance when every one was
 * measured as transmittance, absorbance otherwise. Only the display follows this; processing
 * and peak picking always work on absorbance.
 */
export function defaultQuantity(spectra: readonly Pick<FtirSpectrum, 'kind'>[]): FtirQuantity {
  return spectra.length > 0 && spectra.every((s) => s.kind === 'transmittance')
    ? 'transmittance'
    : 'absorbance';
}

/** What the plots show, and the plain-language reason when it is not what was chosen. */
export interface ShownQuantity {
  quantity: FtirQuantity;
  reason: string | null;
}

/**
 * The quantity drawn for these spectra. A normalised absorbance has no transmittance
 * equivalent (10^−A of a rescaled A is not a transmittance), so while any listed spectrum is
 * normalised the plots stay in absorbance and say why.
 */
export function shownQuantity(
  data: Pick<FtirData, 'view' | 'processing'>,
  spectra: readonly Pick<FtirSpectrum, 'id' | 'name'>[],
): ShownQuantity {
  if (data.view.quantity === 'absorbance') return { quantity: 'absorbance', reason: null };
  const normalised = spectra.filter((s) => processingFor(data, s.id).normalise.enabled);
  if (normalised.length === 0) return { quantity: 'transmittance', reason: null };
  return {
    quantity: 'absorbance',
    reason: `Shown as absorbance because ${normalised.map((s) => s.name).join(', ')} ${normalised.length === 1 ? 'is' : 'are'} normalised, and a normalised absorbance cannot be turned back into transmittance. Switch normalisation off in step 2 to see transmittance.`,
  };
}

/** A processed absorbance value in the shown quantity: A itself, or %T = 100 · 10^(−A). */
export function valueIn(quantity: FtirQuantity, absorbance: number): number {
  return quantity === 'transmittance' ? percentTFromAbsorbance(absorbance) : absorbance;
}

/** Column heading for values in the shown quantity. */
export const quantityHeading = (quantity: FtirQuantity): string =>
  quantity === 'transmittance' ? 'Transmittance (%)' : 'Absorbance';
