import { percentTFromAbsorbance } from '../../core/uvvis/conversions';
import type { FtirSpectrum } from '../../core/ftir/types';
import type { ReflectanceTransform } from '../../core/ftir/process';
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
  /**
   * Name of the processed quantity behind the plot and tables: "Absorbance", the Kubelka–Munk
   * function or log₁₀(1/R) for reflectance spectra, or several of them joined with "or".
   */
  name: string;
  /** The same name in plain ASCII, for CSV headings. */
  csvName: string;
}

const NAMES: Record<'absorbance' | ReflectanceTransform, { name: string; csv: string }> = {
  absorbance: { name: 'Absorbance', csv: 'Absorbance' },
  'kubelka-munk': { name: 'Kubelka–Munk F(R)', csv: 'Kubelka-Munk F(R)' },
  'log-inverse': { name: 'log₁₀(1/R)', csv: 'log10(1/R)' },
};

type Listed = Pick<FtirSpectrum, 'id' | 'name' | 'kind'>;

/** The absorbance-like quantity of each listed spectrum, without repeats, in list order. */
function namesOf(data: Pick<FtirData, 'processing'>, spectra: readonly Listed[]) {
  const keys = [
    ...new Set(
      spectra.map((s) =>
        s.kind === 'reflectance' ? processingFor(data, s.id).reflectance : 'absorbance',
      ),
    ),
  ];
  const list = keys.length > 0 ? keys.map((k) => NAMES[k]) : [NAMES.absorbance];
  return {
    name: list.map((n) => n.name).join(' or '),
    csvName: list.map((n) => n.csv).join(' or '),
  };
}

/**
 * The quantity drawn for these spectra. A normalised absorbance has no transmittance
 * equivalent (10^−A of a rescaled A is not a transmittance), and a reflectance spectrum is not a
 * transmittance at all, so while any listed spectrum is either the plots stay in the
 * absorbance-like quantity and say why.
 */
export function shownQuantity(
  data: Pick<FtirData, 'view' | 'processing'>,
  spectra: readonly Listed[],
): ShownQuantity {
  const names = namesOf(data, spectra);
  if (data.view.quantity === 'absorbance')
    return { quantity: 'absorbance', reason: null, ...names };
  const reflectance = spectra.filter((s) => s.kind === 'reflectance');
  if (reflectance.length > 0) {
    return {
      quantity: 'absorbance',
      reason: `Shown as ${names.name} because ${reflectance.map((s) => s.name).join(', ')} ${reflectance.length === 1 ? 'is a reflectance spectrum' : 'are reflectance spectra'}, which have no transmittance.`,
      ...names,
    };
  }
  const normalised = spectra.filter((s) => processingFor(data, s.id).normalise.enabled);
  if (normalised.length === 0) return { quantity: 'transmittance', reason: null, ...names };
  return {
    quantity: 'absorbance',
    reason: `Shown as absorbance because ${normalised.map((s) => s.name).join(', ')} ${normalised.length === 1 ? 'is' : 'are'} normalised, and a normalised absorbance cannot be turned back into transmittance. Switch normalisation off in step 2 to see transmittance.`,
    ...names,
  };
}

/** A processed absorbance value in the shown quantity: A itself, or %T = 100 · 10^(−A). */
export function valueIn(quantity: FtirQuantity, absorbance: number): number {
  return quantity === 'transmittance' ? percentTFromAbsorbance(absorbance) : absorbance;
}

/** Column heading for values in the shown quantity. */
export const quantityHeading = (quantity: FtirQuantity): string =>
  quantity === 'transmittance' ? 'Transmittance (%)' : 'Absorbance';
