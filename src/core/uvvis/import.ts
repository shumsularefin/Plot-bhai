import { decodeText, hasNulBytes, isZip } from '../text/bytes';
import { COMMENT, detectLayout, numericRow, splitFields } from '../text/delimitedTable';
import { baseName } from '../xrd/import';
import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import { kindFromText, suggestKind } from './kind';
import type { SpectraImportResult, Spectrum, SpectrumSource } from './types';

/** UV-Vis exports are small; larger files are refused before reading. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** A spectrum with fewer points than this cannot show an absorption edge. */
const MIN_POINTS = 10;

const EXPORT_HINT =
  'In the instrument software, export the spectrum as .csv or .txt (wavelength in the first column), then load that file.';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Imports a file's bytes. `name` is the file name, used for the format and the spectrum names. */
export function importSpectraFile(name: string, bytes: Uint8Array): SpectraImportResult {
  if (bytes.length === 0) return { ok: false, error: 'This file is empty.' };
  if (bytes.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: 'This file is larger than 10 MB, far bigger than a UV-Vis spectrum.',
    };
  }
  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (isZip(bytes) || (!utf16 && hasNulBytes(bytes))) {
    return {
      ok: false,
      error: `This is a binary file (for example Excel or an instrument format), not a text file. ${EXPORT_HINT}`,
    };
  }
  // Instrument software often writes Windows-1252; Latin-1 never fails and keeps the numbers.
  const text = decodeText(bytes, 'latin1');
  return importSpectraText(name, text, extensionOf(name) === 'csv' ? 'csv' : 'text');
}

/**
 * Reads text with wavelength (nm) in the first column and one or more spectra in the
 * other columns. Detects the delimiter (tab, semicolon, comma or spaces), decimal commas,
 * header lines and comment lines. Column names come from the last header line when it has
 * one name per column. A spectrum recorded from long to short wavelength is reversed.
 */
export function importSpectraText(
  name: string,
  text: string,
  source: SpectrumSource = 'pasted',
): SpectraImportResult {
  if (text.trim() === '') return { ok: false, error: 'There is no data to read.' };
  const lines = text.split(/\r\n|\r|\n/);
  const layout = detectLayout(lines);
  if (!layout) {
    return {
      ok: false,
      error:
        'No rows of numbers were found. The file should have wavelength (nm) in the first column and the spectrum in the second.',
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

  const baseNotes: DataMessage[] = [];
  if (header.length > 0) {
    baseNotes.push({
      level: 'info',
      text: `${plural(header.length, 'header line')} at the top ${header.length === 1 ? 'was' : 'were'} skipped.`,
    });
  }
  if (skipped.length > 0) {
    skipped.sort((a, b) => a - b);
    baseNotes.push({
      level: 'warning',
      text: `${plural(skipped.length, 'line')} could not be read as data and ${skipped.length === 1 ? 'was' : 'were'} skipped (first at line ${skipped[0]}).`,
    });
  }
  if (layout.decimalComma) {
    baseNotes.push({
      level: 'info',
      text: 'Numbers use a decimal comma (for example 12,5) and were read that way.',
    });
  }

  let wavelength = good.map((row) => row.values[0] as number);
  const n = wavelength.length;
  if (n < MIN_POINTS) {
    return {
      ok: false,
      error: `Only ${plural(n, 'data point')} ${n === 1 ? 'was' : 'were'} found. A UV-Vis spectrum normally has hundreds.`,
    };
  }

  // Order: ascending wavelength. A fully descending scan is reversed; anything else is an error.
  const descending = (wavelength[n - 1] as number) < (wavelength[0] as number);
  const reversedRows = descending ? [...good].reverse() : good;
  if (descending) wavelength = wavelength.reverse();
  for (let i = 1; i < n; i++) {
    const previous = wavelength[i - 1] as number;
    const current = wavelength[i] as number;
    if (current <= previous) {
      return {
        ok: false,
        error:
          current === previous
            ? `The wavelength ${formatNumber(current)} appears twice in a row (points ${i} and ${i + 1}). Wavelength must change from point to point.`
            : `Wavelength is not in order at point ${i + 1} (from ${formatNumber(previous)} to ${formatNumber(current)}). The file may contain more than one scan joined together.`,
      };
    }
  }
  if (descending) {
    baseNotes.push({
      level: 'info',
      text: 'Wavelength ran from long to short, so the data were reversed.',
    });
  }

  const low = wavelength[0] as number;
  const high = wavelength[n - 1] as number;
  if (high < 20) {
    return {
      ok: false,
      error: `The first column only runs from ${formatNumber(low)} to ${formatNumber(high)}. Wavelength must be in nanometres (typically 200 to 2500). If these values are energy (eV) or micrometres, convert them to nm first.`,
    };
  }
  if (high > 3300) {
    baseNotes.push({
      level: 'warning',
      text: `The first column goes up to ${formatNumber(high)}. UV-Vis-NIR spectrometers rarely go beyond 3300 nm, so check this is wavelength in nm and not, for example, a wavenumber.`,
    });
  }
  if (columns < 2) {
    return { ok: false, error: 'Only one column of numbers was found; a spectrum needs two.' };
  }

  // Column names from the last header line, when it has one field per column.
  const lastHeader = header[header.length - 1];
  const headerFields = lastHeader ? splitFields(lastHeader, layout.delimiter) : [];
  const named = headerFields.length === columns;
  const headerText = header.join('\n');
  const title = baseName(name);

  const spectra: Omit<Spectrum, 'id'>[] = [];
  for (let c = 1; c < columns; c++) {
    const values = Float64Array.from(reversedRows.map((row) => row.values[c] as number));
    const columnName = named ? (headerFields[c] as string) : '';
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (min === max) {
      baseNotes.push({
        level: 'warning',
        text: `Column ${c + 1} has the same value (${formatNumber(min)}) in every row, so it was not loaded.`,
      });
      continue;
    }
    const suggestion = suggestKind(
      values,
      kindFromText(columnName) ? columnName : kindFromText(headerText) ? headerText : '',
    );
    spectra.push({
      name: columns === 2 ? title : `${title} – ${columnName || `column ${c + 1}`}`,
      source,
      wavelengthNm: Float64Array.from(wavelength),
      values,
      kind: suggestion.kind,
      scale: suggestion.scale,
      kindOrigin: suggestion.origin,
      synthetic: false,
      notes: [...baseNotes],
    });
  }
  if (spectra.length === 0) {
    return {
      ok: false,
      error:
        'Every column after the wavelength has a constant value, so there is no spectrum to analyse.',
    };
  }
  return { ok: true, spectra };
}
