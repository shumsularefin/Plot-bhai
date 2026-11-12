// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import {
  backgroundCurve,
  chebyshevBasis,
  makeLayout,
  phaseCurve,
  type PhaseModel,
  type Wavelengths,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import {
  DEFAULT_CHOICES,
  refineRietveld,
  type RefineChoices,
  type RietveldResult,
} from '../src/core/xrd/rietveld/refine';
import {
  braggTwoTheta,
  monochromatorFraction,
  polarisation,
  sampleWidths,
  surfaceRoughness,
  transparencyShift,
  variableSlitFactor,
} from '../src/core/xrd/rietveld/sample';
import {
  durbinWatson,
  internalStandard,
  strongCorrelations,
} from '../src/core/xrd/rietveld/statistics';
import { weightFractions } from '../src/core/xrd/rietveld/refine';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const phaseOf = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;
const ceria = phaseOf('ceo2', 'ceo2');
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const CU = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };
const RAD = Math.PI / 180;
/** Instrument profile (TCH, degrees), as from a standard. */
const INSTRUMENT = { u: 0.004, v: -0.002, w: 0.003, x: 0.02, y: 0.01 };

function noise(seed: number) {
  let state = seed;
  const uniform = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

interface Truth {
  inverseSize?: number;
  microstrain?: number;
  transparency?: number;
  roughness?: [number, number];
  orientation?: number;
  scale?: number;
}

/** A CeO2 pattern from the model itself, with Poisson-like noise. */
function ceriaPattern(truth: Truth, beam: Wavelengths = CU, seed = 99) {
  const kind = cellKind(ceria.crystalSystem, ceria.cell);
  const model: PhaseModel = {
    id: ceria.id,
    name: ceria.name,
    kind,
    cell: ceria.cell,
    reflections: refinementReflections(ceria.peaks, ceria.cell, kind, 0.8),
    orientation: truth.orientation ? [1, 1, 1] : null,
    tch: true,
    sample: true,
  };
  const x = Float64Array.from({ length: 4001 }, (_, i) => 20 + i * 0.02);
  const layout = makeLayout([model], 3);
  const p = new Float64Array(layout.size);
  p[layout.background[0] as number] = 150;
  p[layout.background[1] as number] = -20;
  p[layout.transparency] = truth.transparency ?? 0;
  p[layout.roughness[0]] = truth.roughness?.[0] ?? 0;
  p[layout.roughness[1]] = truth.roughness?.[1] ?? 0;
  const pl = layout.phases[0] as (typeof layout.phases)[number];
  p[pl.cell[0] as number] = ceria.cell.a * 1.0004;
  p[pl.scale] = truth.scale ?? 2e-4;
  p[pl.u] = INSTRUMENT.u;
  p[pl.v] = INSTRUMENT.v;
  p[pl.w] = INSTRUMENT.w;
  p[pl.lx] = INSTRUMENT.x;
  p[pl.ly] = INSTRUMENT.y;
  p[pl.inverseSize] = truth.inverseSize ?? 0;
  p[pl.microstrain] = truth.microstrain ?? 0;
  p[pl.sizeMix] = 1;
  p[pl.strainMix] = 1;
  p[pl.orientation] = truth.orientation ?? 1;
  const bg = backgroundCurve(chebyshevBasis(x, 3), layout, p, x.length);
  const curve = phaseCurve(x, [model], layout, 0, p, beam);
  const gauss = noise(seed);
  const y = x.map((_, i) => {
    const mean = (bg[i] as number) + (curve[i] as number);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()));
  });
  return { x, y, cellA: ceria.cell.a * 1.0004 };
}

const ceriaInput = (leBail = false) => ({
  id: ceria.id,
  name: ceria.name,
  crystalSystem: ceria.crystalSystem,
  cell: ceria.cell,
  peaks: ceria.peaks,
  orientation: null,
  ...(leBail && { leBail: true }),
});

