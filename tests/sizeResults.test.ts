// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RegionFit } from '../src/core/xrd/peaks/fit';
import { DEFAULT_PEAK_STATE, initialXrdData, type XrdData } from '../src/modules/xrd/data';
import { sizeResults } from '../src/modules/xrd/sizeResults';

/** Fitted peaks as the fit step would store them: Gaussian, widths in degrees. */
function region(center: number, fwhm: number): RegionFit {
  const sigma = { height: 1, center: 0.001, fwhm: 0.001, eta: 0 };
  return {
    start: center - 1,
    end: center + 1,
    background: { intercept: 0, slope: 0, pivot: center },
    peaks: [
      {
        height: 100,
        center,
        fwhm,
        eta: 0,
        sigma,
        area: 1,
        areaSigma: 0,
        breadth: 1,
        breadthSigma: 0,
        messages: [],
      },
    ],
    rSquared: 1,
    reducedChiSquared: 1,
    noiseSd: 1,
    uncertaintiesOk: true,
    converged: true,
    iterations: 1,
    messages: [],
  };
}

function data(patch: Partial<XrdData> = {}): XrdData {
  const base = initialXrdData;
  return {
    ...base,
    patterns: [
      {
        id: 'p',
        name: 'P',
        source: 'synthetic',
        twoTheta: new Float64Array(),
        intensity: new Float64Array(),
        intensityUnit: 'counts',
        unitOrigin: 'generated',
        synthetic: true,
        notes: [],
      },
    ],
    peaks: {
      p: {
        ...DEFAULT_PEAK_STATE,
        fit: {
          regions: [region(30, 0.3), region(45, 0.35), region(60, 0.42), region(75, 0.06)],
          inputKey: 'fit-1',
        },
      },
    },
    instrument: { ...base.instrument, source: 'constant', constantFwhm: 0.05 },
    ...patch,
  };
}

const scherrerMean = (d: XrdData) => {
  const r = sizeResults(d, 'p');
  if (r.kind !== 'ok') throw new Error(r.reason);
  return r.scherrer.mean;
};

describe('results follow every setting at once', () => {
  it('K scales every size; the correction method and the peak choices change it', () => {
    const d = data();
    const r = sizeResults(d, 'p');
    if (r.kind !== 'ok') throw new Error('expected results');
    // The 0.06° peak is limited by resolution (b/B = 0.83), so it starts unticked.
    expect(r.peaks.map((p) => p.used)).toEqual([true, true, true, false]);
    const base = scherrerMean(d);
    expect(scherrerMean({ ...d, results: { ...d.results, k: 0.9 * 2 } })).toBeCloseTo(2 * base, 9);
    expect(
      scherrerMean({ ...d, instrument: { ...d.instrument, method: 'lorentzian' } }),
    ).toBeGreaterThan(base);
    const without = scherrerMean({
      ...d,
      results: {
        ...d.results,
        patterns: { p: { fitKey: 'fit-1', use: { 0: false }, modulus: {} } },
      },
    });
    expect(without).not.toBeCloseTo(base, 3);
  });

  it('choices saved for an earlier fit are ignored', () => {
    const d = data();
    const stale = {
      ...d,
      results: { ...d.results, patterns: { p: { fitKey: 'old', use: { 0: false }, modulus: {} } } },
    };
    expect(scherrerMean(stale)).toBeCloseTo(scherrerMean(d), 12);
  });

  it('skipping the correction uses the observed widths', () => {
    const d = data({ instrument: { ...initialXrdData.instrument, source: 'skip' } });
    const r = sizeResults(d, 'p');
    expect(r.kind === 'ok' && r.skipped).toBe(true);
    expect(r.kind === 'ok' && r.peaks[0]?.corrected).toBe(0.3);
  });

  it('says what is missing', () => {
    const noFit = data({ peaks: {} });
    expect(sizeResults(noFit, 'p')).toMatchObject({ kind: 'none' });
    const noWidth = data({ instrument: { ...initialXrdData.instrument, constantFwhm: null } });
    const r = sizeResults(noWidth, 'p');
    expect(r.kind === 'none' && r.reason).toContain('step 6');
  });
});
