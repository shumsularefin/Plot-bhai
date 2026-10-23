import { parseDelimited } from './parsers/delimited';
import { looksLikeRas, parseRas } from './parsers/ras';
import { looksLikeXrdml, parseXrdml } from './parsers/xrdml';
import type { ImportResult, ParseResult, SourceFormat } from './types';
import { validateScan } from './validate';

/** Larger files are refused before reading; real XRD scans are far smaller. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const EXPORT_HINT =
  'In the instrument software, export the scan as .xy or .csv (two columns: 2θ and intensity), then load that file.';

/** Binary formats we recognise but cannot read. We say so rather than guess. */
const BINARY_FORMATS: Record<string, string> = {
  raw: 'The .raw extension is used for binary files (by Bruker, Rigaku and other instruments) that this site cannot read.',
  brml: 'Bruker .brml files are a packed format that this site cannot read.',
  rasx: 'Rigaku .rasx files are a packed format that this site cannot read. A plain .ras file also works here.',
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

/** Decodes file bytes to text, honouring a UTF-16 or UTF-8 byte-order mark. */
function decode(bytes: Uint8Array, fallback: 'utf-8' | 'latin1'): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  return new TextDecoder(fallback).decode(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function hasNulBytes(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 4096);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/** Imports a file's bytes. `name` is the file name, used for the format and the pattern name. */
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
  if (isZip(bytes) || (!utf16 && hasNulBytes(bytes))) {
    const known = BINARY_FORMATS[extension];
    const what = known ?? 'This is a binary file, not a text file, so this site cannot read it.';
    return { ok: false, error: `${what} ${EXPORT_HINT}` };
  }

  // Rigaku headers are often not UTF-8; Latin-1 never fails and keeps the numbers intact.
  const text = decode(bytes, extension === 'ras' ? 'latin1' : 'utf-8');
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
      synthetic: false,
      notes: scan.notes,
    },
  };
}
