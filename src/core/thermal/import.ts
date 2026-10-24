import { decodeText, hasNulBytes, isZip } from '../text/bytes';
import { COMMENT, detectLayout, numericRow, splitFields } from '../text/delimitedTable';
import { baseName } from '../xrd/import';
import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import type { ColumnMapping, ThermalImportResult, ThermalRun, ThermalTable } from './types';

/** A thermal run is a few thousand points; far larger files are not a plain text export. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Fewer points than this cannot show a mass loss step. */
const MIN_POINTS = 10;

const EXPORT_HINT =
  'In the instrument software, export the run as text or csv (temperature, time and mass in columns), then load that file. Binary instrument files cannot be read here.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Imports a file's bytes. */
export function importThermalFile(bytes: Uint8Array): ThermalImportResult {
  if (bytes.length === 0) return { ok: false, error: 'This file is empty.' };
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'This file is larger than 50 MB, far bigger than a thermal run.' };
  }
  const utf16 =
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (isZip(bytes) || (!utf16 && hasNulBytes(bytes))) {
    return {
      ok: false,
      error: `This is a binary file (for example Excel or an instrument format), not a text file. ${EXPORT_HINT}`,
    };
  }
  // Instrument software often writes Windows-1252 (for the degree sign); Latin-1 never fails.
  const result = importThermalText(decodeText(bytes, 'latin1'));
  return result.ok ? result : { ok: false, error: `${result.error} ${EXPORT_HINT}` };
}

