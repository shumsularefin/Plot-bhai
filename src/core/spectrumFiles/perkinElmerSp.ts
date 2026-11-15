import { dataView, latin1 } from './types';
import type { InstrumentResult, InstrumentYKind } from './types';

/*
 * PerkinElmer .sp reader (Spectrum and UV WinLab "2D constant interval DataSet file"). Written
 * against the real files in tests/fixtures-real/spectra (provenance in its README) and checked
 * against independent readers. Layout, little-endian:
 *
 *   0    "PEPE"      4 description (40 bytes)      44 main block: id (i16), size (i32)
 *   50   members, each: id (i16), size (i32), then `size` bytes that start with a type (i16)
 *          -29838 abscissa range: first, last (f64)     -29836 interval (f64)
 *          -29835 number of points (i32)                -29833, -29832 x and y labels:
 *                                                           length (i16) and text
 *          -29828 data: then size (i32) and the y values, float64
 *
 * x_i = first + i · interval. The y label names the kind where a real file confirms it:
 * "%T" transmittance in percent, "A" absorbance.
 */

const KINDS: Record<string, { kind: InstrumentYKind; scale?: 'percent' }> = {
  '%T': { kind: 'transmittance', scale: 'percent' },
  A: { kind: 'absorbance' },
};

export const looksLikePerkinElmerSp = (bytes: Uint8Array): boolean =>
  latin1(bytes, 0, 4) === 'PEPE';

export function parsePerkinElmerSp(bytes: Uint8Array): InstrumentResult {
  const view = dataView(bytes);
  const damaged = {
    ok: false as const,
    error: 'This PerkinElmer .sp file is damaged or incomplete.',
  };
  if (latin1(bytes, 4, 40) !== '2D constant interval DataSet file') {
    return {
      ok: false,
      error:
        'This PerkinElmer file is not a single spectrum (for example it is an image or a map), which this site cannot read. In the instrument software, export the spectrum as .csv or .asc, then load that file.',
    };
  }
  let first: number | undefined;
  let last: number | undefined;
  let interval: number | undefined;
  let points: number | undefined;
  let xLabel = '';
  let yLabel = '';
  let data: { at: number; count: number } | undefined;
  const label = (at: number) => latin1(bytes, at + 4, view.getInt16(at + 2, true));
  for (let at = 50; at + 6 <= bytes.length;) {
    const id = view.getInt16(at, true);
    const size = view.getInt32(at + 2, true);
    const body = at + 6;
    if (size < 0 || body + size > bytes.length) return damaged;
    if (id === -29838 && size >= 18) {
      first = view.getFloat64(body + 2, true);
      last = view.getFloat64(body + 10, true);
    } else if (id === -29836 && size >= 10) interval = view.getFloat64(body + 2, true);
    else if (id === -29835 && size >= 6) points = view.getInt32(body + 2, true);
    else if (id === -29833 && size >= 4) xLabel = label(body);
    else if (id === -29832 && size >= 4) yLabel = label(body);
    else if (id === -29828 && size >= 6) {
      data = { at: body + 6, count: Math.floor(view.getInt32(body + 2, true) / 8) };
    }
    at = body + size;
  }
  if (
    first === undefined ||
    last === undefined ||
    interval === undefined ||
    points === undefined ||
    !data ||
    points < 2 ||
    data.count < points ||
    data.at + 8 * points > bytes.length
  ) {
    return damaged;
  }
  // The stored range must agree with first + (points − 1) · interval.
  if (Math.abs(first + (points - 1) * interval - last) > Math.abs(interval) * 1e-6) return damaged;
  const x = new Float64Array(points);
  const y = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    x[i] = first + i * interval;
    y[i] = view.getFloat64(data.at + 8 * i, true);
  }
  const kind = KINDS[yLabel];
  // Only "cm-1" is held in a real file; any other x label is passed on for the message.
  const wavenumber = xLabel === 'cm-1';
  return {
    ok: true,
    file: {
      format: 'PerkinElmer .sp',
      title: '',
      xUnit: wavenumber ? 'wavenumber' : 'other',
      xLabel: wavenumber ? 'wavenumber (cm⁻¹)' : `x unit "${xLabel}"`,
      ...(kind && { yKind: kind.kind }),
      ...(kind?.scale && { yScale: kind.scale }),
      yLabel: yLabel || 'not stated',
      spectra: [{ x, y }],
      notes: [],
    },
  };
}
