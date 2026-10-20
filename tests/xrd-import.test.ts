// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFile, importText } from '../src/core/xrd/import';
import type { ImportResult } from '../src/core/xrd/types';

// Every good fixture holds the same synthetic curve (see tests/fixtures/xrd/README.md):
// 251 points from 20.00° to 25.00° in 0.02° steps, maximum 1100 at 22.50°, 100 at both ends.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/xrd/${name}`, import.meta.url)));
const load = (name: string) => importFile(name, fixture(name));

function expectPattern(result: ImportResult) {
  if (!result.ok) throw new Error(`Expected success, got: ${result.error}`);
  return result.pattern;
}
function expectError(result: ImportResult): string {
  if (result.ok) throw new Error('Expected an error');
  return result.error;
}

function expectStandardCurve(result: ImportResult, scale = 1) {
  const p = expectPattern(result);
  expect(p.twoTheta.length).toBe(251);
  expect(p.twoTheta[0]).toBeCloseTo(20, 9);
  expect(p.twoTheta[250]).toBeCloseTo(25, 9);
  expect(p.twoTheta[125]).toBeCloseTo(22.5, 9);
  expect(p.intensity[125]).toBeCloseTo(1100 * scale, 6);
  expect(p.intensity[0]).toBeCloseTo(100 * scale, 6);
  return p;
}

describe('text formats', () => {
  it('reads .xy with comment lines', () => {
    const p = expectStandardCurve(load('basic.xy'));
    expect(p.source).toBe('xy');
    expect(p.name).toBe('basic');
    expect(p.intensityUnit).toBe('counts');
    expect(p.unitOrigin).toBe('guess');
    expect(p.sigma).toBeUndefined();
  });

  it('reads the third .xye column as the uncertainty', () => {
    const p = expectStandardCurve(load('with-sigma.xye'));
    expect(p.sigma?.[125]).toBeCloseTo(Math.sqrt(1100), 3);
  });

  it('reads comma-separated values with a header row and CRLF line endings', () => {
    const p = expectStandardCurve(load('header-row.csv'));
    expect(p.notes.map((n) => n.text)).toContain('1 header line at the top was skipped.');
  });

  it('reads semicolons with decimal commas and takes cps from the header', () => {
    const p = expectStandardCurve(load('decimal-comma.csv'), 0.5);
    expect(p.intensityUnit).toBe('cps');
    expect(p.unitOrigin).toBe('file');
    expect(p.notes.some((n) => n.text.includes('decimal comma'))).toBe(true);
  });

  it('reads tab-separated .txt after several header lines and takes counts from the header', () => {
    const p = expectStandardCurve(load('tab-separated.txt'));
    expect(p.source).toBe('text');
    expect(p.intensityUnit).toBe('counts');
    expect(p.unitOrigin).toBe('file');
    expect(p.notes[0]?.text).toBe('4 header lines at the top were skipped.');
  });

  it('uses the first two columns of a .dat file with more columns', () => {
    const p = expectStandardCurve(load('four-columns.dat'));
    expect(p.notes.some((n) => n.text.includes('2 extra columns were ignored'))).toBe(true);
  });

  it('reverses a scan recorded from high to low 2θ', () => {
    const p = expectStandardCurve(load('decreasing.xy'));
    expect(p.notes.some((n) => n.text.includes('reversed'))).toBe(true);
  });

  it('reads pasted text', () => {
    const text = new TextDecoder().decode(fixture('basic.xy'));
    const p = expectStandardCurve(importText('Pasted data', text));
    expect(p.source).toBe('pasted');
    expect(p.name).toBe('Pasted data');
  });

  it('reads UTF-16 text with a byte-order mark', () => {
    const text = '﻿' + new TextDecoder().decode(fixture('basic.xy'));
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[2 * i] = text.charCodeAt(i) & 0xff;
      bytes[2 * i + 1] = text.charCodeAt(i) >> 8;
    }
    expectStandardCurve(importFile('utf16.txt', bytes));
  });
});

