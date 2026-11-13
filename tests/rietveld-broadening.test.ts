// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import { reciprocalMetric, type Cell } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import {
  cosAngle,
  stephensFromIsotropic,
  stephensStrain,
  uniaxialInverseSize,
  uniaxialStrain,
  type LaueClass,
} from '../src/core/xrd/rietveld/broadening';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import { fcjNodes } from '../src/core/xrd/rietveld/fcj';
import {
  addProfiles,
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  type PhaseModel,
  type PlacedPeak,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections, type Hkl } from '../src/core/xrd/rietveld/reflections';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

/*
 * Synthetic and invariance checks of 17c (fcj.ts, broadening.ts). The comparison with GSAS-II is in
 * validation-gsas2-anisotropic.test.ts.
 */
const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };

const profile = (twoTheta: number, shl: number, fwhm = 0.08, eta = 0.5) => {
  const x = Float64Array.from({ length: 40001 }, (_, i) => twoTheta - 4 + i * 0.0002);
  const fcj = fcjNodes(twoTheta, shl, eta * fwhm);
  const peak: PlacedPeak = {
    phase: 0,
    reflection: 0,
    twoTheta,
    area: 1,
    areaPerMf2: 1,
    orientation: 1,
    fwhm,
    eta,
    asymmetry: [0, 0],
    line: 0,
    d: 1,
    mf2: 1,
    reach: 4,
    ...(fcj && { fcj, fcjReach: 4 }),
  };
  const y = new Float64Array(x.length);
  addProfiles(x, [peak], y);
  return { x, y };
};
const area = ({ y }: { y: Float64Array }) => y.reduce((s, v) => s + v, 0) * 0.0002;
const centroid = ({ x, y }: { x: Float64Array; y: Float64Array }) =>
  y.reduce((s, v, i) => s + v * (x[i] as number), 0) / y.reduce((s, v) => s + v, 0);

describe('Finger–Cox–Jephcoat axial divergence (synthetic)', () => {
  it('keeps unit area (the weights sum to 1)', () => {
    for (const [t, shl] of [
      [10, 0.03],
      [30, 0.01],
      [70, 0.05],
      [140, 0.03],
    ] as const) {
      const nodes = fcjNodes(t, shl, 0.04);
      expect(nodes?.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
      // A pseudo-Voigt cut at ±4° keeps about 99.4 % of its area; the FCJ profile the same.
      expect(Math.abs(area(profile(t, shl)) - area(profile(t, 0)))).toBeLessThan(1e-4);
    }
  });

  it('is the symmetric pseudo-Voigt for SH/L = 0, and tends to it as SH/L → 0', () => {
    expect(fcjNodes(30, 0, 0.04)).toBeNull();
    const a = profile(30, 1e-5);
    const b = profile(30, 0);
    let worst = 0;
    a.y.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - (b.y[i] as number)))));
    expect(worst / Math.max(...b.y)).toBeLessThan(1e-4);
  });

  it('moves weight to lower angles below 90° and to higher angles above, mirror-symmetric', () => {
    const low = profile(40, 0.04);
    const high = profile(140, 0.04);
    expect(centroid(low)).toBeLessThan(40);
    expect(centroid(high)).toBeGreaterThan(140);
    // 2θ and 180° − 2θ give mirror images (cos 2θ changes sign).
    expect(40 - centroid(low)).toBeCloseTo(centroid(high) - 140, 6);
    // More axial divergence, more shift; less at higher angle (below 90°).
    const shift = (t: number, shl: number) => t - centroid(profile(t, shl));
    expect(shift(40, 0.04)).toBeGreaterThan(shift(40, 0.02));
    expect(shift(40, 0.02)).toBeGreaterThan(shift(40, 0.01));
    expect(shift(20, 0.03)).toBeGreaterThan(shift(60, 0.03));
  });
});

