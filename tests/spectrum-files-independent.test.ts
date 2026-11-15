// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readInstrumentFile } from '../src/core/spectrumFiles';

/*
 * The real binary files of tests/fixtures-real/spectra against independent readers
 * (SpectroChemPy, brukeropusreader, spc-io, specio), run by the Validation workflow
 * (scripts/validation/spectra/instrument_files.py). Every reading that succeeded is compared point
 * by point; a reader that failed is reported in docs/validation.md (19g), not here.
 *
 * Two allowances, both explained in docs/validation.md (19g):
 * - SpectroChemPy gives x to 3 decimals from a float32 axis, so its x is compared to 1e-3 cm⁻¹
 *   (half the last decimal plus one float32 step at 4000).
 * - SpectroChemPy scales every subfile of a multifile .spc by the main header's exponent, also
 *   the subfiles whose own exponent (−128) says they hold float32 values. For galactic_nir.spc
 *   that is subfiles 2 to 20; they are checked to be exactly that misreading of the same bytes.
 */

const file = new URL('./fixtures/validation/instrument-files-reference.json', import.meta.url);

interface Reading {
  x?: number[];
  y?: number[][];
  error?: string;
}

const reference = existsSync(file)
  ? (JSON.parse(readFileSync(file, 'utf8')) as {
      files: Record<string, { readings: Record<string, Reading> }>;
    })
  : { files: {} };

const readings = Object.entries(reference.files).flatMap(([name, entry]) =>
  Object.entries(entry.readings)
    .filter(([, r]) => r.x && r.y)
    .map(([reader, r]) => [name, reader, r] as const),
);

const X_TOLERANCE: Record<string, number> = { spectrochempy: 1e-3 };

/** SpectroChemPy's value for a float32 subfile: the same 4 bytes as an int32 · 2^(e − 32). */
function scaledAsInteger(value: number, exponent: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getInt32(0, true) * 2 ** (exponent - 32);
}

describe.runIf(readings.length > 0)('against independent readers', () => {
  it.each(readings)('%s read by %s: same points', (name, reader, r) => {
    const bytes = new Uint8Array(
      readFileSync(new URL(`./fixtures-real/spectra/${name}`, import.meta.url)),
    );
    const result = readInstrumentFile(bytes, name.slice(name.lastIndexOf('.') + 1));
    if (!result?.ok) throw new Error(result ? result.error : 'not recognised');
    const spectra = result.file.spectra;
    const theirs = r.y as number[][];
    expect(theirs.length).toBe(spectra.length);
    // Compare as (x, y) pairs sorted by x, so that a reader's choice of order does not matter.
    const sorted = (x: ArrayLike<number>, y: ArrayLike<number>) =>
      Array.from(x, (v, i) => [v, y[i] as number] as const).sort((a, b) => a[0] - b[0]);
    const xTolerance = X_TOLERANCE[reader] ?? 0;
    // Main header exponent (byte 3) and each subfile's own (byte 1 of its 32-byte header).
    const misread = reader === 'spectrochempy' && name === 'galactic_nir.spc';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    spectra.forEach((spectrum, s) => {
      const subfileExponent = view.getInt8(512 + s * (32 + 4 * spectrum.y.length) + 1);
      const expected = (y: number) =>
        misread && subfileExponent === -128 ? scaledAsInteger(y, view.getInt8(3)) : y;
      const mine = sorted(spectrum.x, spectrum.y);
      const other = sorted(r.x as number[], theirs[s] as number[]);
      expect(other.length).toBe(mine.length);
      mine.forEach(([x, y], i) => {
        const [ox, oy] = other[i] as readonly [number, number];
        expect(Math.abs(x - ox)).toBeLessThanOrEqual(
          Math.max(xTolerance, 1e-6 * Math.max(1, Math.abs(x))),
        );
        const e = expected(y);
        expect(Math.abs(e - oy)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(e)));
      });
    });
  });
});
