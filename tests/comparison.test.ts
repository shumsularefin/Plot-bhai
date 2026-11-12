// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RegionFit } from '../src/core/xrd/peaks/fit';
import { comparisonRows, comparisonTable } from '../src/modules/xrd/comparison';
import { DEFAULT_PEAK_STATE, initialXrdData, type XrdData } from '../src/modules/xrd/data';
import { sizeResults } from '../src/modules/xrd/sizeResults';
import { allTables } from '../src/modules/xrd/tables';

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

const pattern = (id: string, name: string) => ({
  id,
  name,
  source: 'synthetic' as const,
  twoTheta: new Float64Array(),
  intensity: new Float64Array(),
  intensityUnit: 'counts' as const,
  unitOrigin: 'generated' as const,
  synthetic: true,
  notes: [],
});

const fit = (scale: number) => ({
  ...DEFAULT_PEAK_STATE,
  fit: {
    regions: [region(30, 0.3 * scale), region(45, 0.35 * scale), region(60, 0.42 * scale)],
    inputKey: `fit-${scale}`,
  },
});

const data: XrdData = {
  ...initialXrdData,
  patterns: [pattern('a', 'Narrow'), pattern('b', 'Broad'), pattern('c', 'Not fitted')],
  peaks: { a: fit(1), b: fit(2) },
};

describe('sample comparison', () => {
  const rows = comparisonRows(data, []);

  it('gives one row per pattern with the same values as the per-pattern summary', () => {
    expect(rows.map((r) => r.name)).toEqual(['Narrow', 'Broad', 'Not fitted']);
    for (const id of ['a', 'b']) {
      const single = sizeResults(data, id);
      if (single.kind !== 'ok') throw new Error('no results');
      const row = rows.find((r) => r.id === id);
      expect(row?.scherrer).toEqual(single.summary.find((s) => s.method === 'scherrer')?.size);
      expect(row?.whStrain).toEqual(single.summary.find((s) => s.method === 'wh-udm')?.strain);
      expect(row?.peaks).toEqual({ used: 3, fitted: 3 });
    }
  });

  it('halves the Scherrer size when every width doubles (D is proportional to 1/β)', () => {
    const [narrow, broad] = [rows[0]?.scherrer?.value ?? NaN, rows[1]?.scherrer?.value ?? NaN];
    expect(narrow / broad).toBeCloseTo(2, 10);
  });

  it('says why a pattern has no values, and has no cell without a chosen phase', () => {
    expect(rows[2]?.peaks).toBeNull();
    expect(rows[2]?.note).toContain('no fitted peaks');
    expect(rows.every((r) => r.phase === null && r.volume === null)).toBe(true);
  });

  it('writes a CSV with a row per pattern and says the correction was skipped', () => {
    const table = comparisonTable(data, rows);
    const lines = table.text.split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toContain('Instrument correction was skipped');
    expect(lines[1]).toContain('D Scherrer (nm)');
    expect(lines).toHaveLength(5);
    expect(allTables(data, [])[0]?.name).toBe('sample-comparison');
    expect(allTables({ ...data, patterns: data.patterns.slice(0, 1) }, [])[0]?.name).not.toBe(
      'sample-comparison',
    );
  });
});
