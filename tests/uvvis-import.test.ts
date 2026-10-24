import { describe, expect, it } from 'vitest';
import { importSpectraFile, importSpectraText } from '../src/core/uvvis/import';
import { checkKind, kindFromText, suggestKind } from '../src/core/uvvis/kind';

const firstOf = <T>(items: readonly T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('expected at least one item');
  return item;
};

const wavelengths = Array.from({ length: 20 }, (_, i) => 300 + i * 2);

function table(rows: (string | number)[][], separator = ','): string {
  return rows.map((row) => row.join(separator)).join('\n');
}

describe('importSpectraText', () => {
  it('reads wavelength and one absorbance column with a header', () => {
    const text = table([
      ['Wavelength (nm)', 'Abs'],
      ...wavelengths.map((w, i) => [w, 0.1 + i * 0.01]),
    ]);
    const result = importSpectraText('sample.csv', text, 'csv');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spectra).toHaveLength(1);
    const s = firstOf(result.spectra);
    expect(s.name).toBe('sample');
    expect(s.wavelengthNm).toHaveLength(20);
    expect(s.kind).toBe('absorbance');
    expect(s.kindOrigin).toBe('header');
    expect(s.values[3]).toBeCloseTo(0.13, 12);
    expect(s.notes.some((n) => n.text.includes('header line'))).toBe(true);
  });

  it('makes one spectrum per column and names them from the header', () => {
    const text = table([
      ['nm', 'A', 'B'],
      ...wavelengths.map((w, i) => [w, 0.1 + i * 0.01, 0.5 - i * 0.01]),
    ]);
    const result = importSpectraText('two.csv', text, 'csv');
    expect(result.ok && result.spectra.map((s) => s.name)).toEqual(['two – A', 'two – B']);
  });

  it('reads tab separation and decimal commas', () => {
    const text = table(
      wavelengths.map((w, i) => [String(w).replace('.', ','), `0,${10 + i}`]),
      '\t',
    );
    const result = importSpectraText('eu.txt', text, 'text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(firstOf(result.spectra).values[0]).toBeCloseTo(0.1, 12);
    expect(firstOf(result.spectra).notes.some((n) => n.text.includes('decimal comma'))).toBe(true);
  });

  it('reverses a scan recorded from long to short wavelength', () => {
    const rows = wavelengths.map((w, i) => [w, i + 1]).reverse();
    const result = importSpectraText('down.txt', table(rows), 'text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = firstOf(result.spectra);
    expect(s.wavelengthNm[0]).toBe(300);
    expect(s.values[0]).toBe(1);
    expect(s.notes.some((n) => n.text.includes('reversed'))).toBe(true);
  });

  it('takes the data type from a %T heading', () => {
    const text = table([['Wavelength', '%T'], ...wavelengths.map((w, i) => [w, 50 + i])]);
    const result = importSpectraText('t.csv', text, 'csv');
    expect(result.ok && firstOf(result.spectra).kind).toBe('transmittance');
    expect(result.ok && firstOf(result.spectra).scale).toBe('percent');
  });

  it('refuses wavelengths that are not in nm, repeated wavelengths and constant columns', () => {
    const ev = table(wavelengths.map((_, i) => [1.5 + i * 0.1, i + 1]));
    const evResult = importSpectraText('ev.csv', ev, 'csv');
    expect(!evResult.ok && evResult.error).toContain('nanometres');

    const repeated = table([
      ...wavelengths.map((w, i) => [w, i + 1]),
      [wavelengths[19] as number, 5],
    ]);
    const repeatedResult = importSpectraText('r.csv', repeated, 'csv');
    expect(!repeatedResult.ok && repeatedResult.error).toContain('twice');

    const flat = table(wavelengths.map((w) => [w, 0.3]));
    const flatResult = importSpectraText('f.csv', flat, 'csv');
    expect(!flatResult.ok && flatResult.error).toContain('constant');
  });

  it('refuses empty, text-only, too short and binary input with a plain message', () => {
    expect(importSpectraText('a.txt', '  ').ok).toBe(false);
    expect(importSpectraText('a.txt', 'hello world').ok).toBe(false);
    const short = importSpectraText(
      'a.txt',
      table([
        [300, 1],
        [301, 2],
        [302, 3],
      ]),
    );
    expect(!short.ok && short.error).toContain('3 data points');
    const zip = importSpectraFile('book.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]));
    expect(!zip.ok && zip.error).toContain('binary');
    expect(importSpectraFile('a.csv', new Uint8Array(0)).ok).toBe(false);
  });

  it('warns about skipped lines such as an instrument footer', () => {
    const text = [
      'Wavelength (nm),Abs',
      ...wavelengths.map((w, i) => `${w},${0.1 + i * 0.01}`),
      'Scan finished, 2 samples',
    ].join('\n');
    const result = importSpectraText('cary.csv', text, 'csv');
    expect(
      result.ok &&
        firstOf(result.spectra)
          .notes.map((n) => n.text)
          .join(' '),
    ).toContain('skipped');
  });
});

describe('data type suggestion', () => {
  it('reads words in the heading', () => {
    expect(kindFromText('%T')?.kind).toBe('transmittance');
    expect(kindFromText('Transmittance')?.kind).toBe('transmittance');
    expect(kindFromText('%R')?.kind).toBe('reflectance');
    expect(kindFromText('Diffuse reflectance')?.kind).toBe('reflectance');
    expect(kindFromText('Abs')?.kind).toBe('absorbance');
    expect(kindFromText('Sample 1')).toBeUndefined();
  });

  it('guesses from the value range when there is no heading', () => {
    expect(suggestKind([0.1, 0.5, 1.8]).kind).toBe('absorbance');
    const percent = suggestKind([12, 55, 97]);
    expect(percent.kind).toBe('transmittance');
    expect(percent.scale).toBe('percent');
    expect(percent.origin).toBe('guess');
    expect(suggestKind([0.2, 0.4, 0.9]).reason).toContain('between 0 and 1');
  });
});

describe('checkKind', () => {
  it('flags a scale that does not fit the values', () => {
    expect(checkKind([0.2, 0.9], 'transmittance', 'percent')[0]?.text).toContain('Fraction');
    expect(checkKind([20, 90], 'reflectance', 'fraction')[0]?.text).toContain('Percent');
    expect(
      checkKind([20, 130], 'transmittance', 'percent').some((m) => m.text.includes('above 100')),
    ).toBe(true);
  });

  it('flags negative and very high absorbance and zero transmittance', () => {
    expect(checkKind([-0.5, 1], 'absorbance', 'percent')[0]?.text).toContain('below zero');
    expect(checkKind([1, 4.8], 'absorbance', 'percent')[0]?.text).toContain('unreliable');
    expect(checkKind([0, 50], 'transmittance', 'percent')[0]?.text).toContain('zero or negative');
    expect(checkKind([0.1, 2], 'absorbance', 'percent')).toEqual([]);
  });
});
