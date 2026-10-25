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
import { assignmentFor, peakLabelSet } from '../src/modules/xrd/assignment';
import { DEFAULT_PEAK_STATE, initialXrdData, type XrdData } from '../src/modules/xrd/data';

const dir = new URL('../data/reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;
const index = read<ReferenceIndex>('index.json');
const tio2 = read<ReferenceFamilyFile>(
  (index.families.find((f) => f.id === 'tio2') as { file: string }).file,
).phases;
const anatase = tio2.find((p) => p.id === 'anatase') as ReferencePhase;
const CU = ANODES.Cu.kAlpha1;

/** Anatase lines (from the library) shifted by +0.04°, fitted like a real pattern. */
function fittedData(phaseIds: string[]): XrdData {
  const lines = referenceLines(anatase, CU).filter((l) => l.intensity >= 10 && l.twoTheta < 70);
  const { twoTheta, intensity } = generatePattern({
    start: 15,
    end: 75,
    step: 0.02,
    peaks: lines.map((l) => ({
      center: l.twoTheta + 0.04,
      fwhm: 0.15,
      height: (l.intensity / 100) * 4000,
      eta: 0.5,
    })),
    background: { constant: 100, amplitude: 0, decay: 1 },
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
    patterns: [{ id: 'p1' } as never],
    peaks: { p1: { ...DEFAULT_PEAK_STATE, guesses, fit: { regions, inputKey: 'k' } } },
    material: { ...initialXrdData.material, candidates: tio2.map((p) => p.id), phaseIds },
  };
}

describe('assignmentFor', () => {
  it('assigns an anatase pattern to anatase, labels it and refines a cell close to the library', () => {
    const result = assignmentFor(fittedData(['anatase']), 'p1', tio2, false);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.unassigned).toBe(0);
    expect(result.peaks.every((p) => p.phase?.id === 'anatase')).toBe(true);
    // The strongest line of anatase is (101); it is labelled in bold.
    const labels = peakLabelSet(result);
    expect(labels.key).toEqual([`Anatase, COD ${anatase.codId}`]);
    expect(labels.labels.find((l) => l.strong)?.text).toBe('(101)');
    expect(labels.labels.map((l) => l.text)).toContain('(004)');

    const phase = result.phases[0];
    expect(phase?.shift).toBeCloseTo(0.04, 1);
    const lattice = phase?.lattice;
    expect(lattice && 'outcome' in lattice && lattice.outcome.ok).toBe(true);
    if (!lattice || !('outcome' in lattice) || !lattice.outcome.ok) return;
    // The cell is the library cell; with a 0.04° zero shift not refined, it is off by a little.
    lattice.outcome.fit.edges.forEach((edge, j) =>
      expect(Math.abs(edge.a.value / (lattice.reference[j] as number) - 1)).toBeLessThan(2e-3),
    );
    const withShift = assignmentFor(fittedData(['anatase']), 'p1', tio2, true);
    const refined = withShift?.phases[0]?.lattice;
    if (!refined || !('outcome' in refined) || !refined.outcome.ok) throw new Error('no fit');
    expect(refined.outcome.fit.zeroShift?.value).toBeCloseTo(0.04, 2);
    refined.outcome.fit.edges.forEach((edge, j) =>
      expect(Math.abs(edge.a.value - (refined.reference[j] as number))).toBeLessThan(
        3 * edge.a.sigma + 1e-4,
      ),
    );
  });

  it('numbers the phases in the labels when several are chosen', () => {
    const result = assignmentFor(fittedData(['anatase', 'rutile']), 'p1', tio2, false);
    const labels = peakLabelSet(result as never);
    expect(labels.key[0]).toMatch(/^¹ Anatase, COD \d+$/);
    expect(labels.key[1]).toMatch(/^² Rutile, COD \d+$/);
    expect(labels.labels.some((l) => l.text.endsWith('¹'))).toBe(true);
  });

  it('returns nothing without fitted peaks or chosen phases', () => {
    const data = fittedData(['anatase']);
    expect(assignmentFor({ ...data, peaks: {} }, 'p1', tio2, false)).toBeNull();
    expect(
      assignmentFor({ ...data, material: { ...data.material, phaseIds: [] } }, 'p1', tio2, false),
    ).toBeNull();
  });
});
