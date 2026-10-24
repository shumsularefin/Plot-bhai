import { parseNumber } from '../xrd/parsers/numbers';

/** Shared by the XRD and UV-Vis text readers: finds the delimiter and reads rows of numbers. */
/** Column separators we try, in order of preference when several fit equally well. */
export type Delimiter = '\t' | ';' | ',' | 'space';
const DELIMITERS: readonly Delimiter[] = ['\t', ';', ',', 'space'];

/** Lines starting with these characters are comments in common XRD text exports. */
export const COMMENT = /^\s*[#;!%*/]/;

export interface Layout {
  delimiter: Delimiter;
  /** Numbers written with a decimal comma, for example "12,5". Only possible when the delimiter is not a comma. */
  decimalComma: boolean;
}

export function splitFields(line: string, delimiter: Delimiter): string[] {
  const fields = (
    delimiter === 'space' ? line.trim().split(/\s+/) : line.split(delimiter).map((f) => f.trim())
  ).map((f) => f.replace(/^"(.*)"$/, '$1'));
  // A trailing delimiter ("10.0,123,") leaves one empty field at the end.
  if (fields.length > 1 && fields[fields.length - 1] === '') fields.pop();
  return fields;
}

/** Returns the numbers on a line, or null if any field is not a number or there are fewer than two. */
export function numericRow(line: string, layout: Layout): number[] | null {
  const fields = splitFields(line, layout.delimiter);
  if (fields.length < 2) return null;
  const values = fields.map((f) => parseNumber(layout.decimalComma ? f.replace(',', '.') : f));
  return values.some(Number.isNaN) ? null : values;
}

/** Picks the delimiter (and decimal style) that turns the most lines into rows of numbers. */
export function detectLayout(lines: readonly string[]): Layout | null {
  const sample = lines.filter((l) => l.trim() !== '' && !COMMENT.test(l)).slice(0, 400);
  let best: { layout: Layout; rows: number } | null = null;
  for (const delimiter of DELIMITERS) {
    for (const decimalComma of delimiter === ',' ? [false] : [false, true]) {
      const layout = { delimiter, decimalComma };
      const rows = sample.filter((l) => numericRow(l, layout) !== null).length;
      if (rows > 0 && (best === null || rows > best.rows)) best = { layout, rows };
    }
  }
  return best?.layout ?? null;
}
