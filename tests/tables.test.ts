// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTION, detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitPeaks } from '../src/core/xrd/peaks/fit';
import { ANODES } from '../src/core/xrd/radiation';
import { referenceLines } from '../src/core/xrd/reference/match';
import type { ReferenceFamilyFile, ReferenceIndex } from '../src/core/xrd/reference/types';
import { generatePattern } from '../src/core/xrd/synthetic';
import { assignmentFor } from '../src/modules/xrd/assignment';
import { DEFAULT_PEAK_STATE, initialXrdData, type XrdData } from '../src/modules/xrd/data';
import { referenceLanesFor } from '../src/modules/xrd/figure';
import { allTables, combinedCsv } from '../src/modules/xrd/tables';

const dir = new URL('../data/reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const index = read<ReferenceIndex>('index.json');
const zno = read<ReferenceFamilyFile>(
  (index.families.find((f) => f.id === 'zno') as { file: string }).file,
).phases;
const wurtzite = zno.find((p) => p.id === 'zno-wurtzite');
if (!wurtzite) throw new Error('library has no zno-wurtzite');

function fitted(): XrdData {
  const lines = referenceLines(wurtzite!, ANODES.Cu.kAlpha1).filter(
    (l) => l.intensity >= 5 && l.twoTheta < 75,
  );
  const { twoTheta, intensity } = generatePattern({
    start: 25,
    end: 80,
    step: 0.02,
    peaks: lines.map((l) => ({
      center: l.twoTheta,
      fwhm: 0.2,
      height: (l.intensity / 100) * 5000,
      eta: 0.5,
    })),
    background: { constant: 50, amplitude: 0, decay: 1 },
    noiseSeed: 5,
  });
  const guesses = detectPeaks(twoTheta, intensity, DEFAULT_DETECTION).map((d) => ({
    center: d.center,
    width: d.width,
  }));
  const regions = fitPeaks(twoTheta, intensity, guesses, {
    profile: 'pseudo-voigt',
    fixedEta: null,
  });
  return {
    ...initialXrdData,
    patterns: [{ id: 'p1', name: 'Sample', intensityUnit: 'counts', twoTheta, intensity } as never],
    peaks: { p1: { ...DEFAULT_PEAK_STATE, guesses, fit: { regions, inputKey: 'k' } } },
    material: { ...initialXrdData.material, familyId: 'zno', phaseIds: ['zno-wurtzite'] },
  };
}

describe('export tables and lanes', () => {
  const data = fitted();

  it('builds the peak, assignment and size tables for a fitted pattern', () => {
    const tables = allTables(data, zno);
    const names = tables.map((t) => t.name);
    expect(names).toContain('Sample-peaks');
    expect(names).toContain('Sample-assigned-peaks');
    const peaks = tables.find((t) => t.name === 'Sample-peaks');
    const lines = (peaks?.text ?? '').split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toMatch(/^# Peak fit for Sample/);
    expect(lines[1]).toContain('2θ (°)');
    expect(lines.length).toBeGreaterThan(5);
  });

  it('gives no tables for a pattern without a fit', () => {
    expect(allTables({ ...data, peaks: {} }, zno)).toEqual([]);
  });

  it('joins tables into one CSV with a name line before each', () => {
    const tables = allTables(data, zno);
    const text = combinedCsv(tables);
    for (const t of tables) expect(text).toContain(`## ${t.name}\r\n# `);
  });

  it('makes one named lane per chosen phase, with the COD ID, and marks unmatched lines', () => {
    const assignment = assignmentFor(data, 'p1', zno, false);
    if (!assignment) throw new Error('no assignment');
    const lanes = referenceLanesFor(data, assignment);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.name).toBe(`${wurtzite!.name}, COD ${wurtzite!.codId}`);
    expect(lanes[0]?.lines.some((l) => l.found)).toBe(true);
    const hidden = referenceLanesFor(
      { ...data, material: { ...data.material, hidden: ['zno-wurtzite'] } },
      assignment,
    );
    expect(hidden).toEqual([]);
  });
});
