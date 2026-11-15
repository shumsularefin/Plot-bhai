// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { readInstrumentFile } from '../src/core/spectrumFiles';

/*
 * The real binary files of tests/fixtures-real/spectra against independent readers
 * (SpectroChemPy, brukeropusreader, spc-io, specio), run by the Validation workflow
 * (scripts/validation/spectra/instrument_files.py). Every reading that succeeded is compared point
 * by point; a reader that failed is reported in docs/validation.md (19g), not here.
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

describe.runIf(readings.length > 0)('against independent readers', () => {
  it.each(readings)('%s read by %s: same points', (name, _reader, r) => {
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
    spectra.forEach((spectrum, s) => {
      const mine = sorted(spectrum.x, spectrum.y);
      const other = sorted(r.x as number[], theirs[s] as number[]);
      expect(other.length).toBe(mine.length);
      mine.forEach(([x, y], i) => {
        const [ox, oy] = other[i] as readonly [number, number];
        expect(Math.abs(x - ox)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(x)));
        expect(Math.abs(y - oy)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(y)));
      });
    });
  });
});
