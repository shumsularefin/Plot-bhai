import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type { Cell } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellFromParameters, cellKind, cellVolume } from '../src/core/xrd/rietveld/cell';
import {
  addProfiles,
  asymmetryFactor,
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  type PhaseModel,
  type PlacedPeak,
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
  /** Bérar–Baldinozzi P1, P2. */
  asymmetry?: [number, number];
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
    p[pl.asymmetry[0]] = t.asymmetry?.[0] ?? 0;
    p[pl.asymmetry[1]] = t.asymmetry?.[1] ?? 0;
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

describe('Bérar–Baldinozzi peak asymmetry', () => {
  it('has As(0) = 1, odd Fa and Fb, and Fa, Fb = H1, H3 Hermite polynomials × e^(−z²)', () => {
    expect(asymmetryFactor(0, 0.3, 0.2)).toBe(1);
    for (const z of [0.1, 0.5, 0.9, 1.7, 2.6]) {
      const fa = asymmetryFactor(z, 1, 0) - 1;
      const fb = asymmetryFactor(z, 0, 1) - 1;
      expect(asymmetryFactor(-z, 1, 0) - 1).toBeCloseTo(-fa, 14);
      expect(asymmetryFactor(-z, 0, 1) - 1).toBeCloseTo(-fb, 14);
      expect(fa).toBeCloseTo(2 * z * Math.exp(-z * z), 14);
      expect(fb).toBeCloseTo((8 * z ** 3 - 12 * z) * Math.exp(-z * z), 14);
    }
  });

  it('moves intensity between the sides of a peak without changing its area', () => {
    const x = Float64Array.from({ length: 40001 }, (_, i) => 20 + i * 0.0005);
    const base: PlacedPeak = {
      phase: 0,
      reflection: 0,
      twoTheta: 30.0123,
      area: 1000,
      areaPerMf2: 1000,
      fwhm: 0.2,
      eta: 0.4,
      asymmetry: [0, 0],
      line: 0,
      d: 1,
      mf2: 1,
    };
    const symmetric = new Float64Array(x.length);
    addProfiles(x, [base], symmetric);
    const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0) * 0.0005;
    const centroid = (a: Float64Array) =>
      a.reduce((s, v, i) => s + v * (x[i] as number), 0) / a.reduce((s, v) => s + v, 0);
    for (const asymmetry of [
      [-0.3, 0],
      [0.2, 0.05],
      [0, -0.04],
    ] as [number, number][]) {
      const lopsided = new Float64Array(x.length);
      addProfiles(x, [{ ...base, asymmetry }], lopsided);
      expect(Math.abs(sum(lopsided) - sum(symmetric)) / sum(symmetric)).toBeLessThan(1e-9);
      expect(Math.abs(centroid(lopsided) - centroid(symmetric))).toBeGreaterThan(1e-4);
    }
    // a < 0 moves intensity to the low-angle side: the centroid shifts down.
    const low = new Float64Array(x.length);
    addProfiles(x, [{ ...base, asymmetry: [-0.3, 0] }], low);
    expect(centroid(low)).toBeLessThan(centroid(symmetric));
  });

  const ceria = phase('ceo2', 'ceo2');
  const truth = (asymmetry?: [number, number]): TruePhase[] => [
    {
      ref: ceria,
      cell: { ...ceria.cell },
      scale: 2e-4,
      u: 0,
      v: 0,
      w: 0.008,
      eta: 0.4,
      ...(asymmetry && { asymmetry }),
    },
  ];
  const refine = (x: Float64Array, y: Float64Array, asymmetry: boolean) =>
    refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [input(ceria)],
      choices: { ...DEFAULT_CHOICES, widthSlope: false, asymmetry },
      backgroundTerms: 4,
      atomicWeights,
    });

  it('is off by default and leaves P1 = P2 = 0 fixed', () => {
    expect(DEFAULT_CHOICES.asymmetry).toBe(false);
    const { x, y } = synthetic(truth(), 0);
    const result = refine(x, y, false);
    if (!result.ok) throw new Error(result.error);
    expect(result.phases[0]?.asymmetry.map((e) => [e.value, e.esd, e.refined])).toEqual([
      [0, 0, false],
      [0, 0, false],
    ]);
  });

  it('recovers P1 and P2 from a pattern made with them, and improves R_wp', () => {
    const { x, y } = synthetic(truth([-0.04, 0.006]), 0, 0.01, 20, 90);
    const result = refine(x, y, true);
    const without = refine(x, y, false);
    if (!result.ok || !without.ok) throw new Error('refinement failed');
    const [p1, p2] = result.phases[0]?.asymmetry ?? [];
    if (!p1 || !p2) throw new Error('no asymmetry');
    expect(Math.abs(p1.value + 0.04)).toBeLessThan(4 * p1.esd + 2e-3);
    expect(Math.abs(p2.value - 0.006)).toBeLessThan(4 * p2.esd + 1e-3);
    expect(result.stats.chi2).toBeLessThan(1.15);
    expect(result.stats.rwp).toBeLessThan(without.stats.rwp);
  });

  it('refines to zero, within its uncertainty, on symmetric peaks', () => {
    const { x, y } = synthetic(truth(), 0, 0.01, 20, 90);
    const result = refine(x, y, true);
    if (!result.ok) throw new Error(result.error);
    for (const e of result.phases[0]?.asymmetry ?? []) {
      expect(Math.abs(e.value)).toBeLessThan(4 * e.esd);
    }
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
