import type { SpectrumKind as UvvisKind, ValueScale } from '../uvvis/types';
import type { DataMessage } from '../xrd/types';

export type { ValueScale };
/** FTIR spectra are absorbance or transmittance. */
export type FtirKind = Extract<UvvisKind, 'absorbance' | 'transmittance'>;

export type FtirSource = 'text' | 'csv' | 'jcamp' | 'pasted' | 'synthetic';

/** A validated spectrum: wavenumber in cm⁻¹, strictly increasing. */
export interface FtirSpectrum {
  id: string;
  name: string;
  source: FtirSource;
  wavenumber: Float64Array;
  /** y values exactly as read (or generated), in the unit given by kind and scale. */
  values: Float64Array;
  kind: FtirKind;
  /** Only meaningful for transmittance. */
  scale: ValueScale;
  kindOrigin: 'header' | 'guess' | 'user' | 'generated';
  /** True for generated example data. Never a real measurement. */
  synthetic: boolean;
  notes: DataMessage[];
}

export type FtirImportResult =
  { ok: true; spectra: Omit<FtirSpectrum, 'id'>[] } | { ok: false; error: string };
