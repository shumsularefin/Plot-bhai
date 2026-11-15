import type { PlasmonBand } from '../../core/uvvis/plasmon';
import { uvvisPeaks, type UvvisPeak } from '../../core/uvvis/peaks';
import { toQuantity, type Cleaned } from '../../core/uvvis/process';
import type { Spectrum } from '../../core/uvvis/types';
import type { CsvColumn } from '../../core/xrd/peaks/table';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import { cleanAll } from './analysis';
import { bandFitFor, cleaningFor, peakEditsFor, peaksFor, type UvvisData } from './data';

/** The quantity bands are picked on: absorbance, or F(R) for diffuse reflectance. */
export type BandQuantity = 'absorbance' | 'kubelka-munk';

export const BAND_QUANTITY_TEXT: Record<BandQuantity, string> = {
  absorbance: 'Absorbance',
  'kubelka-munk': 'F(R)',
};

export interface BandSignal {
  /** Wavelength, nm, increasing. */
  x: Float64Array;
  /** A or F(R); NaN where it cannot be calculated. */
  y: Float64Array;
  quantity: BandQuantity;
}

/** The cleaned spectrum as absorbance (transmittance converted) or F(R), on its wavelengths. */
export function bandSignal(
  spectrum: Pick<Spectrum, 'kind' | 'scale'>,
  cleaned: Pick<Cleaned, 'wavelengthNm' | 'values'>,
): BandSignal {
  const quantity: BandQuantity = spectrum.kind === 'reflectance' ? 'kubelka-munk' : 'absorbance';
  const y =
    toQuantity(cleaned.values, spectrum, quantity) ??
    new Float64Array(cleaned.values.length).fill(NaN);
  return { x: cleaned.wavelengthNm, y, quantity };
}

export interface BandRow {
  spectrum: Spectrum;
  quantity: BandQuantity;
  peak: UvvisPeak;
}

/** The band table of every spectrum, in spectrum order and then by wavelength. */
export function bandRows(data: UvvisData): BandRow[] {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  return data.spectra.flatMap((spectrum, i) => {
    const clean = cleaned[i];
    if (!clean) return [];
    const signal = bandSignal(spectrum, clean);
    return uvvisPeaks(
      signal.x,
      signal.y,
      peaksFor(data, spectrum.id),
      peakEditsFor(data, spectrum.id),
    ).map((peak) => ({ spectrum, quantity: signal.quantity, peak }));
  });
}

export const ORIGIN_TEXT: Record<UvvisPeak['origin'], string> = {
  picked: 'picked',
  hand: 'added by hand',
  shoulder: 'shoulder (accepted suggestion)',
};

const finite = (v: number) => (Number.isFinite(v) ? v : '');

/** Columns of the band table CSV. */
export const BAND_COLUMNS: readonly CsvColumn<BandRow>[] = [
  { header: 'Sample', value: (r) => r.spectrum.name },
  { header: 'Wavelength (nm)', value: (r) => finite(r.peak.wavelengthNm) },
  { header: 'Energy (eV)', value: (r) => finite(r.peak.energyEv) },
  { header: 'Quantity', value: (r) => BAND_QUANTITY_TEXT[r.quantity] },
  { header: 'Value', value: (r) => finite(r.peak.value) },
  { header: 'Prominence', value: (r) => finite(r.peak.prominence) },
  { header: 'Relative value (%)', value: (r) => finite(r.peak.relative) },
  { header: 'Origin', value: (r) => ORIGIN_TEXT[r.peak.origin] },
];

export const BAND_NOTE =
  'UV-Vis absorption bands: local maxima of the cleaned absorbance (F(R) for diffuse reflectance), positions from a parabola through the highest point and its two neighbours, E = hc/lambda. Prominence is the height above the higher of the two surrounding valleys (0 for a shoulder). Shoulders are second-derivative minima accepted by the user. lambda_max in the results table is defined separately, as the highest data point.';

/** Labels "512 nm" at each band, attached to the curve of its spectrum. */
export function bandLabels(
  rows: readonly BandRow[],
  seriesIdOf: (id: string) => string,
): PeakLabelSet {
  return {
    labels: rows.map((r) => ({
      x: r.peak.wavelengthNm,
      y: r.peak.value,
      text: `${Math.round(r.peak.wavelengthNm)}${r.peak.origin === 'shoulder' ? ' (sh)' : ''}`,
      seriesId: seriesIdOf(r.spectrum.id),
    })),
    key: rows.some((r) => r.peak.origin === 'shoulder') ? ['sh: shoulder'] : [],
  };
}

/**
 * Key of the data and settings a band fit was made with, to tell when it is out of date: the
 * spectrum, its cleaning (and that of its blank), and the fit settings.
 */
export function bandFitKey(data: UvvisData, id: string): string {
  const cleaning = cleaningFor(data, id);
  const fit = bandFitFor(data, id);
  const blank = cleaning.blank.blankId;
  return JSON.stringify([
    id,
    cleaning,
    blank ? cleaningFor(data, blank) : null,
    fit.fromNm,
    fit.toNm,
    fit.centresNm,
    fit.profile,
  ]);
}

/** Columns of the band fit CSV (as in the film tool). */
export const BAND_FIT_COLUMNS: readonly CsvColumn<PlasmonBand>[] = [
  { header: 'Centre (eV)', value: (b) => b.centerEv },
  { header: 'Centre SE (eV)', value: (b) => b.centerEvSigma },
  { header: 'Centre (nm)', value: (b) => b.centerNm },
  { header: 'FWHM (eV)', value: (b) => b.fwhmEv },
  { header: 'FWHM SE (eV)', value: (b) => b.fwhmEvSigma },
  { header: 'FWHM (nm)', value: (b) => b.fwhmNm },
  { header: 'Height', value: (b) => b.height },
  { header: 'Lorentzian fraction eta', value: (b) => b.eta },
  { header: 'Area (value x eV)', value: (b) => b.area },
];
