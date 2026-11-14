import { describe, expect, it } from 'vitest';
import { DEFAULT_FTIR_PROCESSING, type FtirProcessing } from '../src/core/ftir/process';
import type { FtirSpectrum } from '../src/core/ftir/types';
import {
  ASSIGNMENT_MATCH_CM,
  attachAssignments,
  detachedAssignments,
  peakRows,
  peaksOfSpectrum,
} from '../src/modules/ftir/analysis';
import {
  exampleSpectra,
  FTIR_STATE_VERSION,
  initialFtirData,
  migrateFtirData,
  type Assignment,
  type FtirData,
} from '../src/modules/ftir/data';

// Audit 2026-11-14, bug 3: assignments were found again only within 2 cm⁻¹ of their peak, so a
// processing change that moved a peak made its assignment disappear.

const peak = (wavenumber: number) => ({ wavenumber, height: 1, prominence: 1, relative: 100 });

function withProcessing(
  data: FtirData,
  spectrum: FtirSpectrum,
  change: Partial<Record<'baseline' | 'smoothing' | 'atr' | 'normalise', boolean>>,
): FtirData {
  const p = DEFAULT_FTIR_PROCESSING;
  const processing: FtirProcessing = {
    atr: { ...p.atr, enabled: change.atr ?? false },
    baseline: { ...p.baseline, enabled: change.baseline ?? false },
    smoothing: { ...p.smoothing, enabled: change.smoothing ?? false },
    normalise: { ...p.normalise, enabled: change.normalise ?? false },
  };
  return { ...data, processing: { ...data.processing, [spectrum.id]: processing } };
}

describe('attachAssignments', () => {
  const a = (id: string, wavenumber: number): Assignment => ({ id, wavenumber, label: id });

  it('attaches each assignment to its nearest peak, one per peak', () => {
    const { byPeak, detached } = attachAssignments(
      [a('x', 1000), a('y', 1004), a('z', 1500)],
      [peak(1003), peak(1499)],
    );
    // y is nearer to 1003 than x, so y takes it; x has no other peak and is detached.
    expect(byPeak.map((s) => s?.id)).toEqual(['y', 'z']);
    expect(detached.map((s) => s.id)).toEqual(['x']);
  });

  it('keeps an assignment whose peak is gone, and re-attaches it when the peak returns', () => {
    const stored = [a('x', 1450)];
    expect(attachAssignments(stored, [peak(1100)]).detached).toEqual(stored);
    expect(attachAssignments(stored, [peak(1100), peak(1453)]).byPeak[1]).toEqual(stored[0]);
  });

  it('does not attach beyond the tolerance', () => {
    const far = attachAssignments([a('x', 1000)], [peak(1000 + ASSIGNMENT_MATCH_CM + 0.1)]);
    expect(far.detached).toHaveLength(1);
  });

  it('does not depend on the order of the stored assignments', () => {
    const peaks = [peak(1000), peak(1010)];
    const one = attachAssignments([a('x', 1003), a('y', 1006)], peaks);
    const two = attachAssignments([a('y', 1006), a('x', 1003)], peaks);
    expect(one.byPeak.map((s) => s?.id)).toEqual(two.byPeak.map((s) => s?.id));
  });
});

describe('assignments follow their peaks through reprocessing', () => {
  for (const [index, name] of [
    [0, 'absorbance'],
    [1, 'transmittance'],
  ] as const) {
    it(`every assignment of the example ${name} spectrum stays on its peak`, () => {
      const spectra = exampleSpectra();
      const spectrum = spectra[index] as FtirSpectrum;
      const base: FtirData = { ...initialFtirData, spectra };
      const peaks = peaksOfSpectrum(base, spectrum);
      expect(peaks.length).toBeGreaterThan(3);
      const stored = peaks.map((p, k) => ({
        id: `a${k}`,
        wavenumber: p.wavenumber,
        label: `band ${k}`,
      }));
      const data: FtirData = { ...base, assignments: { [spectrum.id]: stored } };

      const cases: Partial<Record<'baseline' | 'smoothing' | 'atr' | 'normalise', boolean>>[] = [];
      for (const baseline of [false, true])
        for (const smoothing of [false, true])
          for (const atr of [false, true])
            for (const normalise of [false, true])
              cases.push({ baseline, smoothing, atr, normalise });

      for (const change of cases) {
        const changed = withProcessing(data, spectrum, change);
        const rows = peakRows(changed).filter((r) => r.spectrum.id === spectrum.id);
        for (const assignment of stored) {
          // The peak it belongs to is the one nearest to where it was made.
          const nearest = rows.reduce((best, r) =>
            Math.abs(r.peak.wavenumber - assignment.wavenumber) <
            Math.abs(best.peak.wavenumber - assignment.wavenumber)
              ? r
              : best,
          );
          expect(nearest.assignment, JSON.stringify(change)).toBe(assignment.label);
        }
        expect(detachedAssignments(changed)).toEqual([]);
      }
    });
  }

  it('lists an assignment whose peak is gone instead of dropping it', () => {
    const spectra = exampleSpectra();
    const spectrum = spectra[0] as FtirSpectrum;
    const base: FtirData = { ...initialFtirData, spectra };
    const peaks = peaksOfSpectrum(base, spectrum);
    const weakest = peaks.reduce((m, p) => (p.prominence < m.prominence ? p : m));
    const stored = [{ id: 'w', wavenumber: weakest.wavenumber, label: 'weak band' }];
    const data: FtirData = {
      ...base,
      assignments: { [spectrum.id]: stored },
      // The peak search range no longer reaches the band.
      peaks: {
        [spectrum.id]: { prominencePercent: 5, fromCm: weakest.wavenumber + 50, toCm: null },
      },
    };
    const rows = peakRows(data).filter((r) => r.spectrum.id === spectrum.id);
    expect(
      rows.every((r) => Math.abs(r.peak.wavenumber - weakest.wavenumber) > ASSIGNMENT_MATCH_CM),
    ).toBe(true);
    expect(detachedAssignments(data).map((d) => d.assignment)).toEqual(stored);
    // Widening the range again brings the peak back and the assignment with it.
    const back = { ...data, peaks: {} };
    expect(peakRows(back).some((r) => r.assignment === 'weak band')).toBe(true);
    expect(detachedAssignments(back)).toEqual([]);
  });
});

describe('saved FTIR sessions', () => {
  it('version 3 assignments get an id and keep their position and text', () => {
    expect(FTIR_STATE_VERSION).toBe(4);
    const v3 = {
      step: 3,
      furthest: 5,
      data: {
        ...initialFtirData,
        processing: { s: DEFAULT_FTIR_PROCESSING },
        assignments: { s: [{ wavenumber: 1448.6, label: 'CH₂ bend' }] },
      },
    };
    const upgraded = migrateFtirData(v3, 3);
    expect(upgraded?.step).toBe(3);
    const a = upgraded?.data.assignments.s?.[0];
    expect(a?.wavenumber).toBe(1448.6);
    expect(a?.label).toBe('CH₂ bend');
    expect(typeof a?.id).toBe('string');
    expect(upgraded?.data.processing.s).toEqual(DEFAULT_FTIR_PROCESSING);
    expect(migrateFtirData(v3, 4)).toBeUndefined();
  });
});