function refine(
  pattern: { x: Float64Array; y: Float64Array },
  choices: Partial<RefineChoices>,
  extra: Partial<Parameters<typeof refineRietveld>[0]> = {},
): RietveldResult {
  const result = refineRietveld({
    x: pattern.x,
    y: pattern.y,
    wavelengths: CU,
    phases: [ceriaInput()],
    choices: { ...DEFAULT_CHOICES, zero: false, ...choices },
    backgroundTerms: 3,
    atomicWeights,
    ...extra,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

const within = (value: number, truth: number, esd: number, floor = 0) =>
  expect(Math.abs(value - truth)).toBeLessThanOrEqual(4 * esd + floor);

describe('Instrument and sample corrections (sample.ts)', () => {
  it('polarisation: P = 0.5 is 1 + cos²2θ, and equals the monochromator formula', () => {
    for (const t of [10, 25, 40, 60, 80]) {
      const theta = t * RAD;
      const c2 = Math.cos(2 * theta) ** 2;
      expect(polarisation(0.5, theta)).toBeCloseTo(1 + c2, 14);
      // GSAS-II Polarization(), azimuth 0: (1 − P) cos²2θ + P (times 2 here).
      expect(polarisation(0.7, theta)).toBeCloseTo(2 * (0.3 * c2 + 0.7), 14);
      // Mosaic monochromator: (1 + cos²2θm cos²2θ)/(1 + cos²2θm), up to the factor 2.
      const m = 26.6 * RAD;
      const k = Math.cos(m) ** 2;
      expect(polarisation(monochromatorFraction(26.6, false), theta) / 2).toBeCloseTo(
        (1 + k * c2) / (1 + k),
        14,
      );
      expect(polarisation(monochromatorFraction(27.3, true), theta) / 2).toBeCloseTo(
        (1 + Math.cos(27.3 * RAD) * c2) / (1 + Math.cos(27.3 * RAD)),
        14,
      );
    }
    // 2θm = 0 is no polarisation by the monochromator (unpolarised result, P = 0.5).
    expect(monochromatorFraction(0, false)).toBe(0.5);
    // Graphite 002 (d = 3.354 Å) for Cu Kα1: λ = 2d sin θ, about 26.6°.
    expect(braggTwoTheta(ANODES.Cu.kAlpha1, 3.354)).toBeCloseTo(
      (2 * Math.asin(ANODES.Cu.kAlpha1 / (2 * 3.354))) / RAD,
      12,
    );
    expect(braggTwoTheta(ANODES.Cu.kAlpha1, 3.354)).toBeCloseTo(26.6, 1);
  });

  it('surface roughness: 1 at 2θ = 180°, 1 for a smooth surface, lower at low angle', () => {
    expect(surfaceRoughness(0.4, 0.3, Math.PI / 2)).toBeCloseTo(1, 14);
    expect(surfaceRoughness(1, 0.3, 0.2)).toBeCloseTo(1, 14);
    expect(surfaceRoughness(0.4, 0, 0.2)).toBeCloseTo(1, 14);
    expect(surfaceRoughness(0.4, 0.3, 10 * RAD)).toBeLessThan(surfaceRoughness(0.4, 0.3, 40 * RAD));
    // GSAS-II SurfaceRough(SRA, SRB, Tth) written out for one value.
    const sth = Math.sin(15 * RAD);
    expect(surfaceRoughness(0.25, 0.4, 15 * RAD)).toBeCloseTo(
      (0.25 + 0.75 * Math.exp(-0.4 / sth)) / (0.25 + 0.75 * Math.exp(-0.4)),
      14,
    );
    expect(variableSlitFactor(30 * RAD)).toBeCloseTo(0.5, 14);
    expect(transparencyShift(-0.05, 45 * RAD)).toBeCloseTo(-0.05, 14);
  });

  it('size and strain widths match GSAS-II GetSampleSigGam (centidegrees) and the Scherrer form', () => {
    const lambda = ANODES.Cu.kAlpha1;
    for (const t of [10, 20, 35, 60]) {
      const theta = t * RAD;
      const sizeMicrons = 0.04; // 40 nm
      const mustrain = 1500;
      // GSAS-II: Sgam = 1.8 λ / (π Size cos θ), Mgam = 0.018 μ tan θ / π, both in centidegrees.
      const sgam = (1.8 * lambda) / (Math.PI * sizeMicrons * Math.cos(theta)) / 100;
      const mgam = (0.018 * mustrain * Math.tan(theta)) / Math.PI / 100;
      const all = sampleWidths(1 / 40, mustrain, 1, 1, lambda, theta);
      expect(all.lorentzian).toBeCloseTo(sgam + mgam, 12);
      expect(all.gaussian2).toBe(0);
      // Scherrer with K = 1: β (rad) = λ / (D cos θ), D = 400 Å.
      expect(sampleWidths(1 / 40, 0, 1, 1, lambda, theta).lorentzian * RAD).toBeCloseTo(
        lambda / (400 * Math.cos(theta)),
        12,
      );
      // Mixing 0.3: GSAS-II sig = ((1−m)Sgam)² + ((1−m)Mgam)² (variance × 8 ln 2 = FWHM²).
      const half = sampleWidths(1 / 40, mustrain, 0.3, 0.3, lambda, theta);
      expect(half.lorentzian).toBeCloseTo(0.3 * (sgam + mgam), 12);
      expect(half.gaussian2).toBeCloseTo((0.7 * sgam) ** 2 + (0.7 * mgam) ** 2, 12);
    }
  });

  it('leaves the pattern unchanged with P = 0.5, no size, no strain and a smooth surface', () => {
    const base = ceriaPattern({});
    const again = ceriaPattern({ roughness: [0.3, 0] }, { ...CU, polarisation: 0.5 });
    expect(Array.from(again.y)).toEqual(Array.from(base.y));
  });
});

describe('Refinement with a fixed instrument profile: size, strain, transparency', () => {
  it('recovers crystallite size and microstrain', () => {
    const pattern = ceriaPattern({ inverseSize: 1 / 35, microstrain: 900 });
    const result = refine(pattern, { size: true, strain: true }, { instrument: INSTRUMENT });
    const fit = result.phases[0];
    if (!fit?.size || !fit.microstrain) throw new Error('no size');
    within(fit.size.value, 35, fit.size.esd);
    within(fit.microstrain.value, 900, fit.microstrain.esd);
    expect(fit.size.esd / fit.size.value).toBeLessThan(0.05);
    within(fit.cell.a.value, pattern.cellA, fit.cell.a.esd, 1e-6);
    // The fixed instrument stays as given.
    expect(fit.u.value).toBe(INSTRUMENT.u);
    expect(fit.x.refined).toBe(false);
    expect(result.instrument).toEqual(INSTRUMENT);
    expect(result.stats.chi2).toBeLessThan(1.15);
  }, 60_000);

  it('recovers the transparency shift and the polarisation of a monochromator', () => {
    const beam = { ...CU, polarisation: monochromatorFraction(26.6, false) };
    const pattern = ceriaPattern({ transparency: -0.04, inverseSize: 1 / 80 }, beam, 7);
    const result = refineRietveld({
      x: pattern.x,
      y: pattern.y,
      wavelengths: beam,
      phases: [ceriaInput()],
      choices: { ...DEFAULT_CHOICES, zero: false, transparency: true, size: true },
      backgroundTerms: 3,
      atomicWeights,
      instrument: INSTRUMENT,
    });
    if (!result.ok) throw new Error(result.error);
    within(result.transparency.value, -0.04, result.transparency.esd);
    expect(result.polarisation).toBeCloseTo(beam.polarisation, 14);
    within(result.phases[0]?.size?.value ?? 0, 80, result.phases[0]?.size?.esd ?? 0);
    expect(result.stats.chi2).toBeLessThan(1.15);
  }, 60_000);

  it('warns that size and strain include the instrument when no profile is fixed', () => {
    const pattern = ceriaPattern({ inverseSize: 1 / 35 });
    const result = refine(pattern, { size: true });
    expect(result.warnings.some((w) => w.includes('lower limit'))).toBe(true);
    // X stays fixed (it cannot be told from the size), so the size takes all the 1/cos θ width.
    expect(result.phases[0]?.x.refined).toBe(false);
  }, 60_000);

  it('refines the surface roughness B', () => {
    const pattern = ceriaPattern({ roughness: [0, 0.12], inverseSize: 1 / 60 });
    const result = refine(pattern, { roughness: true, size: true }, { instrument: INSTRUMENT });
    within(result.roughness[1].value, 0.12, result.roughness[1].esd, 0.01);
  }, 60_000);
});

describe('Excluded regions', () => {
  it('ignores a foreign peak inside an excluded range', () => {
    const pattern = ceriaPattern({ inverseSize: 1 / 50 });
    const clean = refine(pattern, { size: true }, { instrument: INSTRUMENT });
    // A sharp foreign peak at 38.5° (for example the sample holder).
    const spoiled = Float64Array.from(pattern.y, (v, i) => {
      const t = (pattern.x[i] as number) - 38.5;
      return v + Math.round(5000 * Math.exp(-(t * t) / 0.005));
    });
    const bad = refine({ x: pattern.x, y: spoiled }, { size: true }, { instrument: INSTRUMENT });
    const kept = refine(
      { x: pattern.x, y: spoiled },
      { size: true },
      { instrument: INSTRUMENT, excluded: [[38, 39]] },
    );
    expect(bad.stats.rwp).toBeGreaterThan(1.5 * clean.stats.rwp);
    expect(kept.excluded).toEqual([[38, 39]]);
    expect(kept.x.some((v) => v >= 38 && v <= 39)).toBe(false);
    expect(kept.x.length).toBe(Array.from(pattern.x).filter((v) => v < 38 || v > 39).length);
    expect(Math.abs(kept.stats.rwp - clean.stats.rwp)).toBeLessThan(0.002);
    expect(kept.phases[0]?.size?.value).toBeCloseTo(clean.phases[0]?.size?.value ?? 0, 0);
  }, 60_000);
});

describe('Le Bail mode', () => {
  it('fits a pattern whose intensities the reference cannot explain, with the true cell', () => {
    // Strong preferred orientation along [111] that the refinement is not told about.
    const pattern = ceriaPattern({ orientation: 0.6, inverseSize: 1 / 50 });
    const rietveld = refine(pattern, { size: true }, { instrument: INSTRUMENT });
    const leBail = refineRietveld({
      x: pattern.x,
      y: pattern.y,
      wavelengths: CU,
      phases: [ceriaInput(true)],
      choices: { ...DEFAULT_CHOICES, zero: false, size: true },
      backgroundTerms: 3,
      atomicWeights,
      instrument: INSTRUMENT,
    });
    if (!leBail.ok) throw new Error(leBail.error);
    const fit = leBail.phases[0];
    if (!fit?.size) throw new Error('no phase');
    expect(rietveld.stats.chi2).toBeGreaterThan(3);
    expect(leBail.stats.chi2).toBeLessThan(1.2);
    expect(fit.leBail).toBe(true);
    expect(Number.isNaN(fit.rBragg)).toBe(true);
    expect(fit.weightFraction).toBeNull();
    expect(fit.scale.refined).toBe(false);
    within(fit.cell.a.value, pattern.cellA, fit.cell.a.esd, 1e-6);
    within(fit.size.value, 50, fit.size.esd);
    expect(leBail.warnings.some((w) => w.startsWith('Le Bail mode'))).toBe(true);
  }, 60_000);

  it('extracts intensities that agree with the calculated ones of the true model', () => {
    const pattern = ceriaPattern({ inverseSize: 1 / 50 });
    const truth = refine(pattern, { size: true }, { instrument: INSTRUMENT });
    const leBail = refineRietveld({
      x: pattern.x,
      y: pattern.y,
      wavelengths: CU,
      phases: [ceriaInput(true)],
      choices: { ...DEFAULT_CHOICES, zero: false, size: true },
      backgroundTerms: 3,
      atomicWeights,
      instrument: INSTRUMENT,
    });
    if (!leBail.ok) throw new Error(leBail.error);
    const rows = leBail.phases[0]?.reflections ?? [];
    const reference = truth.phases[0]?.reflections ?? [];
    expect(rows.length).toBe(reference.length);
    // Reflections above 5 % of the strongest: the converged extraction matches the data.
    const strongest = Math.max(...reference.map((r) => r.iCalc));
    rows.forEach((row, i) => {
      const ref = reference[i];
      if (!ref || ref.iCalc < 0.05 * strongest) return;
      expect(row.hkl).toEqual(ref.hkl);
      // Le Bail follows the observed (partitioned) intensities, which carry the counting noise.
      expect(Math.abs(row.iCalc - ref.iObs) / ref.iObs).toBeLessThan(0.02);
      // Strong lines (≥ 20 % of the strongest), where the noise is small: within 1.5 % of the truth.
      if (ref.iCalc >= 0.2 * strongest)
        expect(Math.abs(row.iCalc - ref.iCalc) / ref.iCalc).toBeLessThan(0.015);
    });
  }, 60_000);
});

describe('Statistics (statistics.ts)', () => {
  it('Durbin–Watson d: alternating residuals give 3, independent noise about 2, a slow wave near 0', () => {
    expect(durbinWatson([1, -1, 1, -1])).toBe(3);
    const gauss = noise(5);
    const white = Array.from({ length: 20000 }, () => gauss());
    expect(durbinWatson(white)).toBeGreaterThan(1.95);
    expect(durbinWatson(white)).toBeLessThan(2.05);
    const wave = Array.from({ length: 2000 }, (_, i) => Math.sin(i / 50));
    expect(durbinWatson(wave)).toBeLessThan(0.01);
  });

  it('lists strongly correlated pairs from a covariance matrix', () => {
    // Variances 4, 9, 1; C01 = 5.7 (r = 0.95), C02 = −0.2 (r = −0.1), C12 = 2.97 (r = 0.99).
    const cov = [4, 5.7, -0.2, 5.7, 9, 2.97, -0.2, 2.97, 1];
    const pairs = strongCorrelations(cov, ['a', 'b', 'c'], [true, true, true], 0.9);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ['b', 'c'],
      ['a', 'b'],
    ]);
    expect(pairs[0]?.r).toBeCloseTo(0.99, 12);
    expect(strongCorrelations(cov, ['a', 'b', 'c'], [true, false, true], 0.9)).toEqual([]);
  });

  it('internal standard: recovers a known amorphous content exactly', () => {
    // Original sample: 30 % amorphous, 70 % phase X; 20 % standard weighed into the mixture.
    // Mixture: standard 0.20, X 0.56, amorphous 0.24 → crystalline R_s = 0.2/0.76.
    const a = [100, 300]; // Z M V of standard and X (any units)
    const scales = [0.2 / 100, 0.56 / 300];
    const result = internalStandard(scales, a, [0, 0, 0, 0], 0, 0.2);
    expect(result.amorphous.value).toBeCloseTo(0.3, 12);
    expect(result.phases[1]?.value).toBeCloseTo(0.7, 12);
    expect(result.phases[0]).toBeNull();
    // Same as (1 − W_s/R_s)/(1 − W_s) with the Hill–Howard R_s.
    const rs = weightFractions(scales, a, [0, 0, 0, 0])[0]?.value ?? 0;
    expect(result.amorphous.value).toBeCloseTo((1 - 0.2 / rs) / 0.8, 12);
  });

  it('internal standard: uncertainties agree with finite differences', () => {
    const a = [120, 250, 90];
    const scales = [1.2e-3, 2.5e-3, 0.8e-3];
    const cov = [1e-10, 2e-11, 0, 2e-11, 4e-10, -1e-11, 0, -1e-11, 9e-11];
    const ws = 0.25;
    const result = internalStandard(scales, a, cov, 0, ws);
    const numeric = (f: (s: number[]) => number) => {
      const grad = scales.map((s, q) => {
        const h = s * 1e-6;
        const up = [...scales];
        up[q] = s + h;
        return (f(up) - f(scales)) / h;
      });
      let v = 0;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          v += (grad[i] as number) * (cov[i * 3 + j] as number) * (grad[j] as number);
      return Math.sqrt(v);
    };
    expect(result.amorphous.esd).toBeCloseTo(
      numeric((s) => internalStandard(s, a, cov, 0, ws).amorphous.value),
      6,
    );
    expect(result.phases[2]?.esd).toBeCloseTo(
      numeric((s) => internalStandard(s, a, cov, 0, ws).phases[2]?.value ?? 0),
      6,
    );
  });

  it('reports Durbin–Watson and no strong correlations for a well-posed refinement', () => {
    const result = refine(
      ceriaPattern({ inverseSize: 1 / 40 }),
      { size: true },
      {
        instrument: INSTRUMENT,
      },
    );
    expect(result.stats.durbinWatson).toBeGreaterThan(1.8);
    expect(result.stats.durbinWatson).toBeLessThan(2.2);
    expect(result.correlations.every((c) => Math.abs(c.r) >= 0.9)).toBe(true);
  }, 60_000);
});
