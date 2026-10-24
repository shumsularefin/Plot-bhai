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
  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(sigma && { sigma }),
      ...(unit && { unitFromFile: unit }),
      notes,
    },
  };
}
