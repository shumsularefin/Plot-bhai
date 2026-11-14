import { describe, expect, it } from 'vitest';
import { importSpectraText } from '../src/core/uvvis/import';
import { kindFromText, suggestKind } from '../src/core/uvvis/kind';

// Audit 2026-11-14, bug 2: a heading word names the data type only; the scale comes from a
// percent sign in the heading or, without one, from the range of the values.

const wavelengths = Array.from({ length: 30 }, (_, i) => 300 + i * 10);

function file(heading: string, values: (i: number) => number): string {
  return [`Wavelength (nm),${heading}`, ...wavelengths.map((w, i) => `${w},${values(i)}`)].join(
    '\n',
  );
}

function imported(heading: string, values: (i: number) => number) {
  const result = importSpectraText('s.csv', file(heading, values), 'csv');
  if (!result.ok) throw new Error(result.error);
  const spectrum = result.spectra[0];
  if (!spectrum) throw new Error('no spectrum');
  return spectrum;
}

const fraction = (i: number) => 0.1 + (0.7 * i) / 29;
const percent = (i: number) => 10 + (70 * i) / 29;

describe('kind and scale from the heading (bug 2)', () => {
  it('a word alone names the kind but not the scale', () => {
    expect(kindFromText('Reflectance')).toEqual({ kind: 'reflectance' });
    expect(kindFromText('Transmittance')).toEqual({ kind: 'transmittance' });
  });

  it('a percent sign names the scale too', () => {
    for (const text of ['%R', 'R (%)', 'R%', 'Reflectance (%)', 'Reflectance [%]']) {
      expect(kindFromText(text)).toEqual({ kind: 'reflectance', scale: 'percent' });
    }
    for (const text of ['%T', 'T (%)', 'T%', 'Transmittance (%)', 'Transmittance %']) {
      expect(kindFromText(text)).toEqual({ kind: 'transmittance', scale: 'percent' });
    }
  });

  it('reflectance heading with fraction values is read as a fraction', () => {
    const s = imported('Reflectance', fraction);
    expect(s.kind).toBe('reflectance');
    expect(s.scale).toBe('fraction');
    expect(s.kindOrigin).toBe('header');
  });

  it('reflectance heading with percent values is read as percent', () => {
    const s = imported('Reflectance', percent);
    expect(s.kind).toBe('reflectance');
    expect(s.scale).toBe('percent');
  });

  it('a %R heading is percent', () => {
    const s = imported('%R', percent);
    expect(s.kind).toBe('reflectance');
    expect(s.scale).toBe('percent');
  });

  it('the transmittance equivalents', () => {
    expect(imported('Transmittance', fraction).scale).toBe('fraction');
    expect(imported('Transmittance', percent).scale).toBe('percent');
    const t = imported('%T', percent);
    expect(t.kind).toBe('transmittance');
    expect(t.scale).toBe('percent');
  });

  it('a stated percent wins over the value range', () => {
    // %R heading with values below 1.5 (a very dark sample): the heading decides.
    expect(suggestKind([0.2, 0.8, 1.2], '%R').scale).toBe('percent');
  });
});