describe('XRDML', () => {
  it('reads start and end positions, counting time and wavelength', () => {
    const p = expectStandardCurve(load('start-end.xrdml'));
    expect(p.source).toBe('xrdml');
    expect(p.intensityUnit).toBe('counts');
    expect(p.unitOrigin).toBe('file');
    expect(p.countingTimeS).toBe(0.5);
    expect(p.wavelengthFromFileA).toBe(1.5406);
  });

  it('reads listPositions and applies attenuation factors to raw counts', () => {
    const p = expectStandardCurve(load('list-counts.xrdml'));
    expect(p.notes.map((n) => n.text)).toEqual([
      'This file contains 2 scans. Only scan 1 was loaded.',
      'Beam attenuation factors from the file were applied.',
    ]);
  });

  it('refuses a rocking curve with 2θ held fixed', () => {
    expect(expectError(load('rocking-curve.xrdml'))).toContain('not a 2θ scan');
  });

  it('detects XRDML content regardless of the file name', () => {
    expect(expectPattern(importFile('export.txt', fixture('start-end.xrdml'))).source).toBe(
      'xrdml',
    );
  });

  it('explains when an .xrdml file holds something else', () => {
    expect(expectError(importFile('broken.xrdml', fixture('basic.xy')))).toContain(
      'does not contain XRDML data',
    );
  });
});

describe('Rigaku RAS', () => {
  it('reads a single scan', () => {
    const p = expectStandardCurve(load('single.ras'));
    expect(p.source).toBe('ras');
    expect(p.notes).toEqual([]);
  });

  it('loads the first of several scans and warns about attenuator factors', () => {
    const p = expectStandardCurve(load('two-scans.ras'));
    const texts = p.notes.map((n) => n.text).join('\n');
    expect(texts).toContain('This file contains 2 scans. Only the first was loaded.');
    expect(texts).toContain('attenuator factor');
  });
});

describe('friendly errors', () => {
  it.each([
    ['goes-backwards.xy', '2θ goes backwards at point 151 (from 22.98° to 21°)'],
    ['one-column.txt', 'Only one column of numbers'],
    ['point-number.csv', 'cannot be above 180°'],
    ['too-few.xy', 'Only 3 data points were found'],
    ['constant.xy', 'Every intensity value is 50'],
  ])('%s', (name, message) => {
    expect(expectError(load(name))).toContain(message);
  });

  it('says a binary .raw file cannot be read and how to export instead', () => {
    const bytes = new Uint8Array([0x52, 0x41, 0x57, 0x31, 0, 0, 0, 3, 1, 2, 0, 0]);
    const error = expectError(importFile('scan.raw', bytes));
    expect(error).toContain('binary files');
    expect(error).toContain('export the scan as .xy or .csv');
  });

  it('recognises a .brml (zip) file', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
    expect(expectError(importFile('scan.brml', bytes))).toContain('Bruker .brml');
  });

  it('reads a .raw file that is actually text', () => {
    expectStandardCurve(importFile('scan.raw', fixture('basic.xy')));
  });

  it('refuses empty input', () => {
    expect(expectError(importFile('empty.xy', new Uint8Array()))).toBe('This file is empty.');
    expect(expectError(importText('Pasted', '  \n'))).toBe('There is no data to read.');
  });

  it('explains text with no numbers', () => {
    expect(expectError(importText('Pasted', 'hello\nworld'))).toContain('No rows of numbers');
  });
});

describe('large files', () => {
  it('imports 50,000 points', () => {
    const lines = Array.from(
      { length: 50_000 },
      (_, i) => `${(5 + i * 0.0015).toFixed(4)} ${1000 + (i % 97)}`,
    );
    const p = expectPattern(importText('big.xy', lines.join('\n'), 'xy'));
    expect(p.twoTheta.length).toBe(50_000);
  });
});
