import type { DataMessage } from '../xrd/types';

/** What the y values of a spectrum are. */
export type SpectrumKind = 'absorbance' | 'transmittance' | 'reflectance';

/** How transmittance and reflectance are written: 0 to 100 (percent) or 0 to 1 (fraction). */
export type ValueScale = 'percent' | 'fraction';

export type SpectrumSource = 'text' | 'csv' | 'pasted' | 'synthetic' | 'digitized';

/** A validated spectrum: wavelength in nm, strictly increasing. */
export interface Spectrum {
  id: string;
  name: string;
  source: SpectrumSource;
  wavelengthNm: Float64Array;
  /** y values exactly as read (or generated), in the unit given by kind and scale. */
  values: Float64Array;
  kind: SpectrumKind;
  /** Only meaningful for transmittance and reflectance; absorbance has no scale. */
  scale: ValueScale;
  /** Whether kind came from the file's header text, a guess from the values, the user, or the example generator. */
  kindOrigin: 'header' | 'guess' | 'user' | 'generated';
  /** True for generated example data. Never a real measurement. */
  synthetic: boolean;
  notes: DataMessage[];
}

export type SpectraImportResult =
  { ok: true; spectra: Omit<Spectrum, 'id'>[] } | { ok: false; error: string };
