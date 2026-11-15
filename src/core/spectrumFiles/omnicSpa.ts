import { dataView, evenAxis, latin1 } from './types';
import type { InstrumentResult } from './types';

/*
 * Thermo OMNIC .spa reader. Written against the real file in tests/fixtures-real/spectra
 * (provenance in its README) and checked against independent readers. Layout, little-endian:
 *
 *   0     "Spectral Data File" signature        30   title (256 bytes)
 *   304   directory, 16-byte entries: key (u8), then at +2 offset (u32) and +6 size (u32)
 *           key 2: spectrum header: +4 points (u32), +8 x unit code (u32),
 *                  +12 y unit code (u32), +16 first x (f32), +20 last x (f32)
 *           key 3: the y values, float32 × points
 *
 * x runs evenly from the first to the last value. Unit codes are named only where a real file
 * confirms them: x 1 wavenumber (cm⁻¹), y 17 absorbance; any other code is passed on as a
 * number and the y kind is guessed from the values, as for a text file.
 */

const DIRECTORY = 304;
const ENTRY = 16;

export const looksLikeOmnicSpa = (bytes: Uint8Array): boolean =>
  latin1(bytes, 0, 18) === 'Spectral Data File';

export function parseOmnicSpa(bytes: Uint8Array): InstrumentResult {
  const view = dataView(bytes);
  const damaged = { ok: false as const, error: 'This OMNIC .spa file is damaged or incomplete.' };
  let header: number | undefined;
  let data: { offset: number; size: number } | undefined;
  for (let at = DIRECTORY; at + ENTRY <= bytes.length; at += ENTRY) {
    const key = bytes[at] as number;
    const offset = view.getUint32(at + 2, true);
    const size = view.getUint32(at + 6, true);
    if (key === 0 && offset === 0) break;
    if (key === 2 && header === undefined) header = offset;
    if (key === 3 && data === undefined) data = { offset, size };
    if (header !== undefined && data !== undefined) break;
  }
  if (header === undefined || data === undefined || header + 24 > bytes.length) return damaged;
  const points = view.getUint32(header + 4, true);
  const xCode = view.getUint32(header + 8, true);
  const yCode = view.getUint32(header + 12, true);
  const first = view.getFloat32(header + 16, true);
  const last = view.getFloat32(header + 20, true);
  if (points < 2 || 4 * points > data.size || data.offset + 4 * points > bytes.length) {
    return damaged;
  }
  const y = new Float64Array(points);
  for (let i = 0; i < points; i++) y[i] = view.getFloat32(data.offset + 4 * i, true);
  return {
    ok: true,
    file: {
      format: 'Thermo OMNIC .spa',
      title: latin1(bytes, 30, 256),
      xUnit: xCode === 1 ? 'wavenumber' : 'other',
      xLabel: xCode === 1 ? 'wavenumber (cm⁻¹)' : `x unit code ${xCode}`,
      ...(yCode === 17 && { yKind: 'absorbance' as const }),
      yLabel: yCode === 17 ? 'absorbance' : `y unit code ${yCode}`,
      spectra: [{ x: evenAxis(first, last, points), y }],
      notes: [],
    },
  };
}
