import { describe, expect, it } from 'vitest';
import { rubberBandBaseline } from '../src/core/ftir/baseline';
import { alsBaseline, solveBanded } from '../src/core/math/whittaker';
import { importFtirFile, importFtirText } from '../src/core/ftir/import';
import { parseJcamp } from '../src/core/ftir/jcamp';
import { suggestFtirKind } from '../src/core/ftir/kind';
import { pickPeaks } from '../src/core/ftir/peaks';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  toAbsorbance,
  toPercentTransmittance,
  type FtirProcessing,
} from '../src/core/ftir/process';
import { EXAMPLE_BANDS, generateFtir, transmittanceOf } from '../src/core/ftir/synthetic';
import { solve } from '../src/core/math/linear';

const grid = { startCm: 400, endCm: 4000, stepCm: 2 };
const settings = (patch: Partial<FtirProcessing>): FtirProcessing => ({
  ...DEFAULT_FTIR_PROCESSING,
  ...patch,
});
const first = <T>(items: readonly T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('expected an item');
  return item;
};

describe('conversions', () => {
  it('turns %T into absorbance and back with the known values', () => {
    const a = toAbsorbance(Float64Array.from([100, 10, 1]), 'transmittance', 'percent');
    expect(Array.from(a)).toEqual([0, 1, 2].map((v) => expect.closeTo(v, 12)));
    const fraction = toAbsorbance(Float64Array.from([0.1]), 'transmittance', 'fraction');
    expect(fraction[0]).toBeCloseTo(1, 12);
    const t = toPercentTransmittance(Float64Array.from([0, 1, 2]));
    expect(Array.from(t)).toEqual([100, 10, 1].map((v) => expect.closeTo(v, 10)));
  });
});

describe('text import', () => {
  const rows = (from: number, to: number, step: number, f: (v: number) => number) => {
    const out: string[] = [];
    for (let v = from; v >= to; v -= step) out.push(`${v},${f(v)}`);
    return out;
  };

  it('reads a high-to-low csv, reverses it and takes %T from the heading', () => {
    const text = ['Wavenumber (cm-1),%T', ...rows(4000, 400, 40, (v) => 50 + v / 100)].join('\n');
    const result = importFtirText('film.csv', text, 'csv');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = first(result.spectra);
    expect(s.wavenumber[0]).toBe(400);
    expect(s.wavenumber[s.wavenumber.length - 1]).toBe(4000);
    expect(s.values[0]).toBeCloseTo(54, 12);
    expect(s.kind).toBe('transmittance');
    expect(s.kindOrigin).toBe('header');
    expect(s.notes.some((n) => n.text.includes('reversed'))).toBe(true);
  });

  it('guesses from the value range and refuses wavenumbers that are micrometres', () => {
    expect(suggestFtirKind([0.1, 0.8, 1.9]).kind).toBe('absorbance');
    expect(suggestFtirKind([20, 60, 95]).kind).toBe('transmittance');
    const um = Array.from({ length: 12 }, (_, i) => `${2.5 + i},${i + 1}`).join('\n');
    const refused = importFtirText('um.txt', um, 'text');
    expect(!refused.ok && refused.error).toContain('cm⁻¹');
  });

  it('refuses binary instrument files with an export hint, and empty input', () => {
    const spa = importFtirFile('sample.spa', new Uint8Array([1, 2, 3, 4, 0, 5]));
    expect(!spa.ok && spa.error).toContain('Thermo OMNIC');
    expect(!spa.ok && spa.error).toContain('JCAMP-DX');
    expect(importFtirFile('a.csv', new Uint8Array(0)).ok).toBe(false);
  });
});

