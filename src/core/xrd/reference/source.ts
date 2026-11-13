import type { ReferencePhase } from './types.ts';

/** How phaseReference names a cell from indexing (it starts the reference). */
export const INDEXED_REFERENCE = 'cell from indexing';

/**
 * Where a reference phase comes from, for tables, figure keys and the methods text:
 * "COD 9013437" for a COD entry, "Langan et al., Biomacromolecules 2 (2001) 410" for a polymer
 * library phase transcribed from a paper, "CIF file name.cif (COD 9013437)" for a loaded file
 * that names its database entry, "CIF file name.cif" for one that does not, "cell from indexing
 * (cubic F, M20 = 50.0)" for a cell suggested by indexing. An entry the site downloaded from COD
 * itself (stored as "COD 9013437.cif") is simply "COD 9013437".
 */
export function phaseReference(
  phase: Pick<ReferencePhase, 'codId' | 'origin' | 'citation'>,
): string {
  const origin = phase.origin;
  if (origin?.kind === 'cif' && origin.fileName === `COD ${phase.codId}.cif`)
    return `COD ${phase.codId}`;
  if (origin?.kind === 'cif')
    return `CIF file ${origin.fileName}${origin.database ? ` (${origin.database})` : ''}`;
  if (origin?.kind === 'indexed')
    return `${INDEXED_REFERENCE} (${origin.system} ${origin.centring}, M${origin.n} = ${origin.m20.toFixed(1)})`;
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