/** Removes the comment marker in front of a header line ("## Temp./°C;Mass/%" → "Temp./°C;Mass/%"). */
const stripComment = (line: string) => line.replace(/^\s*[#;!%*/]+\s*/, '');

/**
 * Reads a text table of numbers: header block above the data, tab, semicolon, comma or space
 * separators, decimal commas, and comment lines. Does not decide which column is which; that is
 * `guessMapping` and the user. The temperature does not have to be in order here (a run that
 * heats and then cools is cut later, in the cleaning step).
 */
export function importThermalText(text: string): ThermalImportResult {
  if (text.trim() === '') return { ok: false, error: 'There is no data to read.' };
  const lines = text.split(/\r\n|\r|\n/);
  const layout = detectLayout(lines);
  if (!layout) {
    return {
      ok: false,
      error:
        'No rows of numbers were found. The file should have columns such as temperature and mass.',
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
    else if (!COMMENT.test(line)) skipped.push(index + 1);
  });

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.values.length, (counts.get(row.values.length) ?? 0) + 1);
  const width = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2;
  for (const row of rows) if (row.values.length !== width) skipped.push(row.line);
  const good = rows.filter((row) => row.values.length === width);
  if (good.length < MIN_POINTS) {
    return {
      ok: false,
      error: `Only ${plural(good.length, 'data row')} ${good.length === 1 ? 'was' : 'were'} found. A thermal run normally has hundreds or thousands.`,
    };
  }

  const notes: DataMessage[] = [];
  if (header.length > 0) {
    notes.push({
      level: 'info',
      text: `${plural(header.length, 'header line')} at the top ${header.length === 1 ? 'was' : 'were'} not read as data (they are used to guess the column names and units).`,
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

  // Names: the last one or two header lines that have one field per column (names, then units).
  const namedLines = header
    .map((line) => splitFields(stripComment(line), layout.delimiter))
    .filter((fields) => fields.length === width)
    .slice(-2);
  const names = Array.from({ length: width }, (_, c) => {
    const text = namedLines
      .map((fields) => fields[c] as string)
      .filter((f) => f !== '')
      .join(' ');
    return text || `Column ${c + 1}`;
  });

  const columns = Array.from({ length: width }, (_, c) =>
    Float64Array.from(good.map((row) => row.values[c] as number)),
  );
  return {
    ok: true,
    table: { names, columns, headerText: header.map(stripComment).join('\n'), notes },
  };
}

const TEMPERATURE = /temp|°\s*c|degc|\bkelvin\b|\[k\]|\(k\)|\/k\b/i;
const MASS = /mass|weight|\bwt\b|\btg\b|\btga\b|\bmg\b|\bm\/mg\b/i;
const TIME = /\btime\b|\bmin\b|\bsec/i;
const HEAT_FLOW = /heat\s*flow|\bdsc\b|\bmw\b|w\s*\/\s*g/i;

/**
 * Guesses the column roles from the names and units in the header. Only a first suggestion for
 * the user to check: nothing here is specific to one manufacturer's format.
 */
export function guessMapping(table: ThermalTable): ColumnMapping {
  const find = (pattern: RegExp, taken: Set<number>) => {
    const index = table.names.findIndex((n, i) => !taken.has(i) && pattern.test(n));
    return index === -1 ? null : index;
  };
  const taken = new Set<number>();
  const take = (index: number | null) => {
    if (index !== null) taken.add(index);
    return index;
  };
  // Order matters: "Heat flow (mW)" must not be read as mass because of "mW".
  const heatFlow = take(find(HEAT_FLOW, taken));
  const temperature = take(find(TEMPERATURE, taken)) ?? take(0);
  const time = take(find(TIME, taken));
  let mass = take(find(MASS, taken));
  if (mass === null && table.names.every((n) => /^Column \d+$/.test(n))) {
    // No header at all: the usual order is temperature, (time), mass.
    const rest = table.names.map((_, i) => i).filter((i) => !taken.has(i));
    mass = take(rest[rest.length - 1] ?? null);
  }
  const name = (index: number | null) => (index === null ? '' : (table.names[index] as string));
  const kelvin = /\bkelvin\b|\[k\]|\(k\)|\/k\b/i.test(name(temperature));
  return {
    temperature: temperature as number,
    temperatureUnit: kelvin ? 'K' : 'C',
    mass,
    massUnit: /%|percent/i.test(name(mass)) ? 'percent' : 'mg',
    time,
    timeUnit: /\bs\b|\bsec|\[s\]|\(s\)|\/s\b/i.test(name(time)) ? 's' : 'min',
    heatFlow,
  };
}

/** Kelvin to degrees Celsius: T(°C) = T(K) − 273.15 (the definition of the Celsius scale). */
export const KELVIN_OFFSET = 273.15;

/**
 * Applies the user's column choices: converts to °C, minutes and keeps mass as recorded.
 * Returns an error in plain language when a chosen column is not usable.
 */
export function buildRun(
  name: string,
  table: ThermalTable,
  mapping: ColumnMapping,
): { ok: true; run: ThermalRun } | { ok: false; error: string } {
  const column = (index: number | null) => (index === null ? null : (table.columns[index] ?? null));
  const temperature = column(mapping.temperature);
  if (!temperature) return { ok: false, error: 'Choose the temperature column.' };
  const mass = column(mapping.mass);
  const heatFlow = column(mapping.heatFlow);
  if (!mass && !heatFlow) {
    return { ok: false, error: 'Choose a mass column (for TGA) or a heat flow column (for DSC).' };
  }
  const chosen = [mapping.temperature, mapping.mass, mapping.time, mapping.heatFlow].filter(
    (c): c is number => c !== null,
  );
  if (new Set(chosen).size !== chosen.length) {
    return {
      ok: false,
      error: 'Each column can have only one role. Two roles use the same column.',
    };
  }
  const notes: DataMessage[] = [...table.notes];
  const offset = mapping.temperatureUnit === 'K' ? KELVIN_OFFSET : 0;
  const temperatureC = temperature.map((t) => t - offset);
  let low = Infinity;
  let high = -Infinity;
  for (const t of temperatureC) {
    low = Math.min(low, t);
    high = Math.max(high, t);
  }
  if (!(high > low)) {
    return { ok: false, error: 'The temperature column has the same value in every row.' };
  }
  if (mapping.temperatureUnit === 'C' && low >= 265 && low <= 320) {
    notes.push({
      level: 'warning',
      text: `Temperature starts at ${formatNumber(low, 1)}. If the column is in kelvin (room temperature is about 298 K), choose K as its unit; otherwise this is read as °C.`,
    });
  }
  if (mapping.temperatureUnit === 'K') {
    notes.push({
      level: 'info',
      text: 'Temperature was converted from kelvin to °C (subtracting 273.15).',
    });
  }
  const time = column(mapping.time);
  const timeMin = time ? time.map((t) => (mapping.timeUnit === 's' ? t / 60 : t)) : null;
  return {
    ok: true,
    run: {
      name: baseName(name),
      temperatureC,
      mass,
      massUnit: mapping.massUnit,
      timeMin,
      heatFlow,
      notes,
    },
  };
}
