import { describe, expect, it } from 'vitest';
import { energyFromWavelength } from '../src/core/uvvis/conversions';
import {
  absorptionSignal,
  compareTransitions,
  derivativeMaximum,
  fitBandGap,
  suggestRegion,
  suggestUrbachRegion,
  TRANSITIONS,
  taucValues,
  urbachFit,
  type TransitionId,
} from '../src/core/uvvis/tauc';
import {
  bandEdgeAbsorbance,
  bandEdgeReflectance,
  edgeShape,
  seededNoise,
} from '../src/core/uvvis/synthetic';

const grid = { startNm: 250, endNm: 900, stepNm: 1 };
const TRUE_EG = 3.1;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** Recovers the gap of a synthetic spectrum with the automatic region for the right transition. */
function recover(
  spectrum: { wavelengthNm: Float64Array; values: Float64Array },
  kind: 'absorbance' | 'reflectance',
  transition: TransitionId,
) {
  const meaning = { kind, scale: 'percent' as const };
  const signal = absorptionSignal(spectrum.wavelengthNm, spectrum.values, meaning, null);
  const y = taucValues(signal.energyEv, signal.signal, TRANSITIONS[transition].exponent);
  const region = must(suggestRegion(signal.energyEv, y));
  return must(fitBandGap(signal.energyEv, y, region[0], region[1]));
}

describe('absorptionSignal', () => {
  it('turns absorbance into alpha = ln(10) A / t when the thickness is known', () => {
    const wavelengthNm = Float64Array.from([300, 400]);
    const result = absorptionSignal(
      wavelengthNm,
      Float64Array.from([1, 0.5]),
      { kind: 'absorbance', scale: 'percent' },
      200,
    );
    // t = 200 nm = 2e-5 cm, so alpha = 2.302585 / 2e-5 cm^-1 for A = 1 (at 400 nm, the 2nd point).
    expect(result.unit).toBe('alpha');
    expect(result.energyEv[0]).toBeLessThan(result.energyEv[1] as number);
    expect(result.signal[1]).toBeCloseTo(Math.LN10 / 2e-5, 3);
    expect(result.signal[0]).toBeCloseTo((0.5 * Math.LN10) / 2e-5, 3);
  });

  it('uses A without a thickness, absorbance from transmittance, and F(R) for reflectance', () => {
    const x = Float64Array.from([300, 400]);
    const a = absorptionSignal(
      x,
      Float64Array.from([0.2, 0.4]),
      { kind: 'absorbance', scale: 'percent' },
      null,
    );
    expect(a.unit).toBe('proportional');
    expect(Array.from(a.signal)).toEqual([0.4, 0.2]);
    const t = absorptionSignal(
      x,
      Float64Array.from([10, 1]),
      { kind: 'transmittance', scale: 'percent' },
      null,
    );
    expect(t.signal[1]).toBeCloseTo(1, 12);
    expect(t.signal[0]).toBeCloseTo(2, 12);
    const r = absorptionSignal(
      x,
      Float64Array.from([50, 50]),
      { kind: 'reflectance', scale: 'percent' },
      300,
    );
    expect(r.unit).toBe('kubelka-munk');
    expect(r.signal[0]).toBeCloseTo(0.25, 12);
  });
});

