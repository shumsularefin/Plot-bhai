import { decodeText, hasNulBytes, isZip } from '../text/bytes';
import { isXlsxZip, LEGACY_XLS_ERROR, xlsxToDelimitedText } from '../text/xlsx';
import { COMMENT, detectLayout, numericRow, splitFields } from '../text/delimitedTable';
import { baseName } from '../xrd/import';
import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import { readInstrumentFile } from '../spectrumFiles';
import type { InstrumentFile } from '../spectrumFiles';
import { looksLikeJcamp, parseJcamp } from './jcamp';
import { ftirKindFromText, suggestFtirKind } from './kind';
import type { FtirImportResult, FtirKind, FtirSource, FtirSpectrum } from './types';

/** FTIR exports are small; larger files are refused before reading. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIN_POINTS = 10;

const EXPORT_HINT =
  'In the instrument software, export the spectrum as .csv, .txt, .dpt or JCAMP-DX (.jdx), then load that file.';

/**
 * Binary formats named by extension. Files that src/core/spectrumFiles reads are read whatever
 * their name; one with these extensions that it does not recognise gets this message.
 */
const BINARY_FORMATS: Record<string, string> = {
  spa: 'This .spa file is not laid out like the OMNIC .spa files this site reads.',
  spc: 'This .spc file is not laid out like the Galactic .spc files this site reads.',
  sp: 'This .sp file is not laid out like the PerkinElmer .sp files this site reads.',
  '0': 'This file is not laid out like the Bruker OPUS files this site reads.',
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Async importer supporting Excel .xlsx workbooks in addition to all sync FTIR formats. */
export async function importFtirFileAsync(
  name: string,
  bytes: Uint8Array,
): Promise<FtirImportResult> {
  const extension = extensionOf(name);
  if (extension === 'xls') return { ok: false, error: LEGACY_XLS_ERROR };
  if (bytes.length > 0 && bytes.length <= MAX_FILE_BYTES && isXlsxZip(bytes)) {
    const sheet = await xlsxToDelimitedText(bytes);
    if (!sheet.ok) return sheet;
    return importFtirText(name, sheet.text, 'csv');
  }
  return importFtirFile(name, bytes);
}

/** Imports a file's bytes. `name` is the file name, used for the format and the spectrum names. */
export function importFtirFile(name: string, bytes: Uint8Array): FtirImportResult {
  if (bytes.length === 0) return { ok: false, error: 'This file is empty.' };
  if (bytes.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: 'This file is larger than 20 MB, far bigger than an FTIR spectrum.',
    };
  }
  const extension = extensionOf(name);
  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const instrument = utf16 ? undefined : readInstrumentFile(bytes, extension);
  if (instrument) {
    return instrument.ok ? importInstrumentFile(name, instrument.file) : instrument;
  }
  if (extension === 'xls') return { ok: false, error: LEGACY_XLS_ERROR };
  if (isZip(bytes) || (!utf16 && hasNulBytes(bytes)) || (extension in BINARY_FORMATS && !utf16)) {
    const what =
      BINARY_FORMATS[extension] ??
      'This is a binary file, not a text file, so this site cannot read it.';
    return { ok: false, error: `${what} ${EXPORT_HINT}` };
  }
  const text = decodeText(bytes, 'latin1');
  return importFtirText(name, text, extension === 'csv' ? 'csv' : 'text');
}

/** A spectrum read from a binary instrument file (src/core/spectrumFiles); x must be in cm⁻¹. */
function importInstrumentFile(name: string, file: InstrumentFile): FtirImportResult {
  if (file.xUnit !== 'wavenumber') {
    return {
      ok: false,
      error:
        file.xUnit === 'nm'
          ? `This ${file.format} file holds a spectrum against wavelength in nm, as UV-Vis instruments record it. Open it in the UV-Vis tool instead.`
          : file.xUnit === 'raman-shift'
            ? `This ${file.format} file holds a Raman spectrum (Raman shift), not an infrared spectrum, so this tool cannot use it.`
            : `The x axis of this ${file.format} file is ${file.xLabel}, not wavenumber in cm⁻¹, so this tool cannot use it.`,
    };
  }
  return build(
    file.title || baseName(name),
    'instrument',
    Array.from(file.spectra[0]?.x ?? []),
    file.spectra.map((s, i) => ({
      values: Array.from(s.y),
      columnName: `spectrum ${i + 1}`,
      hint: file.yKind,
    })),
    [
      { level: 'info', text: `Read from a ${file.format} file (y values: ${file.yLabel}).` },
      ...file.notes,
    ],
    file.spectra.length,
  );
}

/**
 * Reads JCAMP-DX, or text with wavenumber (cm⁻¹) in the first column and one or more spectra in
 * the other columns (delimiter, decimal comma, headers and comment lines are detected). A spectrum
 * recorded from high to low wavenumber, as FTIR instruments usually write it, is reversed so that
 * wavenumber increases inside the program; the plots show it high to low again.
 */
