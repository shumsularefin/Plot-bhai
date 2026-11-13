// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { weightedLinearFit } from '../src/core/math/linearFit';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import {
  DEFAULT_CHOICES,
  refineRietveld,
  type RietveldInput,
} from '../src/core/xrd/rietveld/refine';
import {
  refineSeries,
  seriesQuantities,
  type SeriesItem,
  type SeriesPoint,
} from '../src/core/xrd/rietveld/sequential';
import { structureFactorSquared, structureModel } from '../src/core/xrd/rietveld/structure';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/sequential.py (run on GitHub by
 * .github/workflows/validation.yml) simulated five ZnO patterns whose cell grows by a made-up
 * linear law (a by 6e-6 and c by 4e-6 per unit of the series value 25…425), refined each one in
 * GSAS-II on its own, ran GSAS-II's sequential refinement on the same patterns (when it worked),
 * and fitted numpy.polyfit lines through GSAS-II's a and c. Here the site refines the same series
 * sequentially and is compared with all of these, with the truth, and with itself started
 * differently (invariance).
 */

type G2Cell = Record<
  'length_a' | 'length_b' | 'length_c' | 'angle_alpha' | 'angle_beta' | 'angle_gamma' | 'volume',
  number
>;
interface Line {
  x: number[];
  y: number[];
  sigma: number[];
  slope: number;
  intercept: number;
  slopeSigma: number;
  interceptSigma: number;
  slopeSigmaUnscaled: number;
  interceptSigmaUnscaled: number;
}
interface Fixture {
  wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  instrument: Record<'Zero' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'SH/L' | 'Polariz.', number>;
  expansion: { a: number; c: number };
  series: { file: string; value: number; cell: G2Cell }[];
  oneByOne: { Rwp: number; cell: G2Cell; cellEsd: G2Cell }[];
  sequential: { cell: number[]; cellEsd: number[]; Rwp: number | null }[] | { error: string };
  lineFits: { length_a: Line; length_c: Line };
}

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/sequential.json') as Fixture;

/** The ZnO phase with U_iso = 0 and no anomalous dispersion, as in the GSAS-II simulation. */
function znoPhase() {
  const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
    (p) => p.id === 'zno-wurtzite',
  ) as ReferencePhase;
  const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
    .factors;
  const stored = zno.structure as NonNullable<ReferencePhase['structure']>;
  const model = structureModel(
    zno.cell,
    { ...stored, atoms: stored.atoms.map((a) => ({ ...a, uIso: 0, uAniso: null })) },
    factors,
    {},
    false,
  );
  const states = model.atoms.map((a) => ({
    x: a.x0,
    occupancy: a.occupancy0,
    b: a.b0,
    fraction: 0,
  }));
  const peaks = zno.peaks.map((peak) => ({
    ...peak,
    mf2: refinementReflections([peak], zno.cell, cellKind(zno.crystalSystem, zno.cell), 0.5)
      .flatMap((r) => r.members)
      .reduce((sum, hkl) => sum + structureFactorSquared(model, states, hkl, peak.d), 0),
  }));
  return { zno, peaks };
}

const { zno, peaks } = znoPhase();
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const G = 8 * Math.LN2 * 1e-4;
const ip = fixture.instrument;

function items(values: number[]): SeriesItem[] {
  return fixture.series.map((s, k) => {
    const rows = read(`tests/fixtures/validation/${s.file}`)
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
    const input: RietveldInput = {
      x: Float64Array.from(rows, (r) => r[0] as number),
      y: Float64Array.from(rows, (r) => r[1] as number),
      wavelengths: { ...fixture.wavelengths, polarisation: ip['Polariz.'] },
      phases: [
        {
          id: zno.id,
          name: zno.name,
          crystalSystem: zno.crystalSystem,
          cell: zno.cell,
          peaks,
          orientation: null,
          spaceGroupNumber: 186,
        },
      ],
      // GSAS-II's default size and microstrain broadening are in the simulation.
      choices: { ...DEFAULT_CHOICES, zero: false, size: true, strain: true },
      backgroundTerms: 6,
      atomicWeights,
      instrument: {
        u: ip.U * G,
        v: ip.V * G,
        w: ip.W * G,
        x: ip.X / 100,
        y: ip.Y / 100,
        shl: ip['SH/L'],
      },
    };
    return { id: `p${k}`, name: s.file, value: values[k] as number, input };
  });
}

const values = fixture.series.map((s) => s.value);
const cellOf = (p: SeriesPoint, key: 'a' | 'c') => {
  const cell = p.phases[0]?.cell;
  if (!cell) throw new Error(`${p.name}: ${p.error ?? 'no phase'}`);
  return cell[key];
};
const G2_KEY = { a: 'length_a', c: 'length_c' } as const;

