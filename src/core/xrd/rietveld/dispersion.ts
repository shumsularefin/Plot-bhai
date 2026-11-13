/*
 * Anomalous-dispersion table (data/reference/anomalous-dispersion.json): Cromer–Liberman f′ and f″
 * (electrons) of each element at the Kα1 wavelength of each anode, computed by GSAS-II's FPcalc in
 * the Validation workflow (scripts/validation/gsas2/dispersion.py). GSAS-II has no orbital cross
 * sections for the elements listed as `missing` (H and He) and uses f′ = f″ = 0 for them, as here.
 */

import type { Dispersion } from './structure';

export interface DispersionFile {
  source: string;
  missing: string[];
  anodes: Record<string, { wavelength: number; keV: number; values: Dispersion }>;
}

/** f′, f″ of every element for one anode, or undefined when the table has no such anode. */
export function dispersionFor(file: DispersionFile, anode: string): Dispersion | undefined {
  const entry = file.anodes[anode];
  if (!entry) return undefined;
  const zeros = Object.fromEntries(file.missing.map((el) => [el, [0, 0] as const]));
  return { ...zeros, ...entry.values };
}
