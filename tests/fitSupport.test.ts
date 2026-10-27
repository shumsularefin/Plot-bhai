// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { levenbergMarquardt } from '../src/core/math/levenbergMarquardt';
import {
  DEFAULT_ANALYSIS,
  DEFAULT_INSTRUMENT,
  DEFAULT_MATERIAL,
  DEFAULT_RIETVELD,
  DEFAULT_RESULTS,
  initialXrdData,
  migrateXrdData,
  peaksFor,
  processingFor,
  type XrdData,
} from '../src/modules/xrd/data';
import { DEFAULT_PROCESSING } from '../src/core/xrd/process/pipeline';
import { formatWithSigma } from '../src/ui/format';

describe('Levenberg–Marquardt', () => {
  it('matches the exact straight-line least-squares fit and its textbook uncertainties', () => {
    // y = a + b x with a known closed-form solution and covariance.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const y = Float64Array.from([1.1, 2.9, 5.2, 6.8, 9.1, 11.2, 12.8, 15.1]);
    const result = levenbergMarquardt({
      y,
      initial: Float64Array.of(0, 0),
      lower: Float64Array.of(-Infinity, -Infinity),
      upper: Float64Array.of(Infinity, Infinity),
      free: [true, true],
      evaluate(p, model, jacobian) {
        xs.forEach((x, i) => {
          model[i] = (p[0] as number) + (p[1] as number) * x;
          if (jacobian) {
            jacobian[2 * i] = 1;
            jacobian[2 * i + 1] = x;
          }
        });
      },
    });
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
    const b = xs.reduce((s, v, i) => s + (v - mx) * ((y[i] as number) - my), 0) / sxx;
    const a = my - b * mx;
    const s2 = xs.reduce((s, v, i) => s + ((y[i] as number) - a - b * v) ** 2, 0) / (n - 2);
    expect(result.parameters[0]).toBeCloseTo(a, 8);
    expect(result.parameters[1]).toBeCloseTo(b, 8);
    // σ_b = √(s² / Sxx), σ_a = √(s² (1/n + x̄² / Sxx)).
    expect(result.standardErrors[1]).toBeCloseTo(Math.sqrt(s2 / sxx), 8);
    expect(result.standardErrors[0]).toBeCloseTo(Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)), 8);
  });

  it('respects bounds and reports parameters that end on one', () => {
    const y = Float64Array.of(5, 5, 5);
    const result = levenbergMarquardt({
      y,
      initial: Float64Array.of(1),
      lower: Float64Array.of(0),
      upper: Float64Array.of(2),
      free: [true],
      evaluate(p, model, jacobian) {
        model.fill(p[0] as number);
        jacobian?.fill(1);
      },
    });
    expect(result.parameters[0]).toBe(2);
    expect(result.atBound[0]).toBe(true);
  });
});

describe('formatWithSigma', () => {
  it('rounds σ to two significant figures and the value to match', () => {
    expect(formatWithSigma(31.77123, 0.00083)).toBe('31.77123 ± 0.00083');
    expect(formatWithSigma(1234.5, 56)).toBe('1235 ± 56');
    expect(formatWithSigma(0.5, 0)).toBe('0.5');
  });
});

