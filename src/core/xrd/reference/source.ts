import type { ReferencePhase } from './types.ts';

/**
 * Where a reference phase comes from, for tables, figure keys and the methods text:
 * "COD 9013437" for the built-in library, "CIF file name.cif (COD 9013437)" for a loaded file
 * that names its database entry, "CIF file name.cif" for one that does not.
 */
export function phaseReference(phase: Pick<ReferencePhase, 'codId' | 'origin'>): string {
  const origin = phase.origin;
  if (origin?.kind === 'cif')
    return `CIF file ${origin.fileName}${origin.database ? ` (${origin.database})` : ''}`;
  return phase.codId === null ? 'no database entry' : `COD ${phase.codId}`;
}
