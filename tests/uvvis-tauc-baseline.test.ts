import { describe, expect, it } from 'vitest';
import { energyFromWavelength } from '../src/core/uvvis/conversions';
import {
  absorptionSignal,
  analyseTaucGap,
  fitBandGap,
  fitLine,
  lineCrossing,
  SUB_GAP_SHIFT_EV,
  TRANSITIONS,
  type GapMethod,
  type TaucGapOptions,
  type TransitionId,
} from '../src/core/uvvis/tauc';
import { bandEdgeAbsorbance, bandEdgeReflectance, seededNoise } from '../src/core/uvvis/synthetic';

// Audit 2026-11-14, bug 1: the Tauc gap with a sub-gap level. The spectrum of the audit:
// 250 to 850 nm in 1 nm steps, A(E) = 1.2·√(E − 3.2)/E above 3.2 eV and 0 below, plus a level.

const grid = { startNm: 250, endNm: 850, stepNm: 1 };
const EG = 3.2;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const auto = (method: GapMethod | null = null): TaucGapOptions => ({
  method,
  edgeRegion: null,
  baselineRegion: null,
});

/** The signal (E increasing) of an absorbance spectrum, with an extra level added in E. */
function absorbanceSignal(options: {
  level: number;
  slopePerEv?: number;
  n?: number;
  strength?: number;
  noise?: { seed: number; sd: number };
}) {
  const { level, slopePerEv = 0, n = 0.5, strength = n === 0.5 ? 1.2 : 1.5 } = options;
  const s = bandEdgeAbsorbance({ ...grid, bandGapEv: EG, n, strength, baseline: level });
  const noise = options.noise ? seededNoise(options.noise.seed, options.noise.sd) : () => 0;
  const values = s.values.map(
    (v, i) => v + slopePerEv * (energyFromWavelength(s.wavelengthNm[i] as number) - 2) + noise(),
  );
  return absorptionSignal(s.wavelengthNm, values, { kind: 'absorbance', scale: 'percent' }, null);
}

function gap(signal: ReturnType<typeof absorbanceSignal>, id: TransitionId, options = auto()) {
  return analyseTaucGap(signal.energyEv, signal.signal, TRANSITIONS[id].exponent, options);
}

describe('the audit table is reproduced by the axis intercept', () => {
  it.each([
    [0, 3.2],
    [0.05, 3.116],
    [0.2, 2.926],
    [0.5, 2.69],
  ])('level %f gives %f eV on the uncorrected suggestion', (level, expected) => {
    const result = gap(absorbanceSignal({ level }), 'direct-allowed', {
      ...auto('axis'),
      legacySuggestion: true,
    });
    expect(must(result.fit).egEv).toBeCloseTo(expected, 3);
  });
});

