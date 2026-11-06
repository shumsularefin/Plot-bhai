// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tchExact } from '../src/core/xrd/export/gsas';
import { ANODES } from '../src/core/xrd/radiation';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import {
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  placePeaks,
  type PhaseModel,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import { tchEta, tchFwhm } from '../src/core/xrd/rietveld/tch';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const ceria = (json('tests/fixtures/cod-reference/ceo2.json') as ReferenceFamilyFile).phases.find(
  (p) => p.id === 'ceo2',
) as ReferencePhase;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };
const TRUTH = { u: 0.006, v: -0.003, w: 0.004, x: 0.03, y: 0.02 };

function noise(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

function pattern() {
  const kind = cellKind(ceria.crystalSystem, ceria.cell);
  const model: PhaseModel = {
    id: ceria.id,
    name: ceria.name,
    kind,
    cell: ceria.cell,
    reflections: refinementReflections(ceria.peaks, ceria.cell, kind, 0.8),
    orientation: null,
    tch: true,
  };
  const x = Float64Array.from({ length: 3501 }, (_, i) => 20 + i * 0.02);
  const layout = makeLayout([model], 3);
  const p = new Float64Array(layout.size);
  p[layout.background[0] as number] = 200;
  const pl = layout.phases[0] as (typeof layout.phases)[number];
  p[pl.cell[0] as number] = ceria.cell.a;
  p[pl.scale] = 2e-4;
  p[pl.u] = TRUTH.u;
  p[pl.v] = TRUTH.v;
  p[pl.w] = TRUTH.w;
  p[pl.lx] = TRUTH.x;
  p[pl.ly] = TRUTH.y;
  p[pl.orientation] = 1;
  const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
  const curve = phaseCurve(x, [model], layout, 0, p, CU);
  const gauss = noise(4242);
  const y = x.map((_, i) => {
    const mean = (bg[i] as number) + (curve[i] as number);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  });
  return { x, y, peaks: placePeaks([model], layout, 0, p, CU) };
}

describe('Thompson–Cox–Hastings profile', () => {
  it('gives each peak the TCH width and η of its Gaussian and Lorentzian parts', () => {
    const { peaks } = pattern();
    for (const peak of peaks.filter((q) => q.line === 0)) {
      const theta = (peak.twoTheta * Math.PI) / 180 / 2;
      const t = Math.tan(theta);
      const hg = Math.sqrt(TRUTH.u * t * t + TRUTH.v * t + TRUTH.w);
      const hl = TRUTH.x / Math.cos(theta) + TRUTH.y * t;
      expect(peak.fwhm).toBeCloseTo(tchFwhm(hg, hl), 6);
      expect(peak.eta).toBeCloseTo(tchEta(hl / peak.fwhm), 6);
      // The TCH width lies between the larger part and the sum of both (Voigt property).
      expect(peak.fwhm).toBeGreaterThanOrEqual(Math.max(hg, hl) - 1e-9);
      expect(peak.fwhm).toBeLessThanOrEqual(hg + hl + 1e-9);
    }
  });

  it('recovers U, V, W, X and Y from a synthetic pattern', () => {
    const { x, y } = pattern();
    const result = refineRietveld({
      x,
      y,
      wavelengths: CU,
      phases: [
        {
          id: ceria.id,
          name: ceria.name,
          crystalSystem: ceria.crystalSystem,
          cell: ceria.cell,
          peaks: ceria.peaks,
          orientation: null,
        },
      ],
      choices: { ...DEFAULT_CHOICES, zero: false, tch: true },
      backgroundTerms: 3,
      atomicWeights,
    });
    if (!result.ok) throw new Error(result.error);
    const fit = result.phases[0];
    if (!fit) throw new Error('no phase');
    expect(fit.tch).toBe(true);
    for (const [k, est] of [
      ['u', fit.u],
      ['v', fit.v],
      ['w', fit.w],
      ['x', fit.x],
      ['y', fit.y],
    ] as const)
      expect(Math.abs(est.value - TRUTH[k])).toBeLessThan(4 * est.esd + 1e-4);
    expect(result.stats.chi2).toBeLessThan(1.15);
  }, 60_000);

  it('exports exactly to GSAS-II units', () => {
    const g = tchExact(TRUTH);
    // σ² (centideg²) × 8 ln 2 / 10⁴ = H_G² (deg²); γ (centideg) / 100 = H_L (deg).
    expect((g.w * 8 * Math.LN2) / 1e4).toBeCloseTo(TRUTH.w, 12);
    expect(g.x / 100).toBeCloseTo(TRUTH.x, 12);
    expect(g.fwhmError).toBe(0);
  });
});
