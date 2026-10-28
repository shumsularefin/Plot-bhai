import { describe, expect, it } from 'vitest';
import { atrCorrect, penetrationDepthUm } from '../src/core/ftir/atr';
import { DEFAULT_FTIR_PROCESSING, processSpectrum } from '../src/core/ftir/process';
import { ftirMethodsParagraph } from '../src/core/ftir/methods';
import { initialFtirData, migrateFtirData } from '../src/modules/ftir/data';

describe('ATR correction', () => {
  it('gives the penetration depth from the Harrick equation', () => {
    // λ = 10 µm, sin²45° − (1.5/2.4)² = 0.109375.
    const expected = 10 / (2 * Math.PI * 2.4 * Math.sqrt(0.109375));
    expect(penetrationDepthUm(1000, 2.4, 1.5, 45)).toBeCloseTo(expected, 10);
    // Depth scales with wavelength.
    expect(penetrationDepthUm(2000, 2.4, 1.5, 45)).toBeCloseTo(expected / 2, 10);
  });

  it('reports no depth without total internal reflection', () => {
    expect(penetrationDepthUm(1000, 1.5, 1.5, 45)).toBeNull();
    expect(penetrationDepthUm(1000, 2.4, 1.5, 30)).toBeNull();
    expect(penetrationDepthUm(0, 2.4, 1.5, 45)).toBeNull();
  });

  it('scales the absorbance by wavenumber over the reference', () => {
    const x = Float64Array.from([500, 1000, 3000]);
    const a = Float64Array.from([0.2, 0.2, 0.2]);
    expect(Array.from(atrCorrect(x, a, 1000))).toEqual([0.1, 0.2, 0.6]);
  });

  it('runs first in the processing and leaves a note with the depth', () => {
    const wavenumber = Float64Array.from({ length: 50 }, (_, i) => 1000 + 20 * i);
    const values = wavenumber.map(() => 0.5);
    const out = processSpectrum(
      { wavenumber, values, kind: 'absorbance', scale: 'percent' },
      { ...DEFAULT_FTIR_PROCESSING, atr: { ...DEFAULT_FTIR_PROCESSING.atr, enabled: true } },
    );
    expect(out.absorbance[0]).toBeCloseTo(0.5, 12);
    expect(out.absorbance[49]).toBeCloseTo((0.5 * 1980) / 1000, 12);
    expect(out.messages.atr?.[0]?.text).toContain('2.01 µm');
  });

  it('is named in the methods text', () => {
    const text = ftirMethodsParagraph({
      software: 'X',
      allSynthetic: false,
      digitized: 0,
      spectra: [
        {
          kind: 'absorbance',
          atrReferenceCm: 1000,
          baseline: null,
          smoothing: null,
          normalise: null,
          prominencePercent: null,
          assignments: 0,
          fit: null,
          areas: 0,
        },
      ],
      differences: 0,
      toleranceCm: 20,
      rangeSource: '',
      shown: 'absorbance',
    });
    expect(text).toContain('ATR correction');
    expect(text).toContain('A × ν̃/1000 cm⁻¹');
  });

  it('adds the ATR settings to sessions saved before it existed', () => {
    const { atr: _atr, ...old } = DEFAULT_FTIR_PROCESSING;
    void _atr;
    const v2 = { step: 2, furthest: 4, data: { ...initialFtirData, processing: { s: old } } };
    const upgraded = migrateFtirData(v2, 2);
    expect(upgraded?.step).toBe(2);
    expect(upgraded?.data.processing.s?.atr.enabled).toBe(false);
  });
});
