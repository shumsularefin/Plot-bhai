import { DEFAULT_EXPORT_SETTINGS } from '../../../ui/plot/export';
import type { PlotSettings } from '../../../ui/plot/PlotPanel';
import type { LoadedTable } from '../data';

export type DscMethod = 'cp' | 'purity' | 'oit';

export const METHOD_LABELS: Record<DscMethod, string> = {
  cp: 'Heat capacity (sapphire method)',
  purity: 'Purity (van ’t Hoff)',
  oit: 'Oxidation induction time (OIT)',
};

/** The files each method needs, in the order they are asked for. */
export type FileRole = 'blank' | 'sapphire' | 'sample';
export const ROLES: Record<DscMethod, FileRole[]> = {
  cp: ['blank', 'sapphire', 'sample'],
  purity: ['sample'],
  oit: ['sample'],
};
export const ROLE_LABELS: Record<FileRole, string> = {
  blank: 'Empty pan (blank) run',
  sapphire: 'Sapphire run',
  sample: 'Sample run',
};

/** Everything saved for a DSC methods analysis. */
export interface DscMethodsData {
  method: DscMethod;
  files: Partial<Record<FileRole, LoadedTable>>;
  /** True when exothermic heat flow points up in the files. */
  exoUp: boolean;
  /** Masses in mg. */
  sapphireMassMg: number | null;
  sampleMassMg: number | null;
  /** Heat flow unit of the files; W/g is already divided by the sample mass. */
  heatFlowUnit: 'mW' | 'W/g';
  /** Heating rate, K/min (purity). */
  rateKPerMin: number | null;
  cp: { fromC: number | null; toC: number | null; stepC: number };
  purity: {
    molarMass: number | null;
    fromC: number | null;
    toC: number | null;
    fMin: number;
    fMax: number;
  };
  oit: { switchMin: number | null; baselineFromMin: number | null; baselineToMin: number | null };
  plot: PlotSettings;
}

/**
 * Defaults of my own choosing, adjustable on screen. The 10 to 50 % melted range for the purity fit
 * follows common practice for the van 't Hoff plot (TODO, verify against ASTM E928).
 */
export const initialDscMethodsData: DscMethodsData = {
  method: 'cp',
  files: {},
  exoUp: false,
  sapphireMassMg: null,
  sampleMassMg: null,
  heatFlowUnit: 'mW',
  rateKPerMin: null,
  cp: { fromC: null, toC: null, stepC: 5 },
  purity: { molarMass: null, fromC: null, toC: null, fMin: 0.1, fMax: 0.5 },
  oit: { switchMin: null, baselineFromMin: null, baselineToMin: null },
  plot: { normalise: false, offsetPercent: 0, export: DEFAULT_EXPORT_SETTINGS },
};

export const DSC_METHODS_STATE_VERSION = 1;