const hexagonal: Cell = { a: 3.25, b: 3.25, c: 5.21, alpha: 90, beta: 90, gamma: 120 };
const metrics: [LaueClass, Cell][] = [
  ['m3m', { a: 5.4, b: 5.4, c: 5.4, alpha: 90, beta: 90, gamma: 90 }],
  ['6/mmm', hexagonal],
  ['31m', hexagonal],
  ['4/mmm', { a: 4.6, b: 4.6, c: 2.96, alpha: 90, beta: 90, gamma: 90 }],
  ['mmm', { a: 5.1, b: 6.3, c: 7.4, alpha: 90, beta: 90, gamma: 90 }],
  ['2/m-b', { a: 5.1, b: 6.3, c: 7.4, alpha: 90, beta: 104, gamma: 90 }],
  ['-1', { a: 5.1, b: 6.3, c: 7.4, alpha: 84, beta: 104, gamma: 97 }],
];
const hkls: Hkl[] = [];
for (let h = -3; h <= 3; h++)
  for (let k = -3; k <= 3; k++) for (let l = 0; l <= 3; l++) if (h || k || l) hkls.push([h, k, l]);
const dOf = (gStar: readonly number[], hkl: Hkl) => 1 / Math.sqrt(cosNorm(gStar, hkl));
const cosNorm = (g: readonly number[], v: Hkl) => {
  let s = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) s += (v[i] as number) * (g[i * 3 + j] as number) * (v[j] as number);
  return s;
};

describe('Anisotropic broadening models (invariance)', () => {
  it.each(metrics)(
    'Stephens coefficients from an isotropic μ give that μ everywhere (%s)',
    (laue, cell) => {
      const gStar = reciprocalMetric(cell);
      const s = stephensFromIsotropic(laue, 1500, gStar, hkls);
      for (const hkl of hkls)
        expect(stephensStrain(laue, s, hkl, dOf(gStar, hkl))).toBeCloseTo(1500, 6);
    },
  );

  it('gives symmetry-equivalent reflections the same Stephens strain (6/mmm, m3m)', () => {
    const gStar = reciprocalMetric(hexagonal);
    const s = [12000, 4000, 3000];
    const strain = (hkl: Hkl) => stephensStrain('6/mmm', s, hkl, dOf(gStar, hkl));
    // (1 0 2) and its images under the 6-fold axis and the mirrors of 6/mmm.
    for (const hkl of [
      [0, 1, 2],
      [-1, 1, 2],
      [-1, 0, 2],
      [1, -1, 2],
      [1, 0, -2],
      [1, 1, 2].map((v, i) => (i < 2 ? 0 : v)),
    ] as Hkl[])
      if (hkl[0] || hkl[1]) expect(strain(hkl)).toBeCloseTo(strain([1, 0, 2]), 9);
    const cubic = reciprocalMetric(metrics[0]?.[1] as Cell);
    const c = [9000, -2000];
    const cs = (hkl: Hkl) => stephensStrain('m3m', c, hkl, dOf(cubic, hkl));
    for (const hkl of [
      [2, 3, 1],
      [3, 1, 2],
      [-1, 2, -3],
    ] as Hkl[])
      expect(cs(hkl)).toBeCloseTo(cs([1, 2, 3]), 9);
  });

  it('uniaxial models: equal values are isotropic; along and across the axis give each value', () => {
    for (const cos of [0, 0.3, 0.8, 1]) {
      expect(uniaxialInverseSize(0.02, 0.02, cos)).toBeCloseTo(0.02, 14);
      expect(uniaxialStrain(900, 900, cos)).toBeCloseTo(900, 9);
    }
    expect(uniaxialInverseSize(0.02, 0.005, 1)).toBeCloseTo(0.005, 14);
    expect(uniaxialInverseSize(0.02, 0.005, 0)).toBeCloseTo(0.02, 14);
    expect(uniaxialStrain(800, 2500, 1)).toBeCloseTo(2500, 9);
    expect(uniaxialStrain(800, 2500, 0)).toBeCloseTo(800, 9);
    // cos φ in the reciprocal metric: (0 0 1) is along c*, (1 0 0) perpendicular to it (hexagonal).
    const gStar = reciprocalMetric(hexagonal);
    expect(cosAngle(gStar, [0, 0, 2], [0, 0, 1])).toBeCloseTo(1, 14);
    expect(cosAngle(gStar, [1, 0, 0], [0, 0, 1])).toBeCloseTo(0, 14);
    // (1 0 0) and (1 1 0) are 30° apart in the hexagonal reciprocal lattice.
    expect(cosAngle(gStar, [1, 0, 0], [1, 1, 0])).toBeCloseTo(Math.cos(Math.PI / 6), 12);
  });
});

