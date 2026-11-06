import { decodeText, hasNulBytes, isZip } from '../text/bytes';
import { listZip, readZipFiles, ZipError } from '../text/unzip';
import { brmlWanted, looksLikeBrml, parseBrml } from './parsers/brml';
import { looksLikeBrukerRaw, parseBrukerRaw } from './parsers/brukerRaw';
import { parseDelimited } from './parsers/delimited';
import { looksLikeRas, parseRas } from './parsers/ras';
import { looksLikeRasx, parseRasx, rasxWanted } from './parsers/rasx';
import { looksLikeXrdml, parseXrdml } from './parsers/xrdml';
import type { ImportResult, ParseResult, SourceFormat } from './types';
import { validateScan } from './validate';

/** Larger files are refused before reading; real XRD scans are far smaller. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const EXPORT_HINT =
  'In the instrument software, export the scan as .xy or .csv (two columns: 2θ and intensity), then load that file.';

/** Binary formats we recognise but cannot read. We say so rather than guess. */
const BINARY_FORMATS: Record<string, string> = {
  raw: 'This .raw file is not a Bruker version 4 file. The .raw extension is also used by other instruments for binary files that this site cannot read.',
  rd: 'Philips .rd files are a binary format that this site cannot read.',
  sd: 'Philips .sd files are a binary format that this site cannot read.',
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim() || 'Pattern';
}

/**
 * Imports a file's bytes, including the packed formats (Bruker .brml and Rigaku .rasx, which
 * are ZIP archives and are unpacked asynchronously). `name` is the file name.
 */
export async function importFileAsync(name: string, bytes: Uint8Array): Promise<ImportResult> {
  if (!isZip(bytes) || bytes.length > MAX_FILE_BYTES) return importFile(name, bytes);
  try {
    const names = listZip(bytes).map((e) => e.name);
    if (looksLikeRasx(names)) {
      return toResult(name, 'rasx', parseRasx(await readZipFiles(bytes, rasxWanted)));
    }
    if (looksLikeBrml(names)) {
      return toResult(name, 'brml', parseBrml(await readZipFiles(bytes, brmlWanted)));
    }
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, error: error.message };
    throw error;
  }
  return {
    ok: false,
    error: `This is a packed (ZIP) file, but not a Bruker .brml or Rigaku .rasx scan. ${EXPORT_HINT}`,
  };
}

/**
 * Imports a file's bytes. `name` is the file name, used for the format and the pattern name.
 * Packed formats need importFileAsync; here they get a message saying so.
 */
export function importFile(name: string, bytes: Uint8Array): ImportResult {
  const extension = extensionOf(name);
  if (bytes.length === 0) return { ok: false, error: 'This file is empty.' };
  if (bytes.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: 'This file is larger than 50 MB, which is far bigger than an XRD scan.',
    };
  }

  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!isZip(bytes) && looksLikeBrukerRaw(bytes)) {
    return toResult(name, 'raw', parseBrukerRaw(bytes));
  }
  if (isZip(bytes)) {
    return {
      ok: false,
      error: `This is a packed (ZIP) file, which must be read with the file picker. ${EXPORT_HINT}`,
    };
  }
  if (!utf16 && hasNulBytes(bytes)) {
    const known = BINARY_FORMATS[extension];
    const what = known ?? 'This is a binary file, not a text file, so this site cannot read it.';
    return { ok: false, error: `${what} ${EXPORT_HINT}` };
  }

  // Rigaku headers are often not UTF-8; Latin-1 never fails and keeps the numbers intact.
  const text = decodeText(bytes, extension === 'ras' ? 'latin1' : 'utf-8');
  return importText(name, text, formatFromExtension(extension));
}

function formatFromExtension(extension: string): SourceFormat {
  switch (extension) {
    case 'xy':
    case 'xye':
    case 'csv':
    case 'xrdml':
    case 'ras':
      return extension;
    default:
      return 'text';
  }
}

/**
 * Imports text, detecting XRDML and RAS content regardless of the name. `format` is the
 * format suggested by the file extension, or 'pasted' for pasted text.
 */
export function importText(
  name: string,
  text: string,
  format: SourceFormat = 'pasted',
): ImportResult {
  if (text.trim() === '') return { ok: false, error: 'There is no data to read.' };

  let source: SourceFormat = format;
  let parsed: ParseResult;
  if (looksLikeXrdml(text)) {
    source = 'xrdml';
    parsed = parseXrdml(text);
  } else if (looksLikeRas(text)) {
    source = 'ras';
    parsed = parseRas(text);
  } else if (format === 'xrdml' || format === 'ras') {
    return {
      ok: false,
      error: `This file has the .${format} extension but does not contain ${format === 'xrdml' ? 'XRDML' : 'Rigaku RAS'} data. It may be damaged or a different format.`,
    };
  } else {
    parsed = parseDelimited(text, { thirdColumnIsSigma: format === 'xye' });
  }
  return toResult(name, source, parsed);
}

/** Validates a parsed scan and turns it into an imported pattern. */
function toResult(name: string, source: SourceFormat, parsed: ParseResult): ImportResult {
  if (!parsed.ok) return parsed;
  const validated = validateScan(parsed.scan);
  if (!validated.ok) return validated;
  const { scan } = validated;
  return {
    ok: true,
    pattern: {
      name: baseName(name),
      source,
      twoTheta: scan.twoTheta,
      intensity: scan.intensity,
      ...(scan.sigma && { sigma: scan.sigma }),
      intensityUnit: scan.intensityUnit,
      unitOrigin: scan.unitOrigin,
      ...(parsed.scan.countingTimeS !== undefined && { countingTimeS: parsed.scan.countingTimeS }),
      ...(parsed.scan.wavelengthFromFileA !== undefined && {
        wavelengthFromFileA: parsed.scan.wavelengthFromFileA,
      }),
      ...(parsed.scan.metadata && { metadata: parsed.scan.metadata }),
      synthetic: false,
      notes: scan.notes,
    },
  };
}
