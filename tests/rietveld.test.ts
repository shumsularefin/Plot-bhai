import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type { Cell } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellFromParameters, cellKind, cellVolume } from '../src/core/xrd/rietveld/cell';
import {
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  type PhaseModel,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import {
  cellMass,
  DEFAULT_CHOICES,
  refineRietveld,
  weightFractions,
  type RietveldPhaseInput,
} from '../src/core/xrd/rietveld/refine';
import { withUncertainty } from '../src/core/xrd/rietveld/report';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const phase = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;
const weightsFile = json('data/thermal/atomic-weights.json') as {
  elements: { symbol: string; weight: number }[];
};
const atomicWeights = Object.fromEntries(weightsFile.elements.map((e) => [e.symbol, e.weight]));

const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };

/** Deterministic normal deviates (Park–Miller generator, Box–Muller transform). */
function noise(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

interface TruePhase {
  ref: ReferencePhase;
  cell: Cell;
  scale: number;
  u: number;
  v: number;
  w: number;
  eta: number;
  /** March–Dollase direction and r. */
  orientation?: { direction: [number, number, number]; r: number };
}

/**
 * A measured pattern made with the model itself: known cells, zero shift, widths and scales,
 * a sloping background, and counting noise (normal with variance y, close to Poisson).
 */
function synthetic(truth: TruePhase[], zero: number, step = 0.02, from = 20, to = 90) {
  const x = Float64Array.from(
    { length: Math.round((to - from) / step) + 1 },
    (_, i) => from + i * step,
  );
  const models: PhaseModel[] = truth.map((t) => {
    const kind = cellKind(t.ref.crystalSystem, t.ref.cell);
    return {
      id: t.ref.id,
      name: t.ref.name,
      kind,
      cell: t.ref.cell,
      reflections: refinementReflections(t.ref.peaks, t.ref.cell, kind, 0.8),
      orientation: t.orientation?.direction ?? null,
    };
  });
  const layout = makeLayout(models, 3);
  const p = new Float64Array(layout.size);
  p[layout.zero] = zero;
  p[layout.background[0] as number] = 200;
  p[layout.background[1] as number] = -40;
  truth.forEach((t, k) => {
    const pl = layout.phases[k] as (typeof layout.phases)[number];
    const kind = models[k]?.kind as PhaseModel['kind'];
    const names = kind === 'cubic' ? (['a'] as const) : (['a', 'c'] as const);
    names.forEach((name, i) => (p[pl.cell[i] as number] = t.cell[name]));
    expect(
      cellFromParameters(
        kind,
        pl.cell.map((j) => p[j] as number),
        t.ref.cell,
      ),
    ).toEqual(t.cell);
    p[pl.scale] = t.scale;
    p[pl.u] = t.u;
    p[pl.v] = t.v;
    p[pl.w] = t.w;
    p[pl.eta] = t.eta;
    p[pl.orientation] = t.orientation?.r ?? 1;
  });
  const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
  const parts = models.map((_, k) => phaseCurve(x, models, layout, k, p, CU));
  const gauss = noise(12345);
  const y = x.map((_, i) => {
    const mean = (bg[i] as number) + parts.reduce((s, part) => s + (part[i] as number), 0);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  });
  return { x, y };
}

const input = (ref: ReferencePhase): RietveldPhaseInput => ({
  id: ref.id,
  name: ref.name,
  crystalSystem: ref.crystalSystem,
  cell: ref.cell,
  peaks: ref.peaks,
  ...(ref.cellContents && { cellContents: ref.cellContents }),
  orientation: null,
});

describe('Rietveld building blocks', () => {
  it('keeps the symmetry of the cell', () => {
    expect(cellKind('trigonal', { a: 4.9, b: 4.9, c: 5.4, alpha: 90, beta: 90, gamma: 120 })).toBe(
      'hexagonal',
    );
    expect(cellKind('trigonal', { a: 5.4, b: 5.4, c: 5.4, alpha: 55, beta: 55, gamma: 55 })).toBe(
      'rhombohedral',
    );
    expect(cellKind('monoclinic', { a: 5, b: 6, c: 7, alpha: 90, beta: 101, gamma: 90 })).toBe(
      'monoclinic-beta',
    );
    expect(cellVolume({ a: 2, b: 3, c: 4, alpha: 90, beta: 90, gamma: 90 })).toBeCloseTo(24, 12);
    // Hexagonal: V = (√3/2) a² c.
    expect(cellVolume({ a: 3, b: 3, c: 5, alpha: 90, beta: 90, gamma: 120 })).toBeCloseTo(
      (Math.sqrt(3) / 2) * 9 * 5,
      10,
    );
  });

  it('splits each line into families with all their members', () => {
    const ceria = phase('ceo2', 'ceo2');
    const reflections = refinementReflections(ceria.peaks, ceria.cell, 'cubic', 1.0);
    // Cubic {111}: 8 reflections. {511} and {333} (d = 1.04 Å) coincide in every cubic cell, so
    // they stay one group of 24 + 8 reflections.
    expect(reflections[0]?.members).toHaveLength(8);
    const mixed = reflections.find((r) => r.members.some((m) => m.join() === '3,3,3'));
    expect(mixed?.members).toHaveLength(32);
    expect(mixed?.members.some((m) => m.join() === '5,1,1')).toBe(true);
    // Every stored multiplicity is matched by the members found.
    const lines = ceria.peaks.filter((p) => p.d >= 1.0);
    const total = reflections.reduce((s, r) => s + r.members.length, 0);
    expect(total).toBe(lines.reduce((s, p) => s + p.m, 0));
  });

  it('computes Hill–Howard weight fractions and their uncertainties', () => {
    // Equal S·ZMV gives 50/50; uncorrelated scale uncertainties propagate to W.
    const [w1, w2] = weightFractions([2, 1], [1, 2], [0.01, 0, 0, 0.0025]);
    expect(w1?.value).toBeCloseTo(0.5, 12);
    expect(w2?.value).toBeCloseTo(0.5, 12);
    // ∂W1/∂S1 = a1 S2 a2 / T² = 2/16, ∂W1/∂S2 = −S1 a1 a2 / T² = −4/16.
    const expected = Math.sqrt((2 / 16) ** 2 * 0.01 + (4 / 16) ** 2 * 0.0025);
    expect(w1?.esd).toBeCloseTo(expected, 12);
    // ZM of CeO2 cell (Z = 4): 4 × 172.114 g/mol.
    expect(cellMass({ Ce: 4, O: 8 }, atomicWeights)).toBeCloseTo(
      4 * (atomicWeights['Ce'] as number) + 8 * (atomicWeights['O'] as number),
      9,
    );
  });
});

describe('Rietveld refinement of synthetic patterns', () => {
  it('recovers the cell, zero shift and widths of one phase', () => {
    const ceria = phase('ceo2', 'ceo2');
    const a = ceria.cell.a * 1.004;
    const { x, y } = synthetic(
      [
        {
          ref: ceria,
          cell: { ...ceria.cell, a, b: a, c: a },
          scale: 2e-4,
          u: 0.004,
          v: -0.002,
          w: 0.006,
          eta: 0.4,
        },
      ],
      0.05,
    );
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [input(ceria)],
      choices: DEFAULT_CHOICES,
      backgroundTerms: 4,
      atomicWeights,
    });
    if (!result.ok) throw new Error(result.error);
    const fit = result.phases[0];
    expect(fit?.cell.a.value).toBeCloseTo(a, 3);
    expect(Math.abs((fit?.cell.a.value ?? 0) - a)).toBeLessThan(4 * (fit?.cell.a.esd ?? 0) + 2e-5);
    expect(result.zero.value).toBeCloseTo(0.05, 2);
    expect(fit?.eta.value).toBeCloseTo(0.4, 1);
    // Counting noise only: χ² near 1.
    expect(result.stats.chi2).toBeGreaterThan(0.9);
    expect(result.stats.chi2).toBeLessThan(1.15);
    expect(result.stats.rwp).toBeLessThan(0.1);
  });

  it('recovers weight fractions of a two-phase mixture', () => {
    const anatase = phase('tio2', 'anatase');
    const rutile = phase('tio2', 'rutile');
    const truth: TruePhase[] = [
      { ref: anatase, cell: { ...anatase.cell }, scale: 2.4e-3, u: 0, v: 0, w: 0.01, eta: 0.5 },
      { ref: rutile, cell: { ...rutile.cell }, scale: 3e-3, u: 0, v: 0, w: 0.008, eta: 0.5 },
    ];
    const { x, y } = synthetic(truth, 0);
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [input(anatase), input(rutile)],
      choices: { ...DEFAULT_CHOICES, widthSlope: false },
      backgroundTerms: 4,
      atomicWeights,
    });
    if (!result.ok) throw new Error(result.error);
    const masses = truth.map((t) => cellMass(t.ref.cellContents, atomicWeights) as number);
    const zmv = truth.map((t, k) => t.scale * (masses[k] as number) * cellVolume(t.cell));
    const expected = (zmv[0] as number) / ((zmv[0] as number) + (zmv[1] as number));
    const anataseFraction = result.phases[0]?.weightFraction;
    expect(anataseFraction?.value).toBeCloseTo(expected, 2);
    expect(Math.abs((anataseFraction?.value ?? 0) - expected)).toBeLessThan(
      4 * (anataseFraction?.esd ?? 0) + 1e-3,
    );
    expect(result.phases[0]?.rBragg).toBeLessThan(0.05);
  });

  it('recovers a tetragonal cell that starts 0.6 % off, and March–Dollase r', () => {
    const anatase = phase('tio2', 'anatase');
    const cell = {
      ...anatase.cell,
      a: anatase.cell.a * 1.006,
      b: anatase.cell.a * 1.006,
      c: anatase.cell.c * 0.997,
    };
    const { x, y } = synthetic(
      [
        {
          ref: anatase,
          cell,
          scale: 2e-3,
          u: 0,
          v: 0,
          w: 0.01,
          eta: 0.5,
          orientation: { direction: [0, 0, 1], r: 0.8 },
        },
      ],
      -0.03,
    );
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [{ ...input(anatase), orientation: [0, 0, 1] }],
      choices: { ...DEFAULT_CHOICES, widthSlope: false, orientation: true },
      backgroundTerms: 4,
      atomicWeights,
    });
    if (!result.ok) throw new Error(result.error);
    const fit = result.phases[0];
    expect(fit?.cell.a.value).toBeCloseTo(cell.a, 3);
    expect(fit?.cell.c.value).toBeCloseTo(cell.c, 3);
    expect(fit?.orientation?.value).toBeCloseTo(0.8, 2);
    expect(result.zero.value).toBeCloseTo(-0.03, 2);
    expect(result.stats.chi2).toBeLessThan(1.15);
  });

  it('refuses a phase with no lines in range and reports problems plainly', () => {
    const ceria = phase('ceo2', 'ceo2');
    const x = Float64Array.from({ length: 200 }, (_, i) => 5 + i * 0.01);
    const result = refineRietveld({
      x,
      y: new Float64Array(200).fill(100),
      wavelengths: CU,
      phases: [input(ceria)],
      choices: DEFAULT_CHOICES,
      backgroundTerms: 3,
      atomicWeights,
    });
    expect(result.ok).toBe(false);
  });
});

describe('Rietveld report text', () => {
  it('writes values with uncertainties in the crystallographic notation', () => {
    expect(withUncertainty(3.795861, 0.000031)).toBe('3.79586(3)');
    expect(withUncertainty(3.795861, 0.000014)).toBe('3.795861(14)');
    expect(withUncertainty(0.76795, 0.0196)).toBe('0.77(2)');
    expect(withUncertainty(76.795, 0.1)).toBe('76.80(10)');
    expect(withUncertainty(136.8126, 3)).toBe('137(3)');
    expect(withUncertainty(5.411, 0)).toBe('5.41100');
    expect(withUncertainty(5.411, NaN)).toBe('5.41100 (s.u. not available)');
  });
});
