import type { ReferencePhase } from './types.ts';

/**
 * Where a reference phase comes from, for tables, figure keys and the methods text:
 * "COD 9013437" for a COD entry, "Langan et al., Biomacromolecules 2 (2001) 410" for a polymer
 * library phase transcribed from a paper, "CIF file name.cif (COD 9013437)" for a loaded file
 * that names its database entry, "CIF file name.cif" for one that does not.
 */
export function phaseReference(
  phase: Pick<ReferencePhase, 'codId' | 'origin' | 'citation'>,
): string {
  const origin = phase.origin;
  if (origin?.kind === 'cif')
    return `CIF file ${origin.fileName}${origin.database ? ` (${origin.database})` : ''}`;
  if (phase.codId !== null) return `COD ${phase.codId}`;
  const c = phase.citation;
  if (!c?.journal) return 'no database entry';
  const who = c.authors ? `${c.authors}, ` : '';
  return `${who}${c.journal} ${c.volume} (${c.year}) ${c.page}`;
}

/** Web page of a phase's source: its COD entry, else the paper's DOI, else null. */
export function phaseLink(phase: Pick<ReferencePhase, 'codId' | 'citation'>): string | null {
  if (phase.codId !== null) return `https://www.crystallography.net/cod/${phase.codId}.html`;
  return phase.citation?.doi ? `https://doi.org/${phase.citation.doi}` : null;
}
