import type { DataMessage } from '../xrd/types';

/** Numbers read from a text file, before the user says which column is which. */
export interface ThermalTable {
  /** Column names found in the header, or "Column 1", "Column 2", … when there are none. */
  names: string[];
  /** One array per column, all the same length. */
  columns: Float64Array[];
  /** Everything above the first row of numbers, kept to help guess the units. */
  headerText: string;
  notes: DataMessage[];
}

export type TemperatureUnit = 'C' | 'K';
export type MassUnit = 'mg' | 'percent';
export type TimeUnit = 'min' | 's';

/** Which table column holds what (0-based index, null when the file has no such column). */
export interface ColumnMapping {
  temperature: number;
  temperatureUnit: TemperatureUnit;
  mass: number | null;
  massUnit: MassUnit;
  time: number | null;
  timeUnit: TimeUnit;
  heatFlow: number | null;
}

/** A run with the columns converted to one set of units: temperature in °C, time in minutes. */
export interface ThermalRun {
  name: string;
  temperatureC: Float64Array;
  /** Mass as recorded, in the unit given by `massUnit`. Null for a DSC-only file. */
  mass: Float64Array | null;
  massUnit: MassUnit;
  timeMin: Float64Array | null;
  /** Heat flow as recorded (the unit is not known to the site). */
  heatFlow: Float64Array | null;
  notes: DataMessage[];
}

export type Atmosphere = 'nitrogen' | 'argon' | 'air' | 'oxygen' | 'other';
export type SampleCategory =
  'unspecified' | 'hydroxide-or-salt' | 'polymer' | 'biomass' | 'composite' | 'other';

/** What the user tells us about the experiment. Everything is shown again in the results. */
export interface RunInfo {
  atmosphere: Atmosphere;
  /** Name of the gas when `atmosphere` is 'other'. */
  atmosphereOther: string;
  /** Heating rate in K/min (the same number as °C/min), or null when unknown. */
  heatingRate: number | null;
  /** Mass at the start of the run in mg, or null when unknown. */
  initialMassMg: number | null;
  /** Free-text description of the sample. */
  sample: string;
  category: SampleCategory;
}

export type ThermalImportResult = { ok: true; table: ThermalTable } | { ok: false; error: string };

/** The cleaned TGA curve all later steps work on. */
export interface TgaCurve {
  /** Temperature in °C, strictly increasing. */
  temperatureC: Float64Array;
  /** Mass in % of the reference mass (100 % at the start, or at the chosen normalisation temperature). */
  massPct: Float64Array;
  /** Mass in mg (massPct × referenceMg / 100) when the reference mass is known, else null. */
  massMg: Float64Array | null;
  /** Mass in mg that corresponds to 100 %. Null when the initial mass is unknown. */
  referenceMg: number | null;
  notes: DataMessage[];
}