describe('session migration', () => {
  it('upgrades Stage 1 and Stage 2 sessions and keeps their patterns', () => {
    const base = {
      step: 1,
      furthest: 1,
      data: { patterns: [], plot: { normalise: false, offsetPercent: 20 } },
    };
    const fromStage1 = migrateXrdData(base, 2);
    expect(fromStage1?.data.peaks).toEqual({});
    expect(fromStage1?.data.processing).toEqual({});
    const fromStage2 = migrateXrdData(
      { ...base, data: { ...base.data, processing: { a: 1 }, radiation: { anode: 'Co' } } },
      3,
    );
    expect(fromStage2?.data.processing).toEqual({ a: 1 });
    expect(fromStage2?.data.radiation).toEqual({ anode: 'Co' });
    expect(migrateXrdData(base, 1)).toBeUndefined();
  });

  it('upgrades Stage 3 sessions, keeping their peak fits and adding instrument settings', () => {
    const fromStage3 = migrateXrdData(
      {
        step: 4,
        furthest: 4,
        data: { patterns: [], plot: { normalise: false, offsetPercent: 20 }, peaks: { a: 1 } },
      },
      4,
    );
    expect(fromStage3?.data.peaks).toEqual({ a: 1 });
    expect(fromStage3?.data.instrument).toEqual(DEFAULT_INSTRUMENT);
    expect(fromStage3?.data.results).toEqual(DEFAULT_RESULTS);
    const fromStage4 = migrateXrdData(
      { step: 5, furthest: 5, data: { patterns: [], plot: {}, instrument: { source: 'skip' } } },
      5,
    );
    expect(fromStage4?.data.instrument).toEqual({ source: 'skip' });
    expect(fromStage4?.data.results).toEqual(DEFAULT_RESULTS);
    expect(migrateXrdData({}, 6)).toBeUndefined();
    expect(migrateXrdData({}, 7)).toBeUndefined();
    expect(migrateXrdData({}, 8)).toBeUndefined();
    expect(migrateXrdData({}, 9)).toBeUndefined();
    expect(fromStage4?.data.material).toEqual(DEFAULT_MATERIAL);
  });

  it('upgrades Stage 5 sessions, keeping size and strain settings and adding the material choice', () => {
    const results = { k: 0.94, modulusGPa: 210, densityGcm3: null, patterns: {} };
    const fromStage5 = migrateXrdData(
      { step: 6, furthest: 6, data: { patterns: [], plot: {}, results } },
      6,
    );
    // Step 6 (Instrument correction) is step 7 since the Rietveld step was added before Fit peaks.
    expect(fromStage5?.step).toBe(7);
    expect(fromStage5?.data.results).toEqual(results);
    expect(fromStage5?.data.material).toEqual(DEFAULT_MATERIAL);
  });

  it('upgrades version 9 sessions: steps from Fit peaks on move one place for the Rietveld step', () => {
    const material = { ...DEFAULT_MATERIAL, candidates: ['anatase'] };
    const atPhases = migrateXrdData(
      { step: 3, furthest: 4, data: { patterns: [], plot: {}, material } },
      9,
    );
    expect(atPhases?.step).toBe(3);
    expect(atPhases?.furthest).toBe(5);
    expect(atPhases?.data.material).toEqual(material);
    expect(atPhases?.data.rietveld).toEqual(DEFAULT_RIETVELD);
  });

  it('upgrades version 8 sessions: the ticked phases become the candidates', () => {
    const material = {
      familyId: 'tio2',
      phaseIds: ['anatase'],
      hidden: ['rutile'],
      jcpds: { anatase: '21-1272' },
      toleranceDeg: 0.2,
    };
    const upgraded = migrateXrdData(
      { step: 3, furthest: 4, data: { patterns: [], plot: {}, material } },
      8,
    )?.data.material;
    // The inorganic library they came from is gone; the material step asks to add them again.
    expect(upgraded?.candidates).toEqual(['anatase']);
    expect(upgraded?.phaseIds).toEqual(['anatase']);
    expect(upgraded?.hidden).toEqual(['rutile']);
    expect(upgraded?.jcpds).toEqual({ anatase: '21-1272' });
    expect(upgraded?.toleranceDeg).toBe(0.2);
    expect(upgraded?.userPhases).toEqual([]);
    expect(upgraded?.simulation.show).toBe(false);
  });

  it('upgrades Stage 6c sessions, keeping the reference material choice and adding analysis settings', () => {
    const material = { familyId: 'tio2', phaseIds: ['anatase'] };
    const fromVersion7 = migrateXrdData(
      { step: 7, furthest: 7, data: { patterns: [], plot: {}, material } },
      7,
    );
    expect(fromVersion7?.data.material.phaseIds).toEqual(['anatase']);
    expect(fromVersion7?.data.analysis).toEqual(DEFAULT_ANALYSIS);
  });
});

describe('stored XRD settings', () => {
  it('give the same object on every call, so worker hooks do not restart on each render', () => {
    const data: XrdData = {
      ...initialXrdData,
      processing: { a: { ...DEFAULT_PROCESSING } },
      peaks: { a: { ...peaksFor(initialXrdData, 'a') } },
    };
    expect(processingFor(data, 'a')).toBe(processingFor(data, 'a'));
    expect(peaksFor(data, 'a')).toBe(peaksFor(data, 'a'));
    expect(peaksFor(data, 'a').detection).toBe(peaksFor(data, 'a').detection);
  });
});
