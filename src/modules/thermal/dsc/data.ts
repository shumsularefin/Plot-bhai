import {
  DEFAULT_DETECT_DSC,
  type BaselineKind,
  type DetectDscOptions,
  type DscEventLimit,
  type GlassWindows,
} from '../../../core/thermal/dsc';
import {
  DEFAULT_DSC_CLEAN,
  DEFAULT_DSC_SETUP,
  type DscCleanSettings,
  type DscSetup,
} from '../../../core/thermal/dscClean';
import type { RunInfo } from '../../../core/thermal/types';
import { DEFAULT_EXPORT_SETTINGS } from '../../../ui/plot/export';
import type { PlotSettings } from '../../../ui/plot/PlotPanel';
import { DEFAULT_RUN_INFO, type EventAssignment, type LoadedTable } from '../data';

/** Which events feed the crystallinity: a number is an event id, 'none' means no cold crystallisation, null picks automatically. */
export interface CrystallinitySettings {
  meltingId: number | null;
  coldId: number | 'none' | null;
  /** Mass fraction w of the polymer in the sample, above 0 and at most 1. */
  weightFraction: number;
  /** ΔH0 in J/g, entered by the user from a source; the site ships none. */
  fullyCrystallineJPerG: number | null;
}

/** Everything saved for a DSC analysis. */
export interface DscData {
  file: LoadedTable | null;
  info: RunInfo;
  setup: DscSetup;
  clean: DscCleanSettings;
  detect: DetectDscOptions;
  /** Baseline given to events when they are detected. */
  baseline: BaselineKind;
  /** Event limits edited by hand. Null means the automatic detection is used. */
  limits: DscEventLimit[] | null;
  /** Molar mass in g/mol for ΔH in kJ/mol, or null. */
  molarMassGPerMol: number | null;
  /** Glass transition windows edited by hand. Null means the automatic windows are used. */
  glassWindows: GlassWindows | null;
  crystallinity: CrystallinitySettings;
  /** Per event id: what the user decided about the guidance. */
  assignments: Record<number, EventAssignment>;
  plot: PlotSettings;
}

export const DEFAULT_CRYSTALLINITY: CrystallinitySettings = {
  meltingId: null,
  coldId: null,
  weightFraction: 1,
  fullyCrystallineJPerG: null,
};

export const initialDscData: DscData = {
  file: null,
  info: DEFAULT_RUN_INFO,
  setup: DEFAULT_DSC_SETUP,
  clean: DEFAULT_DSC_CLEAN,
  detect: DEFAULT_DETECT_DSC,
  baseline: 'linear',
  limits: null,
  molarMassGPerMol: null,
  glassWindows: null,
  crystallinity: DEFAULT_CRYSTALLINITY,
  assignments: {},
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

/** Version of the saved shape. Bump it, and add a migration, when the shape changes. */
export const DSC_STATE_VERSION = 1;
