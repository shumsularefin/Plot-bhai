/** How sure we are about what the intensity numbers mean. */
export type IntensityUnit = 'counts' | 'cps';

export type MessageLevel = 'error' | 'warning' | 'info';

/** A plain-language message about imported data, shown next to the data it concerns. */
export interface DataMessage {
  level: MessageLevel;
  text: string;
}

/** Format a file was read as. */
export type SourceFormat = 'xy' | 'xye' | 'csv' | 'text' | 'xrdml' | 'ras' | 'pasted' | 'synthetic';

/** One scan as read from a file, before validation. Angles are 2θ in degrees. */
export interface RawScan {
  twoTheta: number[];
  intensity: number[];
  /** Standard uncertainty of each intensity, same units as intensity (from .xye files). */
  sigma?: number[];
  /** Unit stated by the file itself, if it states one. */
  unitFromFile?: IntensityUnit;
  /** Counting time per point in seconds, if the file states it. */
  countingTimeS?: number;
  /** K-alpha1 wavelength in ångström as written in the file, if present. Not verified. */
  wavelengthFromFileA?: number;
  /** Notes made while reading, for example skipped lines. */
  notes: DataMessage[];
}

export type ParseResult = { ok: true; scan: RawScan } | { ok: false; error: string };

/** A validated pattern: 2θ in degrees, strictly increasing. */
export interface Pattern {
  id: string;
  name: string;
  source: SourceFormat;
  twoTheta: Float64Array;
  intensity: Float64Array;
  sigma?: Float64Array;
  intensityUnit: IntensityUnit;
  /** Whether intensityUnit came from the file, a guess, the user's choice, or the example generator. */
  unitOrigin: 'file' | 'guess' | 'user' | 'generated';
  countingTimeS?: number;
  wavelengthFromFileA?: number;
  /** True for generated example data. Never a real measurement. */
  synthetic: boolean;
  /** Messages from reading and checking the file. */
  notes: DataMessage[];
}

/** Result of importing one file or one paste. Errors mean no pattern was created. */
export type ImportResult =
  { ok: true; pattern: Omit<Pattern, 'id'> } | { ok: false; error: string };
