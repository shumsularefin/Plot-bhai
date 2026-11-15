import { looksLikeBrukerOpus, parseBrukerOpus } from './brukerOpus';
import { looksLikeGalacticSpc, parseGalacticSpc } from './galacticSpc';
import { looksLikeOmnicSpa, parseOmnicSpa } from './omnicSpa';
import { looksLikePerkinElmerSp, parsePerkinElmerSp } from './perkinElmerSp';
import type { InstrumentResult } from './types';

export type { InstrumentFile, InstrumentResult, InstrumentXUnit, InstrumentYKind } from './types';

/** An OLE2 compound document (the container of, for example, an old Excel .xls file). */
const isOle = (bytes: Uint8Array) =>
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);

/**
 * Reads a binary spectrum file by its content, not its name: OMNIC .spa, Bruker OPUS,
 * PerkinElmer .sp or Galactic .spc. Undefined when the bytes are none of these. `extension` is
 * only used to tell a Galactic .spc apart from other files whose second byte matches.
 */
export function readInstrumentFile(
  bytes: Uint8Array,
  extension: string,
): InstrumentResult | undefined {
  if (looksLikeOmnicSpa(bytes)) return parseOmnicSpa(bytes);
  if (looksLikeBrukerOpus(bytes)) return parseBrukerOpus(bytes);
  if (looksLikePerkinElmerSp(bytes)) return parsePerkinElmerSp(bytes);
  if (isOle(bytes) && extension === 'spc') {
    return {
      ok: false,
      error:
        'This .spc file is not a Galactic .spc file but a different binary format (a compound document), which this site cannot read. In the instrument software, export the spectrum as text (.txt or .csv), then load that file.',
    };
  }
  if (extension === 'spc' && looksLikeGalacticSpc(bytes)) return parseGalacticSpc(bytes);
  return undefined;
}