describe('sequential refinement against GSAS-II (ZnO series)', () => {
  // One run shared by the checks below (five refinements).
  let forward: SeriesPoint[] = [];
  const series = () => {
    if (forward.length === 0) forward = refineSeries(items(values), true, refineRietveld);
    return forward;
  };

  it('every cell agrees with GSAS-II refining each pattern on its own, and with the truth', () => {
    const points = series();
    expect(points.map((p) => p.value)).toEqual(values);
    points.forEach((p, k) => {
      const theirs = fixture.oneByOne[k] as Fixture['oneByOne'][number];
      const truth = (fixture.series[k] as Fixture['series'][number]).cell;
      for (const key of ['a', 'c'] as const) {
        const ours = cellOf(p, key);
        const g2 = theirs.cell[G2_KEY[key]];
        const g2Esd = theirs.cellEsd[G2_KEY[key]];
        expect(Math.abs(ours.value - g2)).toBeLessThan(3 * Math.hypot(ours.esd, g2Esd));
        expect(Math.abs(ours.value - truth[G2_KEY[key]])).toBeLessThan(3 * ours.esd);
        // GSAS-II's s.u. of the hexagonal a is larger than the real scatter (Monte Carlo below),
        // so only c's s.u. is compared with GSAS-II's.
        if (key === 'c') {
          expect(ours.esd / g2Esd).toBeGreaterThan(0.9);
          expect(ours.esd / g2Esd).toBeLessThan(1.1);
        }
      }
      expect(Math.abs((p.stats?.rwp ?? 0) * 100 - theirs.Rwp) / theirs.Rwp).toBeLessThan(0.02);
    });
  }, 300_000);

  it('reports s.u. of a and c that match their real scatter (Monte Carlo, 40 noisy copies)', () => {
    // The pattern calculated from the fit of the first pattern, with Gaussian noise of variance
    // y (counting statistics), refined 40 times; seeded, so the run is repeatable.
    const item = items(values)[0] as SeriesItem;
    const first = refineRietveld(item.input);
    if (!first.ok) throw new Error(first.error);
    let seed = 12345;
    const uniform = () => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () =>
      Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
    const runs: { a: number; c: number }[] = [];
    for (let n = 0; n < 40; n++) {
      const y = Float64Array.from(first.calculated, (v) => Math.round(v + Math.sqrt(v) * gauss()));
      const r = refineRietveld({ ...item.input, x: Float64Array.from(first.x), y });
      if (!r.ok) throw new Error(r.error);
      const cell = (r.phases[0] as (typeof r.phases)[number]).cell;
      runs.push({ a: cell.a.value, c: cell.c.value });
    }
    const sd = (v: number[]) => {
      const m = v.reduce((t, x) => t + x, 0) / v.length;
      return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1));
    };
    const cell = (first.phases[0] as (typeof first.phases)[number]).cell;
    // With 40 runs the scatter itself is known to about 11 %.
    for (const key of ['a', 'c'] as const) {
      const ratio = cell[key].esd / sd(runs.map((r) => r[key]));
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.3);
    }
  }, 300_000);

  it('agrees with GSAS-II’s own sequential refinement', () => {
    if ('error' in fixture.sequential)
      throw new Error(`GSAS-II's sequential refinement failed in CI: ${fixture.sequential.error}`);
    const theirs = fixture.sequential;
    series().forEach((p, k) => {
      const g2 = theirs[k] as (typeof theirs)[number];
      for (const [key, i] of [
        ['a', 0],
        ['c', 2],
      ] as const) {
        const ours = cellOf(p, key);
        expect(Math.abs(ours.value - (g2.cell[i] as number))).toBeLessThan(
          3 * Math.hypot(ours.esd, g2.cellEsd[i] as number),
        );
      }
    });
  }, 300_000);

  it('the a(value) and c(value) lines agree with numpy on GSAS-II’s cells and with the truth', () => {
    const quantities = seriesQuantities(series());
    expect(quantities.map((q) => q.label).slice(0, 3)).toEqual([
      `${zno.name}: a`,
      `${zno.name}: c`,
      `${zno.name}: V`,
    ]);
    for (const key of ['a', 'c'] as const) {
      const line = fixture.lineFits[G2_KEY[key]];
      // Our fit on GSAS-II's numbers reproduces numpy.polyfit exactly (independent implementation).
      const same = weightedLinearFit(line.x, line.y, line.sigma);
      if (!same) throw new Error('no fit');
      const rel = (ours: number, theirs: number) =>
        expect(Math.abs(ours - theirs) / Math.abs(theirs)).toBeLessThan(1e-8);
      rel(same.slope, line.slope);
      rel(same.intercept, line.intercept);
      rel(same.slopeSigma, line.slopeSigma);
      rel(same.interceptSigma, line.interceptSigma);
      rel(same.slopeSigmaUnscaled, line.slopeSigmaUnscaled);
      rel(same.interceptSigmaUnscaled, line.interceptSigmaUnscaled);
      // Our line through our own refined cells: GSAS-II's slope, and the true slope.
      const q = quantities.find((qq) => qq.key === `${zno.id}:${key}`);
      if (!q) throw new Error(`no ${key}`);
      const est = q.values.map((v) => v as NonNullable<typeof v>);
      const fit = weightedLinearFit(
        values,
        est.map((e) => e.value),
        est.map((e) => e.esd),
      );
      if (!fit) throw new Error('no fit');
      const sigma = Math.max(fit.slopeSigma, fit.slopeSigmaUnscaled);
      expect(Math.abs(fit.slope - line.slope)).toBeLessThan(3 * Math.hypot(sigma, line.slopeSigma));
      const first = (fixture.series[0] as Fixture['series'][number]).cell[G2_KEY[key]];
      const trueSlope = first * fixture.expansion[key];
      expect(Math.abs(fit.slope - trueSlope)).toBeLessThan(3 * sigma);
    }
  }, 300_000);

  it('gives the same cells started from the CIF each time, or refined in the reverse order', () => {
    const fresh = refineSeries(items(values), false, refineRietveld);
    const reverse = refineSeries(items(values.map((v) => -v)), true, refineRietveld);
    const forwardById = new Map(series().map((p) => [p.id, p]));
    for (const other of [fresh, reverse])
      for (const p of other) {
        const ref = forwardById.get(p.id) as SeriesPoint;
        for (const key of ['a', 'c'] as const)
          expect(Math.abs(cellOf(p, key).value - cellOf(ref, key).value)).toBeLessThan(
            0.1 * cellOf(ref, key).esd,
          );
      }
    // The reverse run went from the largest cell down.
    expect(reverse.map((p) => p.id)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
  }, 600_000);
});