describe('Tauc fit', () => {
  it('has the exponents 2, 1/2, 2/3 and 1/3 for n = 1/2, 2, 3/2 and 3', () => {
    expect(TRANSITIONS['direct-allowed'].exponent).toBe(2);
    expect(TRANSITIONS['indirect-allowed'].exponent).toBe(0.5);
    expect(TRANSITIONS['direct-forbidden'].exponent).toBeCloseTo(2 / 3, 12);
    expect(TRANSITIONS['indirect-forbidden'].exponent).toBeCloseTo(1 / 3, 12);
  });

  it('recovers the gap of a noise-free spectrum for every transition, from absorbance', () => {
    for (const id of Object.keys(TRANSITIONS) as TransitionId[]) {
      const spectrum = bandEdgeAbsorbance({ ...grid, bandGapEv: TRUE_EG, n: TRANSITIONS[id].n });
      const fit = recover(spectrum, 'absorbance', id);
      expect(fit.egEv, id).toBeCloseTo(TRUE_EG, 3);
      expect(fit.rSquared, id).toBeGreaterThan(0.999);
    }
  });

  it('recovers the gap from diffuse reflectance with Kubelka-Munk, direct and indirect', () => {
    for (const id of ['direct-allowed', 'indirect-allowed'] as const) {
      const n = TRANSITIONS[id].n;
      const exact = bandEdgeReflectance({ ...grid, bandGapEv: TRUE_EG, n, floor: 0 });
      expect(recover(exact, 'reflectance', id).egEv, id).toBeCloseTo(TRUE_EG, 3);
      // A constant F(R) floor below the edge (here 0.01) bends the curve and biases the gap a little.
      const floor = bandEdgeReflectance({ ...grid, bandGapEv: TRUE_EG, n });
      expect(Math.abs(recover(floor, 'reflectance', id).egEv - TRUE_EG), id).toBeLessThan(0.02);
    }
  });

  it('recovers the gap within 0.02 eV with noise, and reports a sensible uncertainty', () => {
    const spectrum = bandEdgeAbsorbance({
      ...grid,
      bandGapEv: TRUE_EG,
      n: 0.5,
      noiseSeed: 5,
      noiseSd: 0.003,
    });
    const fit = recover(spectrum, 'absorbance', 'direct-allowed');
    expect(Math.abs(fit.egEv - TRUE_EG)).toBeLessThan(0.02);
    expect(fit.egSigma).toBeGreaterThan(0);
    expect(fit.egSigma).toBeLessThan(0.05);
  });

  it('gives the exact gap and uncertainty by hand for a small data set', () => {
    // y = 2 (E − 3) with +/-0.01 alternating noise: slope close to 2, Eg close to 3.
    const e = [3.2, 3.3, 3.4, 3.5, 3.6, 3.7];
    const y = e.map((v, i) => 2 * (v - 3) + (i % 2 === 0 ? 0.01 : -0.01));
    const fit = must(fitBandGap(Float64Array.from(e), Float64Array.from(y), 3.2, 3.7));
    expect(fit.egEv).toBeCloseTo(3, 1);
    expect(fit.slope).toBeCloseTo(2, 1);
    expect(fit.n).toBe(6);
    // Exact y = a + b E recovered with zero noise gives zero uncertainty.
    const exact = must(
      fitBandGap(Float64Array.from(e), Float64Array.from(e.map((v) => 2 * (v - 3))), 3.2, 3.7),
    );
    expect(exact.egEv).toBeCloseTo(3, 12);
    expect(exact.egSigma).toBeCloseTo(0, 6);
  });

  it('refuses a fit with too few points or a falling line', () => {
    const e = Float64Array.from([3.2, 3.3, 3.4, 3.5]);
    expect(fitBandGap(e, Float64Array.from([1, 2, 3, 4]), 3.2, 3.25)).toBeNull();
    expect(fitBandGap(e, Float64Array.from([4, 3, 2, 1]), 3.2, 3.5)).toBeNull();
  });

  it('picks the straight stretch of the edge, not the flat baseline or the noisy top', () => {
    const spectrum = bandEdgeAbsorbance({
      ...grid,
      bandGapEv: TRUE_EG,
      n: 0.5,
      baseline: 0.01,
      noiseSeed: 3,
      noiseSd: 0.002,
    });
    const signal = absorptionSignal(
      spectrum.wavelengthNm,
      spectrum.values,
      { kind: 'absorbance', scale: 'percent' },
      null,
    );
    const y = taucValues(signal.energyEv, signal.signal, 2);
    const [lo, hi] = must(suggestRegion(signal.energyEv, y));
    expect(lo).toBeGreaterThan(TRUE_EG);
    expect(hi - lo).toBeGreaterThanOrEqual(0.14);
  });

  it('ranks all four transitions with R-squared, and the true one is among the best', () => {
    const spectrum = bandEdgeAbsorbance({ ...grid, bandGapEv: TRUE_EG, n: 2 });
    const signal = absorptionSignal(
      spectrum.wavelengthNm,
      spectrum.values,
      { kind: 'absorbance', scale: 'percent' },
      null,
    );
    const rows = compareTransitions(signal.energyEv, signal.signal, {});
    expect(rows.map((r) => r.id)).toEqual(Object.keys(TRANSITIONS));
    const indirect = must(rows.find((r) => r.id === 'indirect-allowed')?.fit);
    expect(indirect.egEv).toBeCloseTo(TRUE_EG, 3);
    expect(indirect.rSquared).toBeGreaterThan(0.9999);
  });
});

