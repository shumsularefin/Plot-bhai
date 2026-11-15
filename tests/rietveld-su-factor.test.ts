// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, StoredStructure } from '../src/core/xrd/reference/types';
import {
  DEFAULT_CHOICES,
  refineRietveld,
  type RietveldResult,
} from '../src/core/xrd/rietveld/refine';
import { rietveldMethods } from '../src/core/xrd/rietveld/report';
import { countingNoiseRatio } from '../src/core/xrd/rietveld/statistics';

/*
 * The switch that applies the Bérar–Lelann factor to every s.u., and the check that the scatter of
 * the points is that of raw counts (docs/validation.md, section 20).
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const column = (path: string, separator: RegExp, skip = 0) =>
  read(path)
    .trim()
    .split('\n')
    .slice(skip)
    .map((line) => line.trim().split(separator).map(Number));

const rows = column('tests/fixtures/validation/anatase-tch.xy', /\s+/);
const x = Float64Array.from(rows, (r) => r[0] as number);
const counts = Float64Array.from(rows, (r) => r[1] as number);

function refine(y: Float64Array, apply: boolean): RietveldResult {
  const ref = (json('tests/fixtures/cod-reference/tio2.json') as ReferenceFamilyFile).phases.find(
    (p) => p.id === 'anatase',
  );
  if (!ref?.structure) throw new Error('anatase missing');
  const structure: StoredStructure = {
    ...ref.structure,
    atoms: ref.structure.atoms.map((a) => ({ ...a, uIso: 0.01, uAniso: null })),
  };
  const result = refineRietveld({
    x,
    y,
    wavelengths: { kAlpha1: 1.5405929, kAlpha2: 1.5444274, ratio: 0.5 },
    phases: [
      {
        id: ref.id,
        name: ref.name,
        crystalSystem: ref.crystalSystem,
        cell: ref.cell,
        peaks: ref.peaks,
        orientation: null,
        structure,
      },
    ],
    choices: { ...DEFAULT_CHOICES, tch: true, positions: true, biso: true, berarLelann: apply },
    backgroundTerms: 6,
    atomicWeights: Object.fromEntries(
      (
        json('data/thermal/atomic-weights.json') as {
          elements: { symbol: string; weight: number }[];
        }
      ).elements.map((e) => [e.symbol, e.weight]),
    ),
    factors: (json('data/reference/scattering-factors.json') as { factors: FormFactors }).factors,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('applying the Bérar–Lelann factor', () => {
  const plain = refine(counts, false);
  const applied = refine(counts, true);
  const f = plain.stats.berarLelann;

  it('leaves the refined values and the factor unchanged', () => {
    expect(applied.stats.berarLelann).toBe(f);
    expect(applied.stats.rwp).toBe(plain.stats.rwp);
    expect(applied.phases[0]?.cell.a.value).toBe(plain.phases[0]?.cell.a.value);
    expect(plain.stats.berarLelannApplied).toBeUndefined();
    expect(applied.stats.berarLelannApplied).toBe(true);
  });

  it('multiplies every s.u. by the factor and the covariance by its square', () => {
    expect(f).toBeGreaterThan(1);
    const a = [applied.phases[0]?.cell.a, applied.phases[0]?.cell.c, applied.zero];
    const p = [plain.phases[0]?.cell.a, plain.phases[0]?.cell.c, plain.zero];
    a.forEach((estimate, i) => {
      expect(p[i]?.esd).toBeGreaterThan(0);
      expect(estimate?.esd).toBeCloseTo(f * (p[i]?.esd as number), 14);
    });
    const ca = applied.phases[0]?.geometry?.covariance as number[];
    const cp = plain.phases[0]?.geometry?.covariance as number[];
    expect(cp.some((v) => v !== 0)).toBe(true);
    ca.forEach((v, i) => expect(v).toBeCloseTo(f * f * (cp[i] as number), 18));
  });

  it('says in the methods text whether the s.u. were multiplied', () => {
    const methods = (result: RietveldResult, apply: boolean) =>
      rietveldMethods({
        result,
        choices: { ...DEFAULT_CHOICES, tch: true, berarLelann: apply },
        backgroundTerms: 6,
        phases: [{ name: 'anatase', reference: 'COD' }],
        radiation: 'Cu Kα1/Kα2',
      });
    expect(methods(plain, false)).toContain('they should be multiplied by the Bérar–Lelann');
    expect(methods(applied, true)).toContain('least-squares fit multiplied by the Bérar–Lelann');
  });
});

describe('noise of raw counts', () => {
  it('is about 1 for the patterns GSAS-II simulated with counting noise', () => {
    for (const name of ['anatase-tch', 'zno-texture', 'cofe2o4-capillary', 'zro2-bonds']) {
      const y = column(`tests/fixtures/validation/${name}.xy`, /\s+/).map((r) => r[1] as number);
      const ratio = countingNoiseRatio(y);
      expect(ratio, name).toBeGreaterThan(0.8);
      expect(ratio, name).toBeLessThan(1.25);
    }
  });

  it('is about 1 for three measured patterns stored as counts', () => {
    for (const name of ['bruker4_v5converter', 'bruker_locked_coupled', 'rigaku_zno_counts']) {
      const y = column(`tests/real-references/${name}.csv`, /,/, 1).map((r) => r[1] as number);
      const ratio = countingNoiseRatio(y);
      expect(ratio, name).toBeGreaterThan(0.7);
      expect(ratio, name).toBeLessThan(1.25);
    }
  });

  it('returns the factor the counts were multiplied by (known answer)', () => {
    const one = countingNoiseRatio(counts);
    for (const s of [0.1, 4, 25])
      expect(countingNoiseRatio(counts.map((v) => s * v)) / one).toBeCloseTo(s, 1);
  });

  it('falls when the pattern is smoothed and cannot tell on a short pattern', () => {
    const smooth = counts.map((v, i) => (v + (counts[i - 1] ?? v) + (counts[i + 1] ?? v)) / 3);
    expect(countingNoiseRatio(smooth)).toBeLessThan(0.2);
    expect(countingNoiseRatio(counts.slice(0, 80))).toBeNaN();
  });

  it('warns in the refinement only when the scatter is not that of counts', () => {
    const about = (r: RietveldResult) =>
      r.warnings.filter((w) => w.includes('scatter of the points'));
    expect(about(refine(counts, false))).toHaveLength(0);
    const scaled = about(
      refine(
        counts.map((v) => 5 * v),
        false,
      ),
    );
    expect(scaled).toHaveLength(1);
    expect(scaled[0]).toContain('multiplied by a factor');
  });
});
