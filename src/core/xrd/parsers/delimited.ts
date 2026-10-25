import type { DataMessage, IntensityUnit, ParseResult } from '../types';
import { parseNumber } from './numbers';
import { COMMENT, detectLayout, numericRow } from '../../text/delimitedTable';

/** Finds an intensity unit named in header text, such as a "2Theta, Intensity (cps)" column header. */
function unitFromHeader(header: readonly string[]): IntensityUnit | undefined {
  const text = header.join('\n');
  if (/\bcps\b|counts?\s*\/\s*s(ec)?\b|counts? per second/i.test(text)) return 'cps';
  if (/\bcounts?\b/i.test(text)) return 'counts';
  return undefined;
}

/** A "key, value" line of a file header, as written by the instrument software. */
export interface HeaderField {
  key: string;
  value: string;
}

/** What a header says about the measurement, read from its "key, value" lines. */
export interface HeaderInfo {
  fields: HeaderField[];
  /** K-alpha1 wavelength (Å) stated in the header. */
  wavelengthA?: number;
  /** Counting time per step (s) stated in the header. */
  countingTimeS?: number;
}

/**
 * Reads "key, value" (also "key: value", "key = value" or tab-separated) lines from a header,
 * for example the [Measurement conditions] block of a PANalytical X'Pert HighScore CSV export
 * ("K-Alpha1 wavelength,1.5405980"). Every pair is kept as written, for the record of the
 * analysis. The K-alpha1 wavelength is taken when its value lies between 0.3 and 3 Å (every
 * laboratory anode does), and the time per step when it is a positive number of seconds.
 * Section titles in brackets and lines without a value are skipped.
 */
export function readHeader(header: readonly string[]): HeaderInfo {
  const fields: HeaderField[] = [];
  const info: HeaderInfo = { fields };
  for (const line of header) {
    const text = line.trim();
    if (text === '' || /^\[.*\]$/.test(text)) continue;
    const match = /^([A-Za-z][^,:=\t]*?)\s*[,:=\t]\s*(.*)$/.exec(text);
    if (!match) continue;
    const key = (match[1] as string).trim();
    const value = (match[2] as string)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/,+$/, '')
      .trim();
    if (value === '') continue;
    fields.push({ key, value });
    const number = parseNumber(value.split(/[,;\s]+/)[0] ?? '');
    if (/k-?\s*alpha\s*1\b.*wavelength|^wavelength\b|^lambda\b/i.test(key)) {
      if (number >= 0.3 && number <= 3) info.wavelengthA = number;
    } else if (/time per step|counting time|step time/i.test(key)) {
      if (number > 0) info.countingTimeS = number;
    }
  }
  return info;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Reads two- or three-column text data (.xy, .xye, .dat, .txt, .csv or pasted text).
 * Detects the delimiter (tab, semicolon, comma or spaces), decimal commas, header lines and
 * comment lines. Column 1 is 2θ in degrees, column 2 intensity. With `thirdColumnIsSigma`
 * (.xye files) column 3 is read as the standard uncertainty of the intensity; otherwise extra
 * columns are ignored.
 */
export function parseDelimited(
  text: string,
  options: { thirdColumnIsSigma: boolean },
): ParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const layout = detectLayout(lines);
  if (!layout) {
    const singleColumn = lines.some((l) => !Number.isNaN(parseNumber(l.trim())));
    return {
      ok: false,
      error: singleColumn
        ? 'Only one column of numbers was found. The file needs 2θ in the first column and intensity in the second.'
        : 'No rows of numbers were found. The file should have 2θ in the first column and intensity in the second.',
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

  // Use the most common column count; rows with a different count are skipped.
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.values.length, (counts.get(row.values.length) ?? 0) + 1);
  const columns = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2;
  for (const row of rows) if (row.values.length !== columns) skipped.push(row.line);
  const good = rows.filter((row) => row.values.length === columns);

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

  const useSigma = options.thirdColumnIsSigma && columns >= 3;
  const ignored = columns - (useSigma ? 3 : 2);
  if (ignored > 0) {
    notes.push({
      level: 'info',
      text: `Only the first two columns (2θ and intensity) are used; ${plural(ignored, 'extra column')} ${ignored === 1 ? 'was' : 'were'} ignored.`,
    });
  }

  const twoTheta = good.map((row) => row.values[0] as number);
  const intensity = good.map((row) => row.values[1] as number);
  let sigma = useSigma ? good.map((row) => row.values[2] as number) : undefined;
  if (sigma?.some((s) => s < 0)) {
    notes.push({
      level: 'warning',
      text: 'The third column has negative values, so it cannot be an uncertainty. It was ignored.',
    });
    sigma = undefined;
  }

  const unit = unitFromHeader(header);
  const info = readHeader(header);
  if (info.fields.length > 0) {
    notes.push({
      level: 'info',
      text: `The header lists ${plural(info.fields.length, 'measurement setting')}; they are kept with the pattern${info.wavelengthA !== undefined ? `, and its Kα1 wavelength (${info.wavelengthA} Å) is checked against your radiation setting` : ''}.`,
    });
  }
  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(sigma && { sigma }),
      ...(unit && { unitFromFile: unit }),
      ...(info.wavelengthA !== undefined && { wavelengthFromFileA: info.wavelengthA }),
      ...(info.countingTimeS !== undefined && { countingTimeS: info.countingTimeS }),
      ...(info.fields.length > 0 && { metadata: info.fields }),
      notes,
    },
  };
}