describe('Recovery of known anisotropic broadening from a synthetic pattern', () => {
  it('uniaxial microstrain along [0 0 1] of ZnO, noise-free, with SH/L refined', () => {
    const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
      (p) => p.id === 'zno-wurtzite',
    ) as ReferencePhase;
    const kind = cellKind(zno.crystalSystem, zno.cell);
    const model: PhaseModel = {
      id: zno.id,
      name: zno.name,
      kind,
      cell: zno.cell,
      reflections: refinementReflections(zno.peaks, zno.cell, kind, 0.8),
      orientation: null,
      tch: true,
      sample: true,
      strainModel: 'uniaxial',
      strainAxis: [0, 0, 1],
    };
    const instrument = { u: 0.004, v: -0.002, w: 0.003, x: 0.02, y: 0.01 };
    const truth = { shl: 0.025, size: 80, equatorial: 600, axial: 2200 };
    const x = Float64Array.from({ length: 5001 }, (_, i) => 25 + i * 0.02);
    const layout = makeLayout([model], 3);
    const p = new Float64Array(layout.size);
    const pl = layout.phases[0] as (typeof layout.phases)[number];
    p[layout.background[0] as number] = 200;
    p[layout.axial] = truth.shl;
    p[pl.cell[0] as number] = zno.cell.a;
    p[pl.cell[1] as number] = zno.cell.c;
    p[pl.scale] = 0.05;
    p[pl.u] = instrument.u;
    p[pl.v] = instrument.v;
    p[pl.w] = instrument.w;
    p[pl.lx] = instrument.x;
    p[pl.ly] = instrument.y;
    p[pl.orientation] = 1;
    p[pl.inverseSize] = 1 / truth.size;
    p[pl.microstrain] = truth.equatorial;
    p[pl.microstrainAxial] = truth.axial;
    p[pl.sizeMix] = 1;
    p[pl.strainMix] = 1;
    const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
    const curve = phaseCurve(x, [model], layout, 0, p, CU);
    const y = x.map((_, i) => (bg[i] as number) + (curve[i] as number));
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [
        {
          id: zno.id,
          name: zno.name,
          crystalSystem: zno.crystalSystem,
          cell: zno.cell,
          peaks: zno.peaks,
          orientation: null,
          spaceGroupNumber: 186,
          strainAxis: [0, 0, 1],
        },
      ],
      choices: {
        ...DEFAULT_CHOICES,
        zero: false,
        size: true,
        strain: true,
        strainModel: 'uniaxial',
        axialDivergence: true,
      },
      backgroundTerms: 3,
      atomicWeights,
      instrument,
    });
    if (!result.ok) throw new Error(result.error);
    const fit = result.phases[0];
    expect(result.axial.value).toBeCloseTo(truth.shl, 4);
    expect(fit?.size?.value).toBeCloseTo(truth.size, 1);
    expect(fit?.microstrain?.value).toBeCloseTo(truth.equatorial, 0);
    expect(fit?.microstrainAxial?.value).toBeCloseTo(truth.axial, 0);
    expect(fit?.strainAxis).toEqual([0, 0, 1]);
    expect(result.stats.rwp).toBeLessThan(1e-3);
  }, 120_000);
});
