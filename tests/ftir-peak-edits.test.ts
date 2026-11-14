import { describe, expect, it } from 'vitest';
import groups from '../data/ftir/groups.json';
import { DEFAULT_FTIR_PROCESSING, type FtirProcessing } from '../src/core/ftir/process';
import { peakRows, peaksOfSpectrum, SNAP_CM } from '../src/modules/ftir/analysis';
import {
  DEFAULT_COMPARE_SETTINGS,
  exampleSpectra,
  initialFtirData,
  migrateFtirData,
  type FtirData,
} from '../src/modules/ftir/data';
import { methodsText } from '../src/modules/ftir/methodsText';
import { spectralRegions } from '../src/modules/ftir/regions';

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

function example(): FtirData {
  return { ...initialFtirData, spectra: exampleSpectra() };
}

function withBaseline(data: FtirData, on: boolean, smoothing = false): FtirData {
  const p = DEFAULT_FTIR_PROCESSING;
  const processing: FtirProcessing = {
    ...p,
    baseline: { ...p.baseline, enabled: on },
    smoothing: { ...p.smoothing, enabled: smoothing },
  };
  const id = must(data.spectra[0]).id;
  return { ...data, processing: { ...data.processing, [id]: processing } };
}

describe('peaks edited by hand', () => {
  it('keeps a removed peak removed and an added peak added through reprocessing', () => {
    const base = withBaseline(example(), true);
    const spectrum = must(base.spectra[0]);
    const picked = peaksOfSpectrum(base, spectrum);
    const victim = must(picked[2]);
    // A point on a flank, more than SNAP_CM from any maximum: added exactly there.
    const flank = must(picked[0]).wavenumber + 60;
    expect(picked.every((p) => Math.abs(p.wavenumber - flank) > SNAP_CM)).toBe(true);
    const edited: FtirData = {
      ...base,
      peakEdits: {
        [spectrum.id]: {
          added: [{ id: 'h1', wavenumber: flank, shoulder: true }],
          removed: [victim.wavenumber],
        },
      },
    };
    for (const variant of [edited, withBaseline(edited, false), withBaseline(edited, true, true)]) {
      const peaks = peaksOfSpectrum(variant, spectrum);
      expect(peaks.some((p) => Math.abs(p.wavenumber - victim.wavenumber) < 20)).toBe(false);
      const hand = peaks.find((p) => p.handId === 'h1');
      expect(hand?.origin).toBe('shoulder');
      expect(hand?.wavenumber).toBe(flank);
      expect(hand?.overlap).toBe(true);
      expect(peaks).toHaveLength(picked.length);
    }
  });

  it('snaps a peak added near a maximum to it and keeps it once', () => {
    const base = withBaseline(example(), true);
    const spectrum = must(base.spectra[0]);
    const picked = peaksOfSpectrum(base, spectrum);
    const target = must(picked[1]);
    const removedAndAdded: FtirData = {
      ...base,
      peakEdits: {
        [spectrum.id]: {
          added: [{ id: 'h2', wavenumber: target.wavenumber, shoulder: false }],
          removed: [target.wavenumber],
        },
      },
    };
    const peaks = peaksOfSpectrum(removedAndAdded, spectrum);
    expect(peaks).toHaveLength(picked.length);
    const hand = peaks.find((p) => p.handId === 'h2');
    expect(hand?.origin).toBe('hand');
    expect(hand?.wavenumber).toBeCloseTo(target.wavenumber, 6);
    expect(hand?.shape?.fwhm).toBeCloseTo(target.shape?.fwhm ?? 0, 6);
  });

  it('says in the methods text when peaks were edited by hand', () => {
    const base = withBaseline(example(), true);
    const spectrum = must(base.spectra[0]);
    expect(methodsText(base)).not.toMatch(/edited by hand/);
    const picked = peaksOfSpectrum(base, spectrum);
    const edited: FtirData = {
      ...base,
      peakEdits: { [spectrum.id]: { added: [], removed: [must(picked[0]).wavenumber] } },
    };
    expect(methodsText(edited)).toMatch(/edited by hand: 1 picked peak removed by hand/);
    expect(methodsText(edited)).toMatch(
      /within 10 cm⁻¹ of each other were treated as the same band/,
    );
  });

  it('marks the origin of every row', () => {
    const rows = peakRows(withBaseline(example(), true));
    expect(rows.every((r) => r.peak.origin === 'picked')).toBe(true);
  });
});

describe('saved FTIR sessions, version 4', () => {
  it('get no hand edits and the default comparison settings', () => {
    const v4data: Partial<FtirData> = { ...initialFtirData, toleranceCm: 12 };
    delete v4data.peakEdits;
    delete v4data.compare;
    const upgraded = migrateFtirData({ step: 4, furthest: 5, data: v4data }, 4);
    expect(upgraded?.step).toBe(4);
    expect(upgraded?.data.peakEdits).toEqual({});
    expect(upgraded?.data.compare).toEqual(DEFAULT_COMPARE_SETTINGS);
    expect(upgraded?.data.toleranceCm).toBe(12);
  });
});

describe('spectral regions', () => {
  it('are envelopes of rows of the group table', () => {
    const regions = spectralRegions();
    const span = (ids: number[]) => {
      const rows = groups.functionalGroups.filter((g) =>
        ids.includes(Number(/^fg-(\d+)-/.exec(g.id)?.[1])),
      );
      expect(rows).toHaveLength(ids.length);
      const all = rows.flatMap((g) => g.ranges);
      return [Math.min(...all.map((r) => r.from)), Math.max(...all.map((r) => r.to))];
    };
    const ids = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect([must(regions[0]).fromCm, must(regions[0]).toCm]).toEqual(span(ids(1, 8)));
    expect([must(regions[1]).fromCm, must(regions[1]).toCm]).toEqual(span(ids(9, 14)));
    expect([must(regions[2]).fromCm, must(regions[2]).toCm]).toEqual(span(ids(15, 17)));
    expect([must(regions[3]).fromCm, must(regions[3]).toCm]).toEqual(
      span([...ids(18, 25), 28, 29]),
    );
    expect([must(regions[4]).fromCm, must(regions[4]).toCm]).toEqual(span(ids(32, 65)));
    expect(regions.every((r) => r.fromCm < r.toCm)).toBe(true);
    // The metal–oxygen region spans the oxide bands at or below 900 cm⁻¹.
    const oxide = groups.metalOxides
      .flatMap((o) => o.bands.map((b) => b.cm))
      .filter((c) => c <= 900);
    expect([must(regions[5]).fromCm, must(regions[5]).toCm]).toEqual([
      Math.min(...oxide),
      Math.max(...oxide),
    ]);
  });
});
