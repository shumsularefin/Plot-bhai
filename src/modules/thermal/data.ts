import { DEFAULT_CALCINATION, type CalcinationOptions } from '../../core/thermal/calcination';
import { REACTION_EXAMPLES, type Reaction } from '../../core/thermal/formula';
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
  /** True for a curve digitized from a figure image. */
  digitized?: boolean;
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

/** What the user decided about one step: accepted a suggestion, wrote their own, or rejected it. */
export interface EventAssignment {
  status: 'accepted' | 'changed' | 'rejected';
  /** Id of the rule in data/thermal/events.json when a suggestion was accepted. */
  ruleId: string | null;
  /** The event as shown in the results (the suggestion's name, or the user's own words). */
  label: string;
}

/** The theoretical mass loss check. */
export interface TheorySettings {
  /** Id of a ready example, or 'custom'. */
  exampleId: string;
  reaction: Reaction;
  /** The step to compare with, or null for none. */
  stepId: number | null;
  /** The measured and theoretical losses agree when they differ by at most this many % points. */
  agreeWithinPct: number;
}

export const DEFAULT_THEORY: TheorySettings = {
  exampleId: (REACTION_EXAMPLES[0] as (typeof REACTION_EXAMPLES)[number]).id,
  reaction: (REACTION_EXAMPLES[0] as (typeof REACTION_EXAMPLES)[number]).reaction,
  stepId: null,
  agreeWithinPct: 1,
};

/** Everything saved for a thermal analysis. */
export interface ThermalData {
  file: LoadedTable | null;
  /** Optional blank (empty crucible) run for buoyancy correction. */
  blank: LoadedTable | null;
  info: RunInfo;
  clean: CleanSettings;
  steps: StepSettings;
  /** Per step id. */
  assignments: Record<number, EventAssignment>;
  theory: TheorySettings;
  calcination: CalcinationOptions;
  plot: PlotSettings;
  /** Other samples' runs, compared with this one in the results (cleaned the same way, no blank). */
  compare: LoadedTable[];
}

export const initialThermalData: ThermalData = {
  file: null,
  blank: null,
  info: DEFAULT_RUN_INFO,
  clean: DEFAULT_CLEAN,
  steps: DEFAULT_STEP_SETTINGS,
  assignments: {},
  theory: DEFAULT_THEORY,
  calcination: DEFAULT_CALCINATION,
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
  compare: [],
};

/** Version of the saved shape. Bump it, and extend migrateThermalData, when the shape changes. */
export const THERMAL_STATE_VERSION = 3;

/**
 * Version 1 had no event assignments, theory check or calcination settings, and versions 1 and 2
 * no compared runs; missing settings start at their defaults.
 */
export function migrateThermalData(
  saved: unknown,
  version: number,
): WizardState<ThermalData> | undefined {
  if (version !== 1 && version !== 2) return undefined;
  const state = saved as WizardState<Partial<ThermalData>> | null;
  if (!state || typeof state !== 'object' || !state.data) return undefined;
  return { ...state, data: { ...initialThermalData, ...state.data } };
}