describe('JCAMP-DX', () => {
  // Wavenumber 4000 down to 3990 in steps of 2 cm-1: x at the start of each line, y values after.
  const jdx = (extra = '') =>
    [
      '##TITLE= Test spectrum',
      '##JCAMP-DX= 4.24',
      '##DATA TYPE= INFRARED SPECTRUM',
      '##XUNITS= 1/CM',
      '##YUNITS= TRANSMITTANCE',
      '##XFACTOR= 1',
      '##YFACTOR= 0.5',
      '##FIRSTX= 4000',
      '##LASTX= 3990',
      '##NPOINTS= 6',
      extra,
      '##XYDATA= (X++(Y..Y))',
      '4000 100 102 104',
      '3994 106 108 110',
      '##END=',
    ].join('\n');

  it('reads x from FIRSTX and LASTX, scales y and reports the unit', () => {
    const result = parseJcamp(jdx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spectrum.title).toBe('Test spectrum');
    expect(result.spectrum.wavenumber).toEqual([4000, 3998, 3996, 3994, 3992, 3990]);
    expect(result.spectrum.values).toEqual([50, 51, 52, 53, 54, 55]);
    expect(result.spectrum.yUnits).toBe('TRANSMITTANCE');
  });

  it('converts micrometres and refuses unknown units and compressed numbers', () => {
    const um = jdx()
      .replace('1/CM', 'MICROMETERS')
      .replace('4000 100', '2.5 100')
      .replace('3994 106', '3 106')
      .replace('##FIRSTX= 4000', '##FIRSTX= 2.5')
      .replace('##LASTX= 3990', '##LASTX= 3.5');
    const converted = parseJcamp(um);
    expect(converted.ok && converted.spectrum.wavenumber[0]).toBeCloseTo(4000, 9);
    expect(parseJcamp(jdx().replace('1/CM', 'SECONDS')).ok).toBe(false);
    const compressed = jdx().replace('4000 100 102 104', '4000 A0B2C4');
    const refused = parseJcamp(compressed);
    expect(!refused.ok && refused.error).toContain('compressed');
  });

  it('is imported through importFtirText with the unit-based data type', () => {
    const lines = Array.from({ length: 4 }, (_, k) => `${4000 - 6 * k} 100 102 104`);
    const text = jdx()
      .replace(/4000 100 102 104\n3994 106 108 110/, lines.join('\n'))
      .replace('##LASTX= 3990', '##LASTX= 3978')
      .replace('##NPOINTS= 6', '##NPOINTS= 12');
    const result = importFtirText('x.jdx', text, 'text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = first(result.spectra);
    expect(s.source).toBe('jcamp');
    expect(s.kind).toBe('transmittance');
    expect(s.wavenumber[0]).toBe(3978);
    expect(s.values).toHaveLength(12);
  });
});

describe('baselines', () => {
  it('solves the banded system like the dense solver', () => {
    const n = 8;
    const d0 = Float64Array.from({ length: n }, (_, i) => 6 + i);
    const d1 = Float64Array.from({ length: n }, (_, i) => (i < n - 1 ? -2 : 0));
    const d2 = Float64Array.from({ length: n }, (_, i) => (i < n - 2 ? 0.5 : 0));
    const b = Float64Array.from({ length: n }, (_, i) => Math.sin(i) + 2);
    const dense = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) =>
          (i === j
            ? d0[i]
            : Math.abs(i - j) === 1
              ? d1[Math.min(i, j)]
              : Math.abs(i - j) === 2
                ? d2[Math.min(i, j)]
                : 0) as number,
      ),
    );
    const expected = solve(dense, Array.from(b));
    const got = solveBanded(d0, d1, d2, b);
    got.forEach((v, i) => expect(v).toBeCloseTo((expected as number[])[i] as number, 10));
  });

  it('rubber band recovers a straight baseline under peaks', () => {
    const wavenumber = Float64Array.from({ length: 400 }, (_, i) => 400 + 9 * i);
    const baseline = wavenumber.map((v) => 0.1 + 0.0001 * (4000 - v));
    const peaks = wavenumber.map(
      (v) => 0.8 * Math.exp(-(((v - 1700) / 40) ** 2)) + 0.5 * Math.exp(-(((v - 2900) / 60) ** 2)),
    );
    const y = peaks.map((p, i) => p + (baseline[i] as number));
    const estimate = rubberBandBaseline(wavenumber, y);
    [0, 50, 150, 250, 399].forEach((i) =>
      expect(estimate[i]).toBeCloseTo(baseline[i] as number, 3),
    );
    expect(estimate.every((v, i) => v <= (y[i] as number) + 1e-12)).toBe(true);
  });

  it('asymmetric least squares follows a curved baseline away from the peaks', () => {
    const example = generateFtir({
      ...grid,
      bands: EXAMPLE_BANDS,
      baseline: { offset: 0.05, slope: 0.00005, curvature: 0.02 },
    });
    const truth = generateFtir({
      ...grid,
      bands: [],
      baseline: { offset: 0.05, slope: 0.00005, curvature: 0.02 },
    }).absorbance;
    const estimate = alsBaseline(example.absorbance, 1e6, 0.01);
    // Compare in a region with no band: 2000 to 2600 cm-1 (indices of 2 cm-1 steps).
    for (const wn of [2000, 2200, 2400, 2600]) {
      const i = (wn - 400) / 2;
      expect(Math.abs((estimate[i] as number) - (truth[i] as number))).toBeLessThan(0.02);
    }
  });
});

