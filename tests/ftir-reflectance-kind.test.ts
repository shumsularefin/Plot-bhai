import { describe, expect, it } from 'vitest';
import { importFtirText } from '../src/core/ftir/import';
import { ftirStatesReflectance } from '../src/core/ftir/kind';

// Audit 2026-11-14, bug 4: a file that states reflectance must not be taken silently as
// transmittance. Until the reflectance data type exists (19d) the values are treated as
// transmittance with a plain warning on the spectrum.

const n = 200;
const wavenumber = Array.from({ length: n }, (_, i) => 4000 - i * 15);
const percent = (i: number) => 40 + 30 * Math.sin(i / 20);

function csv(heading: string): string {
  return [`Wavenumber,${heading}`, ...wavenumber.map((w, i) => `${w},${percent(i)}`)].join('\n');
}

function jcamp(yUnits: string): string {
  const lines = wavenumber.map((w, i) => `${w} ${percent(i).toFixed(3)}`);
  return [
    '##TITLE= R test',
    '##JCAMP-DX= 4.24',
    '##DATA TYPE= INFRARED SPECTRUM',
    '##XUNITS= 1/CM',
    `##YUNITS= ${yUnits}`,
    '##XFACTOR= 1',
    '##YFACTOR= 1',
    `##FIRSTX= ${wavenumber[0]}`,
    `##LASTX= ${wavenumber[n - 1]}`,
    `##NPOINTS= ${n}`,
    '##XYPOINTS= (XY..XY)',
    ...lines,
    '##END=',
  ].join('\n');
}

const warned = (notes: { text: string }[]) =>
  notes.some((note) => /reflectance/i.test(note.text) && /transmittance/i.test(note.text));

describe('FTIR reflectance stated in the file (bug 4)', () => {
  it('recognises reflectance wording', () => {
    for (const text of ['Reflectance', '%R', 'R (%)', 'Diffuse reflectance', 'REFLECTANCE']) {
      expect(ftirStatesReflectance(text)).toBe(true);
    }
    for (const text of ['Transmittance', '%T', 'Absorbance', 'Sample 1']) {
      expect(ftirStatesReflectance(text)).toBe(false);
    }
  });

  it('a Reflectance heading gives transmittance in percent with a warning', () => {
    const result = importFtirText('r.csv', csv('Reflectance'), 'csv');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spectrum = result.spectra[0];
    expect(spectrum?.kind).toBe('transmittance');
    expect(spectrum?.scale).toBe('percent');
    expect(warned(spectrum?.notes ?? [])).toBe(true);
  });

  it('a JCAMP-DX file with YUNITS=REFLECTANCE gets the same warning', () => {
    const result = importFtirText('r.jdx', jcamp('REFLECTANCE'), 'jcamp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warned(result.spectra[0]?.notes ?? [])).toBe(true);
  });

  it('transmittance files carry no such warning', () => {
    const text = importFtirText('t.csv', csv('Transmittance'), 'csv');
    const jdx = importFtirText('t.jdx', jcamp('TRANSMITTANCE'), 'jcamp');
    expect(text.ok && warned(text.spectra[0]?.notes ?? [])).toBe(false);
    expect(jdx.ok && warned(jdx.spectra[0]?.notes ?? [])).toBe(false);
  });
});
