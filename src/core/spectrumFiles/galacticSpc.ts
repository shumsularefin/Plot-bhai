import { dataView, evenAxis, latin1 } from './types';
import type { InstrumentResult, InstrumentXUnit, InstrumentYKind } from './types';

/*
 * Galactic (Thermo GRAMS) .spc reader, new little-endian format only (version byte 0x4B).
 * Written against the real files in tests/fixtures-real/spectra (provenance in its README) and
 * checked point by point against the text that two independent readers write for them.
 * Layout, little-endian:
 *
 *   0    flags (u8): 0x01 y as 16-bit integers, 0x04 several subfiles, 0x40 each subfile with
 *        its own x values (XYXY), 0x80 one x array (float32) follows the header
 *   1    version (u8): 0x4B new LSB, 0x4C new MSB, 0x4D old format
 *   3    exponent of the y values (i8); -128 means the y values are float32
 *   4    points (i32)       8 first x (f64)       16 last x (f64)       24 subfiles (i32)
 *   28   x unit code (u8)   29 y unit code (u8)   88 comment (130 bytes)
 *   512  [x array, float32 × points, when flag 0x80] then each subfile: a 32-byte subheader
 *        (its own exponent at +1, i8) and the y values
 *
 * Integer y values are scaled as y = integer · 2^(exponent − 32), or 2^(exponent − 16) for
 * 16-bit values. With no x array, x runs evenly from the first to the last value.
 *
 * Unit codes are named only where a real file confirms them: x 1 wavenumber (cm⁻¹), 3 nm,
 * 13 Raman shift (cm⁻¹); y 2 absorbance, 128 transmittance (in percent in the held file). Every other code is passed on as a number and the y kind is left to be guessed
 * from the values, as for a text file.
 */

const X_UNITS: Record<number, { unit: InstrumentXUnit; label: string }> = {
  1: { unit: 'wavenumber', label: 'wavenumber (cm⁻¹)' },
  3: { unit: 'nm', label: 'wavelength (nm)' },
  13: { unit: 'raman-shift', label: 'Raman shift (cm⁻¹)' },
};
const Y_UNITS: Record<number, { kind?: InstrumentYKind; label: string }> = {
  2: { kind: 'absorbance', label: 'absorbance' },
  128: { kind: 'transmittance', label: 'transmittance' },
};

const HEADER = 512;
const SUBHEADER = 32;

export const looksLikeGalacticSpc = (bytes: Uint8Array): boolean =>
  bytes.length >= HEADER && [0x4b, 0x4c, 0x4d].includes(bytes[1] as number);

export function parseGalacticSpc(bytes: Uint8Array): InstrumentResult {
  const version = bytes[1];
  if (version !== 0x4b) {
    return {
      ok: false,
      error: `This Galactic .spc file uses the ${version === 0x4d ? 'old (pre-1996)' : 'big-endian'} layout, which this site cannot read yet. In GRAMS or the instrument software, save it as a new-format .spc or export it as text.`,
    };
  }
  const view = dataView(bytes);
  const damaged = {
    ok: false as const,
    error: 'This Galactic .spc file is damaged or incomplete.',
  };
  const flags = bytes[0] as number;
  const exponent = view.getInt8(3);
  const points = view.getInt32(4, true);
  const first = view.getFloat64(8, true);
  const last = view.getFloat64(16, true);
  const multi = (flags & 0x04) !== 0;
  const subfiles = multi ? view.getInt32(24, true) : 1;
  if ((flags & 0x40) !== 0) {
    return {
      ok: false,
      error:
        'This .spc file holds several spectra, each with its own x values, which this site cannot read yet. Export each spectrum as text and load those files.',
    };
  }
  if (points < 2 || subfiles < 1) return damaged;

  let at = HEADER;
  let x: Float64Array;
  if ((flags & 0x80) !== 0) {
    if (at + 4 * points > bytes.length) return damaged;
    x = new Float64Array(points);
    for (let i = 0; i < points; i++) x[i] = view.getFloat32(at + 4 * i, true);
    at += 4 * points;
  } else {
    x = evenAxis(first, last, points);
  }

  const short = (flags & 0x01) !== 0;
  const spectra: { x: Float64Array; y: Float64Array }[] = [];
  for (let s = 0; s < subfiles; s++) {
    if (at + SUBHEADER > bytes.length) return damaged;
    // A file with several subfiles keeps each one's exponent in its subheader;
    // main exponent -128 (IEEE float32) or subexp 0 inherits the main exponent.
    const subExp = view.getInt8(at + 1);
    const e = multi && exponent !== -128 && subExp !== 0 ? subExp : exponent;
    at += SUBHEADER;
    const width = e === -128 ? 4 : short ? 2 : 4;
    if (at + width * points > bytes.length) return damaged;
    const y = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      const p = at + width * i;
      y[i] =
        e === -128
          ? view.getFloat32(p, true)
          : short
            ? view.getInt16(p, true) * 2 ** (e - 16)
            : view.getInt32(p, true) * 2 ** (e - 32);
    }
    at += width * points;
    spectra.push({ x, y });
  }

  const xCode = bytes[28] as number;
  const yCode = bytes[29] as number;
  const xUnit = X_UNITS[xCode];
  const yUnit = Y_UNITS[yCode];
  return {
    ok: true,
    file: {
      format: 'Galactic .spc',
      title: latin1(bytes, 88, 130),
      xUnit: xUnit?.unit ?? 'other',
      xLabel: xUnit?.label ?? `x unit code ${xCode}`,
      ...(yUnit?.kind && { yKind: yUnit.kind }),
      yLabel: yUnit?.label ?? `y unit code ${yCode}`,
      spectra,
      notes: [],
    },
  };
}
