// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importFtirFile } from '../src/core/ftir/import';
import { readInstrumentFile } from '../src/core/spectrumFiles';
import type { InstrumentFile } from '../src/core/spectrumFiles';
import { parseBrukerOpus } from '../src/core/spectrumFiles/brukerOpus';
import { parseGalacticSpc } from '../src/core/spectrumFiles/galacticSpc';
import { parsePerkinElmerSp } from '../src/core/spectrumFiles/perkinElmerSp';
import { importSpectraFile } from '../src/core/uvvis/import';

/*
 * The binary readers of src/core/spectrumFiles on the real files of tests/fixtures-real/spectra
 * (provenance and licences in its README), checked three ways (docs/validation.md, 19g):
 *   1. synthetic files written here with known values;
 *   2. the instrument's own text export (OPUS .dpt), the text an independent reader wrote for the
 *      same file (tests/real-references/spectra, rohanisaac/spc), and values published in the
 *      tests of Orange-spectroscopy for the same files;
 *   3. invariants stored in the files themselves (OPUS MXY and MNY, PerkinElmer ordinate range).
 */

const real = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures-real/spectra/${name}`, import.meta.url)));
const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'latin1');
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function read(name: string): InstrumentFile {
  const result = readInstrumentFile(real(name), extension(name));
  if (!result?.ok) throw new Error(result ? result.error : `${name} not recognised`);
  return result.file;
}

/** Whitespace-separated numeric rows of a text file. */
const table = (source: string) =>
  source
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length >= 2 && row.every(Number.isFinite));

const range = (y: Float64Array) => [Math.min(...y), Math.max(...y)];

describe('Galactic .spc against the text written by rohanisaac/spc', () => {
  it.each([
    ['galactic_Ft-ir.spc', 1776, 1, 'wavenumber', 'transmittance'],
    ['galactic_s_evenx.spc', 1844, 1, 'wavenumber', 'absorbance'],
    ['galactic_nir.spc', 700, 20, 'nm', undefined],
  ] as const)('%s: every point of every subfile', (name, points, subfiles, xUnit, yKind) => {
    const file = read(name);
    expect(file.xUnit).toBe(xUnit);
    expect(file.yKind).toBe(yKind);
    expect(file.spectra.length).toBe(subfiles);
    const rows = table(text(`./real-references/spectra/${name}.txt`));
    expect(rows.length).toBe(points);
    file.spectra.forEach((spectrum, s) => {
      expect(spectrum.x.length).toBe(points);
      rows.forEach((row, i) => {
        // The text has 12 significant digits.
        expect(spectrum.x[i]).toBeCloseTo(row[0] as number, 6);
        const expected = row[s + 1] as number;
        expect(Math.abs((spectrum.y[i] as number) - expected)).toBeLessThanOrEqual(
          1e-10 * Math.max(1, Math.abs(expected)),
        );
      });
    });
  });
});

describe('Bruker OPUS against the .dpt text that OPUS exported for the same measurement', () => {
  const file = read('opus_peach_juice.0');
  const spectrum = file.spectra[0] as InstrumentFile['spectra'][number];
  const rows = table(text('./fixtures-real/spectra/opus_peach_juice.dpt'));

  it('matches every point to the 5 decimals the export prints', () => {
    expect(spectrum.x.length).toBe(1816);
    expect(rows.length).toBe(1816);
    // Half a unit in the 5th decimal, plus float32 rounding.
    rows.forEach(([x, y], i) => {
      expect(Math.abs((spectrum.x[i] as number) - (x as number))).toBeLessThanOrEqual(5.001e-6);
      expect(Math.abs((spectrum.y[i] as number) - (y as number))).toBeLessThanOrEqual(5.001e-6);
    });
    expect(file.yKind).toBe('reflectance');
    expect(file.title).toBe('Peach juice colorful spot');
    expect(file.notes).toEqual([]);
  });

  it('gives point 4 the values Orange-spectroscopy’s test publishes for this file', () => {
    expect(spectrum.x[3]).toBeCloseTo(3994.330014648437, 9);
    expect(spectrum.y[3]).toBeCloseTo(0.90655535, 8);
  });

  it('the file’s earlier final-spectrum block decodes to its stored maximum and minimum (MXY, MNY)', () => {
    // The file holds two type-15 blocks; the reader takes the last (the one OPUS exported). The
    // stored MXY and MNY belong to the first, so the float32 layout is checked on that one.
    const bytes = real('opus_peach_juice.0');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directory = view.getInt32(12, true);
    let offset = -1;
    for (let i = 0; i < view.getInt32(20, true) && offset < 0; i++) {
      if (bytes[directory + 12 * i] === 15) offset = view.getInt32(directory + 12 * i + 8, true);
    }
    const y = Float64Array.from({ length: 1816 }, (_, k) => view.getFloat32(offset + 4 * k, true));
    expect(range(y)).toEqual([0.6175133585929871, 0.9232791066169739]);
  });
});

describe('Thermo OMNIC .spa', () => {
  it('reads the 1738 points that Orange-spectroscopy’s test publishes, as absorbance', () => {
    const file = read('omnic_sample1.spa');
    const spectrum = file.spectra[0] as InstrumentFile['spectra'][number];
    expect(spectrum.y.length).toBe(1738);
    expect(spectrum.x[0]).toBeCloseTo(3999.703125, 6);
    expect(spectrum.x[1737]).toBeCloseTo(649.903564453125, 6);
    expect(file.yKind).toBe('absorbance');
  });
});

describe('PerkinElmer .sp', () => {
  it('reads the value and range Orange-spectroscopy’s test publishes for its file', () => {
    const file = read('perkinelmer_transmittance.sp');
    const spectrum = file.spectra[0] as InstrumentFile['spectra'][number];
    expect(spectrum.y[4]).toBe(100.65028381347656);
    expect(range(spectrum.x)).toEqual([750, 4000]);
    expect(file.yKind).toBe('transmittance');
    expect(file.yScale).toBe('percent');
  });

  it.each([
    ['perkinelmer_transmittance.sp', 81.4703369140625, 101.32456970214844],
    ['perkinelmer_absorbance.sp', -0.04419460626717189, 0.3590741897475417],
  ])('%s: y matches the ordinate range stored in the file', (name, low, high) => {
    const spectrum = read(name).spectra[0] as InstrumentFile['spectra'][number];
    expect(range(spectrum.y)).toEqual([low, high]);
  });
});

/** A new-format Galactic header (512 bytes) with the given fields. */
function spcHeader(flags: number, exponent: number, points: number, first: number, last: number) {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  bytes[0] = flags;
  bytes[1] = 0x4b;
  view.setInt8(3, exponent);
  view.setInt32(4, points, true);
  view.setFloat64(8, first, true);
  view.setFloat64(16, last, true);
  view.setInt32(24, 1, true);
  bytes[28] = 1;
  bytes[29] = 2;
  return bytes;
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('synthetic files with known values', () => {
  it('decodes 32-bit integer y as integer · 2^(exponent − 32) on an even axis', () => {
    const integers = new Int32Array([0, 1 << 24, -(1 << 25), 3 << 24]);
    const bytes = join(
      spcHeader(0, 10, 4, 400, 4000),
      new Uint8Array(32),
      new Uint8Array(integers.buffer),
    );
    const result = parseGalacticSpc(bytes);
    if (!result.ok) throw new Error(result.error);
    const spectrum = result.file.spectra[0] as InstrumentFile['spectra'][number];
    expect(Array.from(spectrum.x)).toEqual([400, 1600, 2800, 4000]);
    expect(Array.from(spectrum.y)).toEqual([0, 4, -8, 12]);
  });

  it('decodes 16-bit integer y as integer · 2^(exponent − 16)', () => {
    const integers = new Int16Array([256, -512, 1024]);
    const bytes = join(
      spcHeader(0x01, 8, 3, 1, 3),
      new Uint8Array(32),
      new Uint8Array(integers.buffer),
    );
    const result = parseGalacticSpc(bytes);
    if (!result.ok) throw new Error(result.error);
    expect(Array.from(result.file.spectra[0]?.y ?? [])).toEqual([
      256 / 256,
      -512 / 256,
      1024 / 256,
    ]);
  });

  it('refuses the old layout, XYXY files and a truncated file in plain words', () => {
    const old = spcHeader(0, -128, 4, 1, 4);
    old[1] = 0x4d;
    expect(parseGalacticSpc(old)).toMatchObject({
      ok: false,
      error: expect.stringContaining('old'),
    });
    expect(parseGalacticSpc(spcHeader(0x44, -128, 4, 1, 4))).toMatchObject({
      ok: false,
      error: expect.stringContaining('own x values'),
    });
    expect(parseGalacticSpc(spcHeader(0, -128, 400, 1, 4))).toMatchObject({
      ok: false,
      error: expect.stringContaining('damaged'),
    });
  });

  it('round trip: a real OPUS file without its final-spectrum block is refused, not guessed', () => {
    const bytes = real('opus_peach_juice.0').slice();
    const view = new DataView(bytes.buffer);
    const directory = view.getInt32(12, true);
    for (let i = 0; i < view.getInt32(20, true); i++) {
      if (bytes[directory + 12 * i] === 15) bytes[directory + 12 * i] = 7;
    }
    expect(parseBrukerOpus(bytes)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no final spectrum'),
    });
  });

  it('a PerkinElmer file whose range disagrees with its interval is refused as damaged', () => {
    const bytes = real('perkinelmer_absorbance.sp').slice();
    const view = new DataView(bytes.buffer);
    // Find the interval member (id −29836) and double the step.
    for (let at = 50; at + 6 < bytes.length;) {
      const id = view.getInt16(at, true);
      const size = view.getInt32(at + 2, true);
      if (id === -29836) view.setFloat64(at + 8, 2 * view.getFloat64(at + 8, true), true);
      at += 6 + size;
    }
    expect(parsePerkinElmerSp(bytes)).toMatchObject({ ok: false });
  });
});

describe('the FTIR and UV-Vis tools load the files they can use and send the others on', () => {
  it('FTIR: every infrared file loads, increasing in wavenumber, with the stated kind', () => {
    const cases = [
      ['omnic_sample1.spa', 'absorbance'],
      ['opus_peach_juice.0', 'reflectance'],
      ['perkinelmer_transmittance.sp', 'transmittance'],
      ['perkinelmer_absorbance.sp', 'absorbance'],
      ['galactic_Ft-ir.spc', 'transmittance'],
      ['galactic_s_evenx.spc', 'absorbance'],
    ] as const;
    for (const [name, kind] of cases) {
      const result = importFtirFile(name, real(name));
      if (!result.ok) throw new Error(`${name}: ${result.error}`);
      const spectrum = result.spectra[0] as (typeof result.spectra)[number];
      expect(spectrum.source).toBe('instrument');
      expect(spectrum.kind).toBe(kind);
      expect(spectrum.kindOrigin).toBe('header');
      expect((spectrum.wavenumber[1] as number) > (spectrum.wavenumber[0] as number)).toBe(true);
    }
  });

  it('FTIR sends a wavelength file to the UV-Vis tool; UV-Vis sends an infrared file back', () => {
    const nir = importFtirFile('galactic_nir.spc', real('galactic_nir.spc'));
    expect(!nir.ok && nir.error).toContain('UV-Vis tool');
    const ir = importSpectraFile('galactic_Ft-ir.spc', real('galactic_Ft-ir.spc'));
    expect(!ir.ok && ir.error).toContain('FTIR tool');
  });

  it('UV-Vis loads the 20 near-infrared spectra of one Galactic file', () => {
    const result = importSpectraFile('galactic_nir.spc', real('galactic_nir.spc'));
    if (!result.ok) throw new Error(result.error);
    expect(result.spectra.length).toBe(20);
    expect(result.spectra[0]?.wavelengthNm[0]).toBe(1100);
    expect(result.spectra[0]?.source).toBe('instrument');
  });
});
