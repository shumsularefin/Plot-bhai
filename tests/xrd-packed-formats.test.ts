// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32, listZip, readZipEntry } from '../src/core/text/unzip';
import { importFile, importFileAsync } from '../src/core/xrd/import';
import type { ImportResult } from '../src/core/xrd/types';

/*
 * Real instrument files (tests/fixtures-real, provenance in its README) read by this site's
 * readers and compared, point by point, with two independent extractions: geddes's reference
 * CSVs (built by its own Python script) and tests/real-references/make_references.py.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures-real/${name}`, import.meta.url)));
const reference = (name: string) =>
  readFileSync(new URL(`./real-references/${name}`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map(Number) as [number, number]);

function pattern(result: ImportResult) {
  if (!result.ok) throw new Error(result.error);
  return result.pattern;
}

const FILES = [
  { file: 'rigaku_powder.rasx', source: 'rasx', points: 2726, wavelength: 1.540593, geddes: true },
  {
    file: 'rigaku_zno_counts.rasx',
    source: 'rasx',
    points: 7001,
    wavelength: 1.540593,
    geddes: true,
  },
  { file: 'bruker_absorber.brml', source: 'brml', points: 2001, wavelength: 1.5406, geddes: true },
  {
    file: 'bruker_locked_coupled.brml',
    source: 'brml',
    points: 2443,
    wavelength: 1.5406,
    geddes: false,
  },
  {
    file: 'bruker4_v5converter.raw',
    source: 'raw',
    points: 4059,
    wavelength: 1.5406,
    geddes: true,
  },
  {
    file: 'bruker4_diffrac_eva.raw',
    source: 'raw',
    points: 7134,
    wavelength: 1.5406,
    geddes: true,
  },
] as const;

describe('packed and binary instrument formats against independent readers', () => {
  it.each(FILES)('$file matches the reference values point by point', async (f) => {
    const p = pattern(await importFileAsync(f.file, fixture(f.file)));
    expect(p.source).toBe(f.source);
    expect(p.twoTheta.length).toBe(f.points);
    expect(p.wavelengthFromFileA).toBe(f.wavelength);
    const stem = f.file.replace(/\.[^.]+$/, '');
    const references = [reference(`${stem}.csv`)];
    if (f.geddes) references.push(reference(`${stem}.geddes.csv`));
    for (const ref of references) {
      expect(ref.length).toBe(f.points);
      let dx = 0;
      let dy = 0;
      ref.forEach(([x, y], i) => {
        dx = Math.max(dx, Math.abs((p.twoTheta[i] as number) - x));
        dy = Math.max(dy, Math.abs((p.intensity[i] as number) - y) / Math.max(1, Math.abs(y)));
      });
      expect(dx).toBeLessThan(1e-9);
      expect(dy).toBeLessThan(1e-9);
    }
  });

  it('keeps the angle step stated in the file header (invariance check)', async () => {
    const zno = pattern(await importFileAsync('z.rasx', fixture('rigaku_zno_counts.rasx')));
    expect(zno.twoTheta[0]).toBe(20);
    expect(zno.twoTheta[zno.twoTheta.length - 1]).toBe(90);
    const raw = pattern(importFile('v5.raw', fixture('bruker4_v5converter.raw')));
    // 4059 points from 37.0001° with the stored step.
    expect(Number(raw.twoTheta[1]) - Number(raw.twoTheta[0])).toBeCloseTo(0.02045454498, 10);
  });

  it('states where the absorber was in and keeps the corrected intensities', async () => {
    const p = pattern(await importFileAsync('a.brml', fixture('bruker_absorber.brml')));
    expect(p.notes.map((n) => n.text).join(' ')).toContain('already include its factor');
    // The strongest point was measured with the absorber (factor 8.3): 495559.8 / 8.3 = 59706.
    const max = Math.max(...p.intensity);
    expect(max).toBe(495559.8);
    expect(Number.isInteger(Math.round((max / 8.3) * 1e6) / 1e6)).toBe(true);
  });

  it('reads the scan settings from the file into the record', async () => {
    const p = pattern(await importFileAsync('p.rasx', fixture('rigaku_powder.rasx')));
    const meta = Object.fromEntries((p.metadata ?? []).map((m) => [m.key, m.value]));
    expect(meta['Step (°)']).toBe('0.0400');
    expect(meta['Speed']).toBe('1.0000 deg/min');
    expect(meta['Target']).toBe('Cu');
  });

  it('refuses older Bruker .raw versions instead of guessing their layout', () => {
    const bytes = new TextEncoder().encode('RAW1.01\0\0\0\0\0\0\0\0\0');
    const result = importFile('old.raw', bytes);
    expect(result.ok ? '' : result.error).toContain('version 3');
  });

  it('reports a truncated Bruker .raw file as damaged', () => {
    const result = importFile('cut.raw', fixture('bruker4_v5converter.raw').slice(0, 2000));
    expect(result.ok ? '' : result.error).toContain('damaged or incomplete');
  });
});

describe('ZIP reader', () => {
  it('computes the standard CRC-32 check value', () => {
    // The check value of CRC-32/ISO-HDLC for the ASCII string "123456789".
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('lists the entries of a real .rasx archive', () => {
    expect(listZip(fixture('rigaku_powder.rasx')).map((e) => e.name)).toEqual([
      'Data0/Profile0.txt',
      'Data0/MesurementConditions0.xml',
      'root.xml',
    ]);
  });

  it('reads a stored (uncompressed) entry, round trip', async () => {
    const zip = storedZip('a.txt', new TextEncoder().encode('2θ 10 20'));
    const [entry] = listZip(zip);
    if (!entry) throw new Error('no entry');
    expect(new TextDecoder().decode(await readZipEntry(zip, entry))).toBe('2θ 10 20');
  });

  it('reports a damaged archive instead of reading wrong numbers', async () => {
    const bytes = fixture('rigaku_powder.rasx').slice();
    const entry = listZip(bytes)[0];
    if (!entry) throw new Error('no entry');
    const at = entry.localOffset + 30 + entry.name.length + 200;
    bytes[at] = Number(bytes[at]) ^ 0xff;
    const result = await importFileAsync('broken.rasx', bytes);
    expect(result.ok ? '' : result.error).toContain('damaged');
  });

  it('says a ZIP file that is not an instrument scan cannot be read', async () => {
    const result = await importFileAsync('notes.zip', storedZip('notes.txt', new Uint8Array([65])));
    expect(result.ok ? '' : result.error).toContain('not a Bruker .brml or Rigaku .rasx');
  });
});

/** A one-entry ZIP with the entry stored, laid out as in APPNOTE.TXT 4.3.7, 4.3.12, 4.3.16. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(end, local.length + data.length + central.length);
  return out;
}