describe('sub-gap baseline subtracted before the Tauc plot (synthetic, known answer)', () => {
  // Tolerance 0.002 eV: the model is exact for these spectra, so only rounding of the
  // wavelength grid and the 1 nm steps remain; 0.01 eV is the tolerance asked for in the audit.
  const TOLERANCE = 0.002;

  it.each([0, 0.05, 0.2, 0.5])(
    'constant level %f: Eg = 3.200 eV, chosen automatically',
    (level) => {
      const result = gap(absorbanceSignal({ level }), 'direct-allowed');
      expect(result.method).toBe(level === 0 ? 'axis' : 'subtract-baseline');
      expect(result.subGapLevel).toBe(level > 0);
      expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(TOLERANCE);
      // The suggested edge region stays on the edge.
      expect(must(result.region)[0]).toBeLessThan(EG + 0.1);
    },
  );

  it.each([0, 0.05, 0.2, 0.5])('indirect allowed edge with level %f', (level) => {
    const result = gap(absorbanceSignal({ level, n: 2 }), 'indirect-allowed');
    expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(TOLERANCE);
  });

  it.each([
    [0.05, 0.05],
    [0.2, -0.05],
    [0.1, 0.1],
  ])('sloping level %f + %f per eV', (level, slopePerEv) => {
    for (const [id, n] of [
      ['direct-allowed', 0.5],
      ['indirect-allowed', 2],
    ] as const) {
      const result = gap(absorbanceSignal({ level, slopePerEv, n }), id);
      expect(result.method, id).toBe('subtract-baseline');
      expect(Math.abs(must(result.fit).egEv - EG), id).toBeLessThan(TOLERANCE);
    }
  });

  it.each([0.01, 0.05, 0.2])('Kubelka–Munk spectrum with a level %f added to F(R)', (floor) => {
    for (const [id, n] of [
      ['direct-allowed', 0.5],
      ['indirect-allowed', 2],
    ] as const) {
      const s = bandEdgeReflectance({ ...grid, bandGapEv: EG, n, floor });
      const signal = absorptionSignal(
        s.wavelengthNm,
        s.values,
        { kind: 'reflectance', scale: 'percent' },
        null,
      );
      expect(signal.unit).toBe('kubelka-munk');
      const result = gap(signal, id, auto('subtract-baseline'));
      expect(Math.abs(must(result.fit).egEv - EG), id).toBeLessThan(TOLERANCE);
      // Chosen automatically once the level moves the uncorrected gap by more than 0.01 eV.
      const automatic = gap(signal, id);
      const shift = Math.abs(must(automatic.axisEgEv) - EG);
      expect(automatic.method, id).toBe(shift > SUB_GAP_SHIFT_EV ? 'subtract-baseline' : 'axis');
    }
  });

  it('leaves the zero-level results exactly as before', () => {
    for (const [id, n] of [
      ['direct-allowed', 0.5],
      ['indirect-allowed', 2],
    ] as const) {
      const signal = absorbanceSignal({ level: 0, n, noise: { seed: 5, sd: 0.003 } });
      const before = gap(signal, id, { ...auto('axis'), legacySuggestion: true });
      const now = gap(signal, id);
      expect(now.method).toBe('axis');
      expect(now.region).toEqual(before.region);
      expect(must(now.fit).egEv).toBe(must(before.fit).egEv);
      // The shift that subtraction would make on a noisy zero level is well below the threshold.
      expect(Math.abs(must(now.axisEgEv) - must(now.subtractedEgEv))).toBeLessThan(
        SUB_GAP_SHIFT_EV / 2,
      );
    }
  });
});

describe('crossing with a baseline on the Tauc plot', () => {
  it('gives the crossing of two lines by hand', () => {
    // Edge y = 2(E − 3) on 3.2..3.7 eV, baseline y = 0.1 + 0.05 E on 2.0..2.5 eV:
    // 2E − 6 = 0.1 + 0.05E, so E = 6.1 / 1.95 = 3.128205... eV.
    const e = Float64Array.from([2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7]);
    const y = e.map((v) => (v < 3 ? 0.1 + 0.05 * v : 2 * (v - 3)));
    const crossing = must(
      lineCrossing(must(fitLine(e, y, 3.2, 3.7)), must(fitLine(e, y, 2.0, 2.5))),
    );
    expect(crossing.egEv).toBeCloseTo(6.1 / 1.95, 10);
    expect(crossing.egSigma).toBeCloseTo(0, 10);
  });

  it('reduces to the axis intercept and its uncertainty when the baseline is y = 0', () => {
    const e = Float64Array.from([2.0, 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7]);
    const y = e.map((v, i) => (v < 3 ? 0 : 2 * (v - 3) + (i % 2 === 0 ? 0.01 : -0.01)));
    const edge = must(fitLine(e, y, 3.2, 3.7));
    const zero = {
      ...must(fitLine(e, y, 2.0, 2.4)),
      interceptSigma: 0,
      slopeSigma: 0,
      covariance: 0,
    };
    const crossing = must(lineCrossing(edge, zero));
    const axis = must(fitBandGap(e, y, 3.2, 3.7));
    expect(crossing.egEv).toBeCloseTo(axis.egEv, 12);
    expect(crossing.egSigma).toBeCloseTo(axis.egSigma, 12);
  });

  it('is exact for a level on the Tauc plot itself, and lies below the gap for a level in A', () => {
    const result = gap(absorbanceSignal({ level: 0 }), 'direct-allowed', auto('baseline-crossing'));
    expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(0.002);
    // With a level in absorbance the Tauc curve is bent above the gap; the crossing is pulled low
    // (measured here, not a published value): between the axis intercept and the true gap.
    for (const level of [0.05, 0.2, 0.5]) {
      const r = gap(absorbanceSignal({ level }), 'direct-allowed', auto('baseline-crossing'));
      const eg = must(r.fit).egEv;
      expect(eg, String(level)).toBeLessThan(EG);
      expect(eg, String(level)).toBeGreaterThan(must(r.axisEgEv));
    }
  });
});