export function importFtirText(
  name: string,
  text: string,
  source: FtirSource = 'pasted',
): FtirImportResult {
  if (text.trim() === '') return { ok: false, error: 'There is no data to read.' };
  const title = baseName(name);

  if (looksLikeJcamp(text)) {
    const parsed = parseJcamp(text);
    if (!parsed.ok) return parsed;
    const { spectrum } = parsed;
    const kindHint = spectrum.yUnits.startsWith('TRANSMITTANCE')
      ? 'transmittance'
      : spectrum.yUnits.startsWith('REFLECTANCE')
        ? 'reflectance'
        : spectrum.yUnits.startsWith('ABSORBANCE')
          ? 'absorbance'
          : undefined;
    return build(
      spectrum.title || title,
      'jcamp',
      spectrum.wavenumber,
      [{ values: spectrum.values, columnName: '', hint: kindHint }],
      spectrum.notes,
      1,
    );
  }

  const lines = text.split(/\r\n|\r|\n/);
  const layout = detectLayout(lines);
  if (!layout) {
    return {
      ok: false,
      error:
        'No rows of numbers were found. The file should have wavenumber (cm⁻¹) in the first column and the spectrum in the second.',
    };
  }
  const header: string[] = [];
  const rows: { values: number[]; line: number }[] = [];
  const skipped: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const values = COMMENT.test(line) ? null : numericRow(line, layout);
    if (values) rows.push({ values, line: index + 1 });
    else if (rows.length === 0) header.push(line);
    else skipped.push(index + 1);
  });
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.values.length, (counts.get(row.values.length) ?? 0) + 1);
  const columns = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2;
  for (const row of rows) if (row.values.length !== columns) skipped.push(row.line);
  const good = rows.filter((row) => row.values.length === columns);
  if (columns < 2)
    return { ok: false, error: 'Only one column of numbers was found; a spectrum needs two.' };

  const notes: DataMessage[] = [];
  if (header.length > 0) {
    notes.push({
      level: 'info',
      text: `${plural(header.length, 'header line')} at the top ${header.length === 1 ? 'was' : 'were'} skipped.`,
    });
  }
  if (skipped.length > 0) {
    skipped.sort((a, b) => a - b);
    notes.push({
      level: 'warning',
      text: `${plural(skipped.length, 'line')} could not be read as data and ${skipped.length === 1 ? 'was' : 'were'} skipped (first at line ${skipped[0]}).`,
    });
  }
  if (layout.decimalComma) {
    notes.push({
      level: 'info',
      text: 'Numbers use a decimal comma (for example 12,5) and were read that way.',
    });
  }

  const lastHeader = header[header.length - 1];
  const headerFields = lastHeader ? splitFields(lastHeader, layout.delimiter) : [];
  const named = headerFields.length === columns;
  const headerText = header.join('\n');
  const wholeHint = ftirKindFromText(headerText);
  const sets = [];
  for (let c = 1; c < columns; c++) {
    const columnName = named ? (headerFields[c] as string) : '';
    // A column heading decides; the whole header counts only when the column names nothing.
    sets.push({
      values: good.map((row) => row.values[c] as number),
      columnName,
      hint: ftirKindFromText(columnName) ?? wholeHint,
    });
  }
  return build(
    title,
    source,
    good.map((row) => row.values[0] as number),
    sets,
    notes,
    columns - 1,
  );
}

function build(
  title: string,
  source: FtirSource,
  wavenumberIn: number[],
  sets: {
    values: number[];
    columnName: string;
    hint: FtirKind | undefined;
  }[],
  baseNotes: DataMessage[],
  columnCount: number,
): FtirImportResult {
  let wavenumber = wavenumberIn;
  const n = wavenumber.length;
  if (n < MIN_POINTS) {
    return {
      ok: false,
      error: `Only ${plural(n, 'data point')} ${n === 1 ? 'was' : 'were'} found. An FTIR spectrum normally has hundreds or thousands.`,
    };
  }
  const notes = [...baseNotes];
  const descending = (wavenumber[n - 1] as number) < (wavenumber[0] as number);
  const order = Array.from({ length: n }, (_, i) => (descending ? n - 1 - i : i));
  if (descending) {
    wavenumber = order.map((i) => wavenumberIn[i] as number);
    notes.push({
      level: 'info',
      text: 'Wavenumber ran from high to low, so the data were reversed.',
    });
  }
  for (let i = 1; i < n; i++) {
    const previous = wavenumber[i - 1] as number;
    const current = wavenumber[i] as number;
    if (current <= previous) {
      return {
        ok: false,
        error:
          current === previous
            ? `The wavenumber ${formatNumber(current)} appears twice in a row (points ${i} and ${i + 1}). Wavenumber must change from point to point.`
            : `Wavenumber is not in order at point ${i + 1} (from ${formatNumber(previous)} to ${formatNumber(current)}). The file may contain more than one scan joined together.`,
      };
    }
  }
  const low = wavenumber[0] as number;
  const high = wavenumber[n - 1] as number;
  if (high < 20) {
    return {
      ok: false,
      error: `The first column only runs from ${formatNumber(low)} to ${formatNumber(high)}. Wavenumber must be in cm⁻¹ (typically 400 to 4000). If these values are micrometres, convert them first.`,
    };
  }
  if (high > 20000) {
    notes.push({
      level: 'warning',
      text: `The first column goes up to ${formatNumber(high)}. FTIR wavenumbers rarely go beyond 15000 cm⁻¹, so check this is wavenumber in cm⁻¹ and not, for example, a point number or nm.`,
    });
  }

  const spectra: Omit<FtirSpectrum, 'id'>[] = [];
  sets.forEach((set, c) => {
    const values = Float64Array.from(order, (i) => set.values[i] as number);
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (min === max) {
      notes.push({
        level: 'warning',
        text: `Column ${c + 2} has the same value (${formatNumber(min)}) in every row, so it was not loaded.`,
      });
      return;
    }
    const suggestion = suggestFtirKind(values, set.hint ?? '');
    spectra.push({
      name: columnCount === 1 ? title : `${title} – ${set.columnName || `column ${c + 2}`}`,
      source,
      wavenumber: Float64Array.from(wavenumber),
      values,
      kind: suggestion.kind,
      scale: suggestion.scale,
      kindOrigin: suggestion.origin,
      synthetic: false,
      notes: [...notes],
    });
  });
  if (spectra.length === 0) {
    return {
      ok: false,
      error:
        'Every column after the wavenumber has a constant value, so there is no spectrum to analyse.',
    };
  }
  return { ok: true, spectra };
}
