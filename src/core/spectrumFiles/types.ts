import type { DataMessage } from '../xrd/types';

/**
 * What the x axis of an instrument file is. Only units that a real test file confirmed are named
 * (tests/fixtures-real/spectra, provenance in its README); any other code is 'other'.
 */
export type InstrumentXUnit = 'wavenumber' | 'raman-shift' | 'nm' | 'other';

/** What the file says its y values are, when it says so in a way a real test file confirmed. */
export type InstrumentYKind = 'absorbance' | 'transmittance' | 'reflectance';

/** A spectrum read from a binary instrument file, in the file's own order and units. */
export interface InstrumentFile {
  /** Format name for messages, for example "Thermo OMNIC .spa". */
  format: string;
  /** Title stored in the file, or ''. */
  title: string;
  xUnit: InstrumentXUnit;
  /** The x unit as the file states it, for messages ("code 4", "PNT", "cm-1"). */
  xLabel: string;
  yKind?: InstrumentYKind;
  /** Percent or fraction, only when the file states it ("%T"). */
  yScale?: 'percent' | 'fraction';
  /** The y unit as the file states it, for messages. */
  yLabel: string;
  /** One or more spectra (a Galactic file may hold several on one x axis). */
  spectra: { x: Float64Array; y: Float64Array }[];
  notes: DataMessage[];
}

export type InstrumentResult = { ok: true; file: InstrumentFile } | { ok: false; error: string };

/** Text of bytes [at, at + length), stopping at the first NUL, Latin-1. */
export function latin1(bytes: Uint8Array, at: number, length: number): string {
  let s = '';
  for (let i = at; i < Math.min(bytes.length, at + length); i++) {
    const c = bytes[i] as number;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

export const dataView = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** n evenly spaced values from first to last (first itself when n = 1). */
export function evenAxis(first: number, last: number, n: number): Float64Array {
  const x = new Float64Array(n);
  const step = n > 1 ? (last - first) / (n - 1) : 0;
  for (let i = 0; i < n; i++) x[i] = first + i * step;
  return x;
}