describe('the propagated uncertainties agree with the scatter of repeated noisy data', () => {
  // Independent check of the error propagation by Monte Carlo: 400 data sets with different
  // noise, where the least-squares σ of each line is exact (equal noise on every point), so the
  // standard deviation of the gaps must match the mean reported σ. Tolerance ±15 % (the standard
  // error of a standard deviation from 400 samples is about 3.5 %).
  const ratio = (gaps: number[], sigmas: number[]) => {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length - 1));
    return sigmas.reduce((a, b) => a + b, 0) / sigmas.length / sd;
  };

  it('crossing of two lines with noise on both', () => {
    const e = Float64Array.from({ length: 60 }, (_, i) => 2 + i * 0.03);
    const gaps: number[] = [];
    const sigmas: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const noise = seededNoise(seed, 0.02);
      const y = e.map((v) => (v < 3 ? 0.1 + 0.05 * v : 2 * (v - 3)) + noise());
      const c = must(lineCrossing(must(fitLine(e, y, 3.1, 3.8)), must(fitLine(e, y, 2, 2.9))));
      gaps.push(c.egEv);
      sigmas.push(c.egSigma);
    }
    const r = ratio(gaps, sigmas);
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(1.15);
  });

  it('subtraction: the baseline part, with noise only below the edge', () => {
    const clean = bandEdgeAbsorbance({
      ...grid,
      bandGapEv: EG,
      n: 0.5,
      strength: 1.2,
      baseline: 0.2,
    });
    const gaps: number[] = [];
    const sigmas: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const noise = seededNoise(seed, 0.003);
      const values = clean.values.map((v, i) =>
        energyFromWavelength(clean.wavelengthNm[i] as number) < 3.15 ? v + noise() : v,
      );
      const signal = absorptionSignal(
        clean.wavelengthNm,
        values,
        { kind: 'absorbance', scale: 'percent' },
        null,
      );
      const fit = must(
        gap(signal, 'direct-allowed', {
          method: 'subtract-baseline',
          edgeRegion: [3.25, 3.8],
          baselineRegion: [2.6, 3.1],
        }).fit,
      );
      gaps.push(fit.egEv);
      sigmas.push(fit.egSigma);
    }
    const r = ratio(gaps, sigmas);
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(1.15);
  });
});

describe('invariance', () => {
  it('scaling the signal does not move the gap (thickness or concentration)', () => {
    const signal = absorbanceSignal({ level: 0.2, slopePerEv: 0.05 });
    const scaled = { ...signal, signal: signal.signal.map((v) => v * 37) };
    for (const method of ['subtract-baseline', 'baseline-crossing', 'axis'] as const) {
      const a = must(gap(signal, 'direct-allowed', auto(method)).fit).egEv;
      const b = must(gap(scaled, 'direct-allowed', auto(method)).fit).egEv;
      expect(b, method).toBeCloseTo(a, 9);
    }
  });

  it('subtraction gives the same gap whatever straight background is added', () => {
    const clean = gap(absorbanceSignal({ level: 0 }), 'direct-allowed', auto('subtract-baseline'));
    for (const [level, slope] of [
      [0.3, 0],
      [0.1, 0.2],
      [0.4, -0.08],
    ] as const) {
      const r = gap(
        absorbanceSignal({ level, slopePerEv: slope }),
        'direct-allowed',
        auto('subtract-baseline'),
      );
      expect(must(r.fit).egEv).toBeCloseTo(must(clean.fit).egEv, 3);
    }
  });

  it('a coarser wavelength step gives the same gap', () => {
    const s = bandEdgeAbsorbance({
      startNm: 250,
      endNm: 850,
      stepNm: 2,
      bandGapEv: EG,
      n: 0.5,
      strength: 1.2,
      baseline: 0.2,
    });
    const signal = absorptionSignal(
      s.wavelengthNm,
      s.values,
      { kind: 'absorbance', scale: 'percent' },
      null,
    );
    expect(Math.abs(must(gap(signal, 'direct-allowed').fit).egEv - EG)).toBeLessThan(0.002);
  });
});