describe('Urbach energy', () => {
  it('recovers Eu from an exponential tail', () => {
    const eu = 0.12;
    const energy = Float64Array.from({ length: 200 }, (_, i) => 2.5 + i * 0.005);
    const signal = energy.map((e) => 3 * Math.exp((e - 3.2) / eu));
    const fit = must(urbachFit(energy, signal, 2.6, 3.2));
    expect(fit.euEv).toBeCloseTo(eu, 8);
    expect(fit.rSquared).toBeCloseTo(1, 10);
  });

  it('suggests a region below the gap and recovers Eu with noise within 5 %', () => {
    const eu = 0.1;
    const energy = Float64Array.from({ length: 400 }, (_, i) => 2.0 + i * 0.005);
    const noise = seededNoise(9, 0.02);
    const signal = energy.map((e) => 0.5 * Math.exp((e - 3.0) / eu) * (1 + noise()));
    const region = must(suggestUrbachRegion(energy, signal, 3.0));
    expect(region[1]).toBeLessThanOrEqual(3.0);
    const fit = must(urbachFit(energy, signal, region[0], region[1]));
    expect(Math.abs(fit.euEv - eu) / eu).toBeLessThan(0.05);
  });

  it('gives no suggestion when nothing positive lies below the gap', () => {
    const energy = Float64Array.from({ length: 50 }, (_, i) => 3 + i * 0.01);
    expect(
      suggestUrbachRegion(
        energy,
        energy.map(() => 0),
        3.0,
      ),
    ).toBeNull();
  });
});

describe('derivative method', () => {
  it('finds the steepest point of a smooth edge', () => {
    const energy = Float64Array.from({ length: 300 }, (_, i) => 2.5 + i * 0.005);
    const signal = energy.map((e) => 1 / (1 + Math.exp(-(e - 3.2) / 0.05)));
    expect(must(derivativeMaximum(energy, signal, 'linear', 2.6, 4)).egEv).toBeCloseTo(3.2, 1);
  });

  it('uses d ln(alpha)/dE for the log mode', () => {
    const energy = Float64Array.from({ length: 300 }, (_, i) => 2.5 + i * 0.005);
    // ln S is flat below 3 eV, rises with slope 5 per eV up to 3.4 eV, then is flat again.
    const signal = energy.map((e) => Math.exp(Math.min(Math.max((e - 3) * 5, 0), 2)));
    const peak = must(derivativeMaximum(energy, signal, 'log', 2.6, 4));
    expect(peak.value).toBeCloseTo(5, 1);
    expect(peak.egEv).toBeGreaterThanOrEqual(3);
    expect(peak.egEv).toBeLessThanOrEqual(3.4);
  });
});

describe('edge shape helper', () => {
  it('is zero below the gap and gives c (E-Eg)^n / E above it', () => {
    expect(edgeShape(3, 3.2, 0.5, 8)).toBe(0);
    expect(edgeShape(4, 3, 2, 1.5)).toBeCloseTo(1.5 / 4, 12);
    expect(energyFromWavelength(1239.84198)).toBeCloseTo(1, 5);
  });
});
