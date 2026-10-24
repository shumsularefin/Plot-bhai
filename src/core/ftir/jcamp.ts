import { parseNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';

/** What a JCAMP-DX file gave us, before validation. Wavenumber in cm⁻¹ in file order. */
export interface JcampSpectrum {
  title: string;
  wavenumber: number[];
  values: number[];
  /** Y unit as written, upper case, for example "ABSORBANCE" or "TRANSMITTANCE". */
  yUnits: string;
  notes: DataMessage[];
}

export type JcampResult = { ok: true; spectrum: JcampSpectrum } | { ok: false; error: string };

export const looksLikeJcamp = (text: string): boolean => /^\s*##\s*TITLE\s*=/im.test(text);

/** Label normalised as the JCAMP-DX standard asks: upper case, no spaces, dashes or slashes. */
const normaliseLabel = (label: string) => label.replace(/[\s\-_/]/g, '').toUpperCase();

/** Labelled data records (##LABEL=value) in order; text after "$$" is a comment. */
function records(text: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\$\$.*$/, '');
    const start = /^\s*##([^=]*)=(.*)$/.exec(line);
    if (start) out.push({ label: normaliseLabel(start[1] ?? ''), value: (start[2] ?? '').trim() });
    else if (out.length > 0 && line.trim() !== '') {
      const last = out[out.length - 1] as { label: string; value: string };
      last.value += `\n${line.trim()}`;
    }
  }
  return out;
}

const COMPRESSED =
  'This JCAMP-DX file stores its numbers in a compressed form (letters in the data), which this site cannot read. Export the spectrum as plain JCAMP-DX or as .csv from the instrument software.';

/**
 * Reads the first spectrum of a JCAMP-DX file. Written from the format as I know it and tested
 * on generated files only; not checked against the standard's text or an instrument file. Supported: ##XYDATA=(X++(Y..Y)) with
 * plain decimal numbers, and ##XYPOINTS=(XY..XY). X is scaled by ##XFACTOR and Y by ##YFACTOR.
 * With ##FIRSTX, ##LASTX and ##NPOINTS the spacing of the points on a line is exact; without
 * them it comes from the next line's X value. X units: 1/CM (used as is), MICROMETERS
 * (cm⁻¹ = 10⁴ / µm) or NANOMETERS (cm⁻¹ = 10⁷ / nm). The compressed forms (SQZ, DIF, DUP) and
 * files with several spectra beyond the first are not supported; a note says so.
 */
export function parseJcamp(text: string): JcampResult {
  const recs = records(text);
  const get = (label: string) => recs.find((r) => r.label === label)?.value;
  const notes: DataMessage[] = [];

  const dataIndex = recs.findIndex((r) => r.label === 'XYDATA' || r.label === 'XYPOINTS');
  if (dataIndex < 0) {
    return {
      ok: false,
      error:
        'This JCAMP-DX file has no XYDATA or XYPOINTS table of numbers (it may be a peak table or a different data type).',
    };
  }
  const data = recs[dataIndex] as { label: string; value: string };
  const further = recs
    .slice(dataIndex + 1)
    .filter((r) => r.label === 'XYDATA' || r.label === 'XYPOINTS').length;
  if (further > 0) {
    notes.push({
      level: 'warning',
      text: 'This file holds more than one spectrum. Only the first was read.',
    });
  }

  const xFactor = parseNumber(get('XFACTOR') ?? '1') || 1;
  const yFactor = parseNumber(get('YFACTOR') ?? '1') || 1;
  const xUnits = (get('XUNITS') ?? '').toUpperCase().replace(/\s/g, '');
  const yUnits = (get('YUNITS') ?? '').toUpperCase().trim();

  let toWavenumber: (x: number) => number;
  if (xUnits === '1/CM' || xUnits === 'CM-1' || xUnits === '') {
    toWavenumber = (x) => x;
    if (xUnits === '') {
      notes.push({
        level: 'warning',
        text: 'The file does not state its X units; cm⁻¹ was assumed.',
      });
    }
  } else if (xUnits === 'MICROMETERS' || xUnits === 'MICRONS') {
    toWavenumber = (x) => 1e4 / x;
    notes.push({
      level: 'info',
      text: 'The X axis was in micrometres and was converted to cm⁻¹ (10⁴ / µm).',
    });
  } else if (xUnits === 'NANOMETERS') {
    toWavenumber = (x) => 1e7 / x;
    notes.push({
      level: 'info',
      text: 'The X axis was in nanometres and was converted to cm⁻¹ (10⁷ / nm).',
    });
  } else {
    return {
      ok: false,
      error: `The X units of this file are "${get('XUNITS')}", which this site does not read. It needs 1/CM (wavenumber), micrometres or nanometres.`,
    };
  }

  const body = data.value.split('\n').slice(1);
  const xs: number[] = [];
  const ys: number[] = [];

  if (data.label === 'XYPOINTS') {
    for (const line of body) {
      for (const pair of line.split(/;|\s{2,}/).filter((p) => p.trim() !== '')) {
        const parts = pair.trim().split(/[\s,]+/);
        if (parts.length < 2) continue;
        const x = parseNumber(parts[0] as string);
        const y = parseNumber(parts[1] as string);
        if (Number.isNaN(x) || Number.isNaN(y)) return { ok: false, error: COMPRESSED };
        xs.push(x * xFactor);
        ys.push(y * yFactor);
      }
    }
  } else {
    const lines: { x: number; y: number[] }[] = [];
    for (const line of body) {
      const tokens = line
        .trim()
        .split(/[\s,]+/)
        .filter((t) => t !== '');
      if (tokens.length < 2) continue;
      const numbers = tokens.map(parseNumber);
      if (numbers.some(Number.isNaN)) return { ok: false, error: COMPRESSED };
      lines.push({
        x: (numbers[0] as number) * xFactor,
        y: numbers.slice(1).map((v) => v * yFactor),
      });
    }
    const first = parseNumber(get('FIRSTX') ?? '');
    const last = parseNumber(get('LASTX') ?? '');
    const count = parseNumber(get('NPOINTS') ?? '');
    let delta: number | null =
      Number.isFinite(first) && Number.isFinite(last) && count > 1
        ? (last - first) / (count - 1)
        : null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as { x: number; y: number[] };
      const next = lines[i + 1];
      const step = delta ?? (next ? (next.x - line.x) / line.y.length : i > 0 ? Number.NaN : 0);
      if (delta === null && Number.isFinite(step)) delta = step;
      line.y.forEach((y, k) => {
        xs.push(line.x + k * (delta ?? step));
        ys.push(y);
      });
    }
  }
  if (xs.length === 0)
    return { ok: false, error: 'No numbers were found in the data table of this JCAMP-DX file.' };

  const count = parseNumber(get('NPOINTS') ?? '');
  if (Number.isFinite(count) && count !== xs.length) {
    notes.push({
      level: 'warning',
      text: `The file says it has ${count} points but ${xs.length} were read.`,
    });
  }
  return {
    ok: true,
    spectrum: {
      title: (get('TITLE') ?? '').split('\n')[0] ?? '',
      wavenumber: xs.map(toWavenumber),
      values: ys,
      yUnits,
      notes,
    },
  };
}
