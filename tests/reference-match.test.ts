// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPeaks, DEFAULT_DETECTION } from '../src/core/xrd/peaks/detect';
import { ANODES } from '../src/core/xrd/radiation';
import { matchPhase, referenceLines, searchFamilies } from '../src/core/xrd/reference/match';
import type { PatternPeak } from '../src/core/xrd/reference/powder';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types';
import { generatePattern } from '../src/core/xrd/synthetic';

const dir = new URL('./fixtures/cod-reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const index = read<ReferenceIndex>('index.json');
const phases = index.families.flatMap((f) => read<ReferenceFamilyFile>(f.file).phases);
const phase = (id: string) => phases.find((p) => p.id === id) as ReferencePhase;
const CU = ANODES.Cu.kAlpha1;

/** A scan made of the library's own lines for the given phases, with noise. Not a measurement. */
function scan(parts: { phase: ReferencePhase; scale: number }[], shift: number) {
  const peaks = parts.flatMap(({ phase: p, scale }) =>
    referenceLines(p, CU)
      .filter((l) => l.twoTheta > 12 && l.twoTheta < 78)
      .map((l) => ({
        center: l.twoTheta + shift,
        fwhm: 0.15,
        height: (l.intensity / 100) * 2500 * scale,
        eta: 0.5,
      })),
  );
  return generatePattern({
    start: 10,
    end: 80,
    step: 0.02,
    peaks,
    background: { constant: 100, amplitude: 0, decay: 1 },
    noiseSeed: 7,
  });
}

function detected(parts: { phase: ReferencePhase; scale: number }[], shift: number) {
  const { twoTheta, intensity } = scan(parts, shift);
  const found = detectPeaks(twoTheta, intensity, DEFAULT_DETECTION).map((p) => p.center);
  return { found, range: [10, 80] as const };
}

describe('referenceLines', () => {
  it('reproduces the stored Cu Kα1 intensities and Bragg-law positions', () => {
    const anatase = phase('anatase');
    const lines = referenceLines(anatase, CU);
    expect(lines).toHaveLength(anatase.peaks.length);
    lines.forEach((line, i) => {
      const stored = anatase.peaks[i];
      expect(line.intensity).toBeCloseTo(stored?.i ?? NaN, 2);
      expect(Math.sin((line.twoTheta * Math.PI) / 360)).toBeCloseTo(CU / (2 * line.d), 12);
    });
  });

  it('moves the lines to larger angles for a longer wavelength', () => {
    const rutile = phase('rutile');
    const cu = referenceLines(rutile, CU)[0] as PatternPeak;
    const cr = referenceLines(rutile, ANODES.Cr.kAlpha1)[0] as PatternPeak;
    expect(cr.twoTheta).toBeGreaterThan(cu.twoTheta);
    expect(cr.d).toBe(cu.d);
  });
});

describe('searchFamilies', () => {
  it('finds a family by name, alias, formula or phase name', () => {
    const ids = (q: string) => searchFamilies(index.families, q).map((f) => f.id);
    expect(ids('titania')).toContain('tio2');
    expect(ids('TiO2')[0]).toBe('tio2');
    expect(ids('tio 2')).toContain('tio2');
    expect(ids('Anatase')).toContain('tio2');
    expect(ids('zinc')).toEqual(expect.arrayContaining(['zno', 'zns']));
    expect(ids('no such material')).toEqual([]);
    expect(ids('')).toHaveLength(index.families.length);
  });
});

describe('matchPhase, exact positions', () => {
  const lines: PatternPeak[] = [
    { twoTheta: 20, d: 4, intensity: 100, multiplicity: 1, mf2: 1, hkl: [[1, 0, 0]] },
    { twoTheta: 30, d: 3, intensity: 50, multiplicity: 1, mf2: 1, hkl: [[1, 1, 0]] },
    { twoTheta: 40, d: 2, intensity: 50, multiplicity: 1, mf2: 1, hkl: [[1, 1, 1]] },
    { twoTheta: 50, d: 1.8, intensity: 2, multiplicity: 1, mf2: 1, hkl: [[2, 0, 0]] },
  ];
  const range = [10, 60] as const;

  it('finds the shift between reference and measured positions', () => {
    const result = matchPhase(lines, [20.12, 30.12, 40.12], range);
    expect(result.score).toBe(1);
    expect(result.shift).toBeCloseTo(0.12, 9);
    expect(result.lines.map((l) => l.observed)).toEqual([20.12, 30.12, 40.12]);
  });

  it('weights by intensity and ignores lines weaker than 5 %', () => {
    // Only the 50 % line at 40° is missing: found 150 of 200.
    const result = matchPhase(lines, [20, 30], range);
    expect(result.score).toBeCloseTo(0.75, 12);
    expect(result.lines).toHaveLength(3);
  });

  it('does not score lines outside the measured range', () => {
    const result = matchPhase(lines, [20, 30, 40], [35, 60]);
    expect(result.lines.map((l) => l.twoTheta)).toEqual([40]);
    expect(result.score).toBe(1);
  });

  it('scores zero when no peak is within the tolerance', () => {
    expect(matchPhase(lines, [25, 35, 45], range, { ...DEFAULTS, toleranceDeg: 0.05 }).score).toBe(
      0,
    );
    expect(matchPhase(lines, [], range).score).toBe(0);
  });

  it('prefers the shift closest to the peaks when several give the same score', () => {
    const result = matchPhase([lines[0] as PatternPeak], [20.1], range);
    expect(result.shift).toBeCloseTo(0.1, 9);
  });
});

const DEFAULTS = { toleranceDeg: 0.15, maxShiftDeg: 0.3, shiftStepDeg: 0.01, minIntensity: 5 };

describe('matchPhase on patterns built from the library (anatase, rutile, brookite)', () => {
  const candidates = ['anatase', 'rutile', 'brookite'].map(phase);

  it('anatase with a 0.05° shift and noise scores highest, and the shift is recovered', () => {
    const { found, range } = detected([{ phase: phase('anatase'), scale: 1 }], 0.05);
    const scores = candidates.map((p) => ({
      id: p.id,
      ...matchPhase(referenceLines(p, CU), found, range),
    }));
    const anatase = scores.find((s) => s.id === 'anatase');
    for (const other of scores.filter((s) => s.id !== 'anatase')) {
      expect(anatase?.score, `anatase vs ${other.id}`).toBeGreaterThan(other.score);
    }
    expect(anatase?.score).toBeGreaterThan(0.9);
    expect(anatase?.shift).toBeGreaterThan(0.02);
    expect(anatase?.shift).toBeLessThan(0.08);
  });

  it('a 50/50 anatase + rutile mixture shows both above 0.5', () => {
    const { found, range } = detected(
      [
        { phase: phase('anatase'), scale: 1 },
        { phase: phase('rutile'), scale: 1 },
      ],
      0,
    );
    const score = (id: string) => matchPhase(referenceLines(phase(id), CU), found, range).score;
    expect(score('anatase')).toBeGreaterThan(0.5);
    expect(score('rutile')).toBeGreaterThan(0.5);
  });
});
