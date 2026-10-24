import { importSpectraFile, importSpectraText } from '../../core/uvvis/import';
import type { SpectraImportResult } from '../../core/uvvis/types';

/**
 * Reads a file or pasted text. UV-Vis files are small (a few thousand rows), so unlike the
 * XRD reader this runs on the main thread: parsing takes a few milliseconds.
 */
export async function importSpectra(
  request: { kind: 'file'; file: File } | { kind: 'text'; name: string; text: string },
): Promise<SpectraImportResult> {
  try {
    return request.kind === 'file'
      ? importSpectraFile(request.file.name, new Uint8Array(await request.file.arrayBuffer()))
      : importSpectraText(request.name, request.text, 'pasted');
  } catch {
    return { ok: false, error: 'Something went wrong while reading this file.' };
  }
}
