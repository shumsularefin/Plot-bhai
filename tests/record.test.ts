// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { exampleSpectra as ftirExamples, initialFtirData } from '../src/modules/ftir/data';
import { ftirRecord } from '../src/modules/ftir/record';
import { exampleSpectra as uvvisExamples, initialUvvisData } from '../src/modules/uvvis/data';
import { uvvisRecord } from '../src/modules/uvvis/record';
import { DEFAULT_PROCESSING } from '../src/core/xrd/process/pipeline';
import { examplePatternRecords, initialXrdData } from '../src/modules/xrd/data';
import { xrdRecord } from '../src/modules/xrd/record';
import { fingerprint, recordMarkdown } from '../src/ui/report/record';

describe('data fingerprint', () => {
  it('is the same for the same numbers and changes with any value', async () => {
    const a = Float64Array.of(1, 2, 3);
    const first = await fingerprint([a]);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint([Float64Array.of(1, 2, 3)])).toBe(first);
    expect(await fingerprint([Float64Array.of(1, 2, 3.0000001)])).not.toBe(first);
  });
});

describe('analysis records', () => {
  it('XRD: every processing step in order, with parameters, warnings and methods text', async () => {
    const patterns = examplePatternRecords();
    const first = patterns[0];
    if (!first) throw new Error('missing');
    const data = {
      ...initialXrdData,
      patterns,
      processing: {
        [first.id]: {
          ...DEFAULT_PROCESSING,
          smoothing: { enabled: true, window: 9, order: 3 },
          background: { ...DEFAULT_PROCESSING.background, enabled: true },
        },
      },
    };
    const md = recordMarkdown(await xrdRecord(data, []), '2026-10-25T12:00:00Z');
    expect(md).toContain('# XRD analysis record');
    expect(md).toContain('build ');
    expect(md).toMatch(/SHA-256 of the values as loaded: [0-9a-f]{64}/);
    const steps = md.slice(md.indexOf('Processing, in the order it ran'));
    const order = [
      'Zero shift',
      'Savitzky–Golay',
      'Background removal',
      'Kα2 stripping',
      'Normalisation',
      'Peak finding',
      'Peak fitting',
    ];
    const at = order.map((s) => steps.indexOf(s));
    expect(at.every((v, i) => v >= 0 && (i === 0 || v > (at[i - 1] as number)))).toBe(true);
    expect(steps).toContain('1. Zero shift: not used');
    expect(steps).toContain('2. Savitzky–Golay smoothing: window 9 points, order 3');
    expect(steps).toContain('3. Background removal: arPLS, width 4° 2θ');
    expect(md).toContain('synthetic example data');
    expect(md).toContain('## Methods text');
    expect(md).toContain('## Warnings shown');
  });

  it('FTIR: the conversion and the presented quantity are recorded', async () => {
    const spectra = ftirExamples();
    const md = recordMarkdown(
      await ftirRecord({ ...initialFtirData, spectra, view: { quantity: 'transmittance' } }),
      '2026-10-25T12:00:00Z',
    );
    expect(md).toContain('Conversion to absorbance: A = −log10(T), T = %T / 100');
    expect(md).toContain('Presented as transmittance');
    expect(md).toMatch(/cm⁻¹: absorbance [\d.]+, [\d.]+ %T/);
  });

  it('UV-Vis: the Tauc fit with its region, statistics and transition choice', async () => {
    const md = recordMarkdown(
      await uvvisRecord({ ...initialUvvisData, spectra: uvvisExamples() }),
      '2026-10-25T12:00:00Z',
    );
    expect(md).toMatch(/Eg = [\d.]+ ± [\d.]+ eV from a straight line over/);
    expect(md).toContain("the transition type is the user's choice, not deduced from the data");
  });
});
