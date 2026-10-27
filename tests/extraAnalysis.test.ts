// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTION, detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitPeaks } from '../src/core/xrd/peaks/fit';
import { ANODES } from '../src/core/xrd/radiation';
import { referenceLines } from '../src/core/xrd/reference/match';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types';
import { generatePattern } from '../src/core/xrd/synthetic';
import { assignmentFor } from '../src/modules/xrd/assignment';
import { DEFAULT_PEAK_STATE, initialXrdData, type XrdData } from '../src/modules/xrd/data';
import {
  characterFor,
  parseNumbers,
  runCrystallinity,
  textureFor,
  unfittedSignal,
} from '../src/modules/xrd/extraAnalysis';

const dir = new URL('./fixtures/cod-reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const index = read<ReferenceIndex>('index.json');
const phasesOf = (family: string) =>
  read<ReferenceFamilyFile>((index.families.find((f) => f.id === family) as { file: string }).file)
    .phases;
const zno = phasesOf('zno');
const wurtzite = zno.find((p) => p.id === 'zno-wurtzite') as ReferencePhase;
const CU = ANODES.Cu.kAlpha1;

/**
 * A ZnO pattern built from the library lines (with a +0.03° zero shift), each line's height
 * scaled by factor(hkl) so the true orientation is known, then detected and fitted.
 */
function zincOxide(factor: (hkl: [number, number, number]) => number): XrdData {
  const lines = referenceLines(wurtzite, CU).filter((l) => l.intensity >= 2 && l.twoTheta < 78);
  const { twoTheta, intensity } = generatePattern({
    start: 25,
    end: 80,
    step: 0.02,
    peaks: lines
      .map((l) => ({
        center: l.twoTheta + 0.03,
        fwhm: 0.15,
        height: (l.intensity / 100) * 6000 * factor(l.hkl[0] as [number, number, number]),
        eta: 0.5,
      }))
      .filter((p) => p.height > 0),
    background: { constant: 100, amplitude: 0, decay: 1 },
    noiseSeed: 3,
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
    patterns: [{ id: 'p1', twoTheta, intensity } as never],
    peaks: { p1: { ...DEFAULT_PEAK_STATE, guesses, fit: { regions, inputKey: 'k' } } },
    material: {
      ...initialXrdData.material,
      candidates: ['zno-wurtzite'],
      phaseIds: ['zno-wurtzite'],
    },
  };
}

const isAxial = (h: [number, number, number]) => h[0] === 0 && h[1] === 0;

function textureOf(data: XrdData, basis: 'height' | 'area' = 'height') {
  const assignment = assignmentFor(data, 'p1', zno, false);
  if (!assignment) throw new Error('no assignment');
  const texture = textureFor(data, 'p1', assignment, basis, data.patterns[0] ?? null);
  return { assignment, texture };
}

describe('texture and character on synthetic ZnO patterns', () => {
  it('a random-powder pattern has TC near 1 for every reflection and looks random', () => {
    const { assignment, texture } = textureOf(zincOxide(() => 1));
    const result = texture[0]?.result;
    if (!result || !('rows' in result)) throw new Error('no rows');
    expect(result.rows.length).toBeGreaterThanOrEqual(6);
    result.rows.forEach((r) => expect(Math.abs(r.tc - 1)).toBeLessThan(0.15));
    const ids = characterFor(assignment, texture, null).map((h) => h.id);
    expect(ids).toContain('random');
    expect(ids).not.toContain('orientation');
  });

  it('with the 00l lines ten times too strong, TC(00l) > 1 and the others < 1', () => {
    const { texture } = textureOf(zincOxide((h) => (isAxial(h) ? 10 : 1)));
    const result = texture[0]?.result;
    if (!result || !('rows' in result)) throw new Error('no rows');
    const axial = result.rows.filter((r) => r.hkl.some(isAxial));
    const others = result.rows.filter((r) => !r.hkl.some(isAxial));
    expect(axial.length).toBeGreaterThanOrEqual(2);
    axial.forEach((r) => expect(r.tc).toBeGreaterThan(1));
    others.forEach((r) => expect(r.tc).toBeLessThan(1));
    // The same with areas instead of heights (equal widths, so the same picture).
    const byArea = textureOf(
      zincOxide((h) => (isAxial(h) ? 10 : 1)),
      'area',
    ).texture[0]?.result;
    if (!byArea || !('rows' in byArea)) throw new Error('no rows');
    byArea.rows.filter((r) => r.hkl.some(isAxial)).forEach((r) => expect(r.tc).toBeGreaterThan(1));
  });

  it('a pattern with only the 00l lines triggers the orientation hint, with its reason', () => {
    const data = zincOxide((h) => (isAxial(h) ? 1 : 0));
    const { assignment, texture } = textureOf(data);
    const hints = characterFor(assignment, texture, null);
    const orientation = hints.find((h) => h.id === 'orientation');
    expect(orientation).toBeDefined();
    expect(orientation?.reason).toContain('(002)');
    expect(orientation?.reason).toContain('missing');
    expect(orientation?.text).toContain('Estimate only; a powder pattern cannot prove');
    expect(hints.map((h) => h.id)).not.toContain('random');
  });

  it('only counts missing reflections inside the scanned 2θ range', () => {
    const data = zincOxide((h) => (isAxial(h) ? 1 : 0));
    const first = data.patterns[0] as { twoTheta: Float64Array; intensity: Float64Array };
    // Keep only the data above 66°. The fit is left as it was, so (002) and (004) keep their peaks;
    // of the strong lines without a peak, only (212) at 67.9° and (201) at 69.1° lie in the scanned range.
    const from = first.twoTheta.findIndex((t) => t > 66);
    const cut = {
      ...data,
      patterns: [
        { id: 'p1', twoTheta: first.twoTheta.slice(from), intensity: first.intensity.slice(from) },
      ] as never,
    };
    const assignment = assignmentFor(cut, 'p1', zno, false);
    if (!assignment) throw new Error('no assignment');
    const result = textureFor(cut, 'p1', assignment, 'height', cut.patterns[0] ?? null)[0]?.result;
    if (!result || !('rows' in result)) throw new Error('no rows');
    expect(result.rows.filter((r) => !r.peak).map((r) => r.hklText)).toEqual(['(2 -1 2)', '(201)']);
  });
});

describe('missing reference lines with a signal', () => {
  const missingRows = (data: XrdData) => {
    const assignment = assignmentFor(data, 'p1', zno, false);
    if (!assignment) throw new Error('no assignment');
    const result = textureFor(data, 'p1', assignment, 'area', data.patterns[0] ?? null)[0]?.result;
    if (!result || !('rows' in result)) throw new Error('no rows');
    return result.rows.filter((r) => !r.peak);
  };

  it('flags strong lines that are in the pattern but were not fitted', () => {
    const full = zincOxide(() => 1);
    const state = full.peaks['p1'];
    const fit = state?.fit;
    if (!state || !fit) throw new Error('no fit');
    // Keep the fit of the first two regions only: the other lines are in the data, not in the fit.
    const partial: XrdData = {
      ...full,
      peaks: {
        p1: { ...state, fit: { ...fit, regions: fit.regions.slice(0, 2) } },
      },
    };
    const missing = missingRows(partial);
    expect(missing.length).toBeGreaterThanOrEqual(3);
    missing.forEach((r) => expect(unfittedSignal(r)).toBe(true));
  });

  it('does not flag lines that are really absent from the pattern', () => {
    const missing = missingRows(zincOxide((h) => (isAxial(h) ? 1 : 0)));
    expect(missing.length).toBeGreaterThanOrEqual(3);
    missing.forEach((r) => expect(unfittedSignal(r)).toBe(false));
  });
});

describe('runCrystallinity', () => {
  it('fills in the defaults: the whole pattern, a hump in the middle, peaks left out of the fit', () => {
    const twoTheta = Float64Array.from({ length: 701 }, (_, i) => 10 + i * 0.1);
    const intensity = twoTheta.map((t) => 100 + 400 * Math.exp(-((t - 40) ** 2) / 200));
    const run = runCrystallinity(
      twoTheta,
      intensity,
      {
        enabled: true,
        from: null,
        to: null,
        hump: 'gaussian',
        centre: null,
        fwhm: null,
        anchors: '',
      },
      [{ twoTheta: 40, fwhm: 0.2 }],
    );
    expect([run.from, run.to, run.centre]).toEqual([10, 80, 45]);
    expect(run.fwhm).toBeCloseTo(17.5, 10);
    expect(run.excludedPeaks).toBe(1);
    expect(run.outcome.ok).toBe(true);
  });

  it('parses typed anchor positions', () => {
    expect(parseNumbers('12, 18.5;24  30 x')).toEqual([12, 18.5, 24, 30]);
    expect(parseNumbers('')).toEqual([]);
  });
});