describe('processSpectrum', () => {
  it('does nothing with every step off and never changes its input', () => {
    const { wavenumber, absorbance } = generateFtir({ ...grid, bands: EXAMPLE_BANDS });
    const copy = Array.from(absorbance);
    const out = processSpectrum(
      { wavenumber, values: absorbance, kind: 'absorbance', scale: 'percent' },
      DEFAULT_FTIR_PROCESSING,
    );
    expect(Array.from(out.absorbance)).toEqual(copy);
    expect(out.baseline).toBeNull();
  });

  it('removes a sloped baseline and normalises to a maximum of 1', () => {
    const { wavenumber, absorbance } = generateFtir({
      ...grid,
      bands: EXAMPLE_BANDS,
      baseline: { offset: 0.1, slope: 0.0001, curvature: 0 },
    });
    const out = processSpectrum(
      { wavenumber, values: absorbance, kind: 'absorbance', scale: 'percent' },
      settings({
        baseline: { ...DEFAULT_FTIR_PROCESSING.baseline, enabled: true, method: 'rubber-band' },
        normalise: { enabled: true, method: 'max' },
      }),
    );
    expect(Math.max(...out.absorbance)).toBeCloseTo(1, 12);
    expect(out.baseline).not.toBeNull();
  });

  it('works on transmittance by converting to absorbance first', () => {
    const { wavenumber, absorbance } = generateFtir({ ...grid, bands: EXAMPLE_BANDS });
    const out = processSpectrum(
      { wavenumber, values: transmittanceOf(absorbance), kind: 'transmittance', scale: 'percent' },
      DEFAULT_FTIR_PROCESSING,
    );
    out.absorbance.forEach((v, i) => expect(v).toBeCloseTo(absorbance[i] as number, 9));
  });

  it('removes unusable transmittance points and says so; skips smoothing on uneven spacing', () => {
    const wavenumber = Float64Array.from({ length: 40 }, (_, i) => 400 + 3 * i + (i > 20 ? 7 : 0));
    const values = Float64Array.from(wavenumber, (_, i) => (i === 5 ? 0 : 50));
    const out = processSpectrum(
      { wavenumber, values, kind: 'transmittance', scale: 'percent' },
      settings({ smoothing: { enabled: true, window: 5, order: 2 } }),
    );
    expect(out.absorbance).toHaveLength(39);
    expect(out.messages.baseline?.[0]?.text).toContain('1 point was removed');
    expect(out.messages.smoothing?.[0]?.text).toContain('not even');
  });
});

describe('peak picking', () => {
  it('finds the bands of a noisy synthetic spectrum to a twentieth of their width (at least 2 cm-1) and keeps noise out', () => {
    const { wavenumber, absorbance } = generateFtir({
      ...grid,
      bands: EXAMPLE_BANDS,
      noiseSeed: 4,
      noiseSd: 0.004,
    });
    const smooth = processSpectrum(
      { wavenumber, values: absorbance, kind: 'absorbance', scale: 'percent' },
      settings({ smoothing: { enabled: true, window: 11, order: 3 } }),
    );
    const peaks = pickPeaks(
      smooth.absorbance.length ? smooth.wavenumber : wavenumber,
      smooth.absorbance,
      { minProminence: 0.05 },
    );
    expect(peaks).toHaveLength(EXAMPLE_BANDS.length);
    for (const band of EXAMPLE_BANDS) {
      const nearest = peaks.reduce((a, b) =>
        Math.abs(b.wavenumber - band.centre) < Math.abs(a.wavenumber - band.centre) ? b : a,
      );
      // A very broad band cannot be located as precisely as a narrow one under noise.
      expect(Math.abs(nearest.wavenumber - band.centre)).toBeLessThan(Math.max(2, band.fwhm / 20));
    }
    expect(Math.max(...peaks.map((p) => p.relative))).toBeCloseTo(100, 9);
  });

  it('refines a position below the data step and honours the search range', () => {
    const x = Float64Array.from({ length: 100 }, (_, i) => 1000 + 4 * i);
    const y = x.map((v) => Math.exp(-(((v - 1202.3) / 30) ** 2)));
    const [peak] = pickPeaks(x, y, { minProminence: 0.1 });
    expect(peak?.wavenumber).toBeCloseTo(1202.3, 0);
    expect(Math.abs((peak?.wavenumber ?? 0) - 1202.3)).toBeLessThan(0.5);
    expect(pickPeaks(x, y, { minProminence: 0.1, fromCm: 1300 })).toHaveLength(0);
  });

  it('measures prominence from the higher valley', () => {
    // Two peaks, the second sitting on the shoulder of the first.
    const y = Float64Array.from([0, 1, 5, 2, 3, 2.5, 0, 0]);
    const x = Float64Array.from(y, (_, i) => i);
    const peaks = pickPeaks(x, y, { minProminence: 0 });
    expect(peaks.map((p) => p.prominence)).toEqual([5, 1]);
  });
});
