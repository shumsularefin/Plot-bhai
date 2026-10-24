import { DEFAULT_CALCINATION, type CalcinationSettings } from '../../core/thermal/calcination';
import { DEFAULT_CLEAN, type CleanSettings } from '../../core/thermal/process';
import { DEFAULT_DETECT, type DetectOptions, type StepLimit } from '../../core/thermal/steps';
import type { ColumnMapping, RunInfo, ThermalTable } from '../../core/thermal/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import type { PlotSettings } from '../../ui/plot/PlotPanel';
import type { WizardState } from '../../ui/wizard/types';

/** A loaded table with the user's column choices. */
export interface LoadedTable {
  name: string;
  table: ThermalTable;
  mapping: ColumnMapping;
  /** True for the generated example run. */
  synthetic: boolean;
}

/** How the mass loss steps are found and shown. */
export interface StepSettings {
  /** Width of the window for the DTG slope, °C. */
  dtgWindowC: number;
  detect: DetectOptions;
  /** DTG in %/°C or, with a heating rate, in %/min. */
  dtgUnit: 'per-degree' | 'per-minute';
  /** Step limits edited by hand. Null means the automatic detection is used. */
  limits: StepLimit[] | null;
  /** Temperature for "residue at …" in °C. */
  residueAtC: number | null;
}

export const DEFAULT_STEP_SETTINGS: StepSettings = {
  dtgWindowC: 20,
  detect: DEFAULT_DETECT,
  dtgUnit: 'per-degree',
  limits: null,
  residueAtC: 600,
};

export const DEFAULT_RUN_INFO: RunInfo = {
  atmosphere: 'nitrogen',
  atmosphereOther: '',
  heatingRate: null,
  initialMassMg: null,
  sample: '',
  category: 'unspecified',
};

/** What the user decided about the event behind one step. Not yet decided steps have no entry. */
export type EventDecision =
  { kind: 'rule'; ruleId: string } | { kind: 'custom'; text: string } | { kind: 'rejected' };

/** Steps are keyed by their DTG peak temperature in whole °C, which stays put while limits move. */
export const stepKey = (peakC: number): string => String(Math.round(peakC));

/** The reaction typed in for the theoretical mass loss check, and the step to compare with. */
export interface TheorySettings {
  precursor: string;
  product: string;
  /** Moles of solid product per mole of precursor. */
  coefficient: number;
  /** Key (see stepKey) of the step to compare with; empty until chosen. */
  stepKey: string;
}

export const DEFAULT_THEORY: TheorySettings = {
  precursor: '',
  product: '',
  coefficient: 1,
  stepKey: '',
};

/** Everything saved for a thermal analysis. */
export interface ThermalData {
  file: LoadedTable | null;
  /** Optional blank (empty crucible) run for buoyancy correction. */
  blank: LoadedTable | null;
  info: RunInfo;
  clean: CleanSettings;
  steps: StepSettings;
  /** Decisions about the events behind the steps, by step key. */
  events: Record<string, EventDecision>;
  theory: TheorySettings;
  calcination: CalcinationSettings;
  plot: PlotSettings;
}

export const initialThermalData: ThermalData = {
  file: null,
  blank: null,
  info: DEFAULT_RUN_INFO,
  clean: DEFAULT_CLEAN,
  steps: DEFAULT_STEP_SETTINGS,
  events: {},
  theory: DEFAULT_THEORY,
  calcination: DEFAULT_CALCINATION,
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

/** Version of the saved shape. Bump it, and extend migrateThermalData, when the shape changes. */
export const THERMAL_STATE_VERSION = 2;

/** Version 1 (sub-stage 11a) had no event decisions, theory check or calcination settings. */
export function migrateThermalData(
  saved: unknown,
  version: number,
): WizardState<ThermalData> | undefined {
  if (version !== 1) return undefined;
  const state = saved as WizardState<Partial<ThermalData>>;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  return { ...state, data: { ...initialThermalData, ...state.data } };
}
