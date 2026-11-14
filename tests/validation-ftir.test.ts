// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickPeaks } from '../src/core/ftir/peaks';
import {
  bandArea,
  fitBandRegion,
  secondDerivative,
  subtractSpectrum,
  subtractionFactor,
} from '../src/core/ftir/bands';
import { rubberBandBaseline } from '../src/core/ftir/baseline';
import { polynomialBackground } from '../src/core/xrd/process/background';
import { alsBaseline, arplsBaseline } from '../src/core/math/whittaker';
import { atrCorrect, penetrationDepthUm } from '../src/core/ftir/atr';
import { toAbsorbance, toPercentTransmittance } from '../src/core/ftir/process';

/*
 * The FTIR tool against SciPy, pybaselines and lmfit (docs/validation.md, "FTIR"). The spectrum
 * and the expected numbers are written by scripts/validation/spectra/ftir.py.
 */

type Picked = Record<string, number>;
const fixture = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/validation/ftir-reference.json', import.meta.url),
    'utf8',
  ),
) as {
  wavenumber: number[];
  absorbance: number[];
  peaks: {
    minProminence: number;
    list: { wavenumber: number; height: number; prominence: number }[];
  };
  secondDerivative: { window: number; order: number; values: Picked };
  area: { from: number; to: number; area: number };
  subtraction: {
    referenceX: number[];
    reference: number[];
    sample: number[];
    range: [number, number];
    factor: number;
  };
  baselines: {
    asls: { lambda: number; p: number; values: Picked };
    arpls: { lambda: number; values: Picked };
    modpoly: { degree: number; fits: number; values: Picked };
    rubberBand: Picked;
  };
  bandFit: {
    from: number;
    to: number;
    starts: number[];
    bands: {
      center: number;
      centerSigma: number;
      fwhm: number;
      fwhmSigma: number;
      height: number;
    }[];
  };
};

const x = Float64Array.from(fixture.wavenumber);
const y = Float64Array.from(fixture.absorbance);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const expectPicked = (values: Float64Array, expected: Picked, tolerance: number) => {
  for (const [i, v] of Object.entries(expected))
    expect({ i, diff: Math.abs((values[Number(i)] as number) - v) < tolerance }).toEqual({
      i,
      diff: true,
    });
};

describe('FTIR against SciPy, pybaselines and lmfit', () => {
  it('peaks and prominences equal scipy find_peaks / peak_prominences', () => {
    const peaks = pickPeaks(x, y, { minProminence: fixture.peaks.minProminence });
    expect(peaks.length).toBe(fixture.peaks.list.length);
    peaks.forEach((p, i) => {
      const ref = fixture.peaks.list[i] as (typeof fixture.peaks.list)[number];
      // numpy.polyfit through three points rounds differently from the closed-form vertex.
      expect(p.wavenumber).toBeCloseTo(ref.wavenumber, 7);
      expect(p.height).toBe(ref.height);
      expect(p.prominence).toBeCloseTo(ref.prominence, 12);
    });
  });

  it('second derivative equals scipy savgol_filter(deriv=2, mode="interp"), ends included', () => {
    const { window, order, values } = fixture.secondDerivative;
    const d2 = secondDerivative(x, y, window, order);
    expect(d2).not.toBeNull();
    expectPicked(d2 as Float64Array, values, 1e-12);
  });

  it('band area above the straight line between the ends equals scipy trapezoid', () => {
    const { from, to, area } = fixture.area;
    expect(rel(bandArea(x, y, from, to)?.area as number, area)).toBeLessThan(1e-12);
    // Either order of the limits.
    expect(rel(bandArea(x, y, to, from)?.area as number, area)).toBeLessThan(1e-12);
  });

  it('subtraction factor equals numpy lstsq with the reference interpolated', () => {
    const s = fixture.subtraction;
    const k = subtractionFactor(
      x,
      Float64Array.from(s.sample),
      Float64Array.from(s.referenceX),
      Float64Array.from(s.reference),
      ...s.range,
    );
    expect(rel(k as number, s.factor)).toBeLessThan(1e-12);
  });

  it('AsLS and arPLS baselines equal pybaselines 1.2.1 (whittaker.asls, whittaker.arpls)', () => {
    const { asls, arpls } = fixture.baselines;
    expectPicked(alsBaseline(y, asls.lambda, asls.p, 10), asls.values, 1e-8);
    expectPicked(arplsBaseline(y, arpls.lambda, 1e-6, 100), arpls.values, 1e-9);
  });

  it('modified polyfit equals pybaselines polynomial.modpoly after the same number of fits', () => {
    const { degree, fits, values } = fixture.baselines.modpoly;
    // A negative tolerance never stops early, so both programs make exactly `fits` fits.
    expectPicked(polynomialBackground(x, y, degree, fits, -1), values, 1e-9);
  });

  it('rubber band equals the lower convex hull from Qhull (scipy.spatial.ConvexHull)', () => {
    expectPicked(rubberBandBaseline(x, y), fixture.baselines.rubberBand, 1e-12);
  });

  it('two overlapping Gaussian bands agree with lmfit (GaussianModel × 2 + LinearModel)', () => {
    const b = fixture.bandFit;
    const fit = fitBandRegion(x, y, b.from, b.to, b.starts, 'gaussian', ' cm⁻¹');
    expect(fit.converged).toBe(true);
    const peaks = [...fit.peaks].sort((p, q) => p.center - q.center);
    peaks.forEach((p, i) => {
      const ref = b.bands[i] as (typeof b.bands)[number];
      expect(Math.abs(p.center - ref.center)).toBeLessThan(1e-4);
      expect(rel(p.fwhm, ref.fwhm)).toBeLessThan(1e-5);
      expect(rel(p.height, ref.height)).toBeLessThan(1e-5);
      expect(rel(p.sigma.center, ref.centerSigma)).toBeLessThan(1e-3);
      expect(rel(p.sigma.fwhm, ref.fwhmSigma)).toBeLessThan(1e-3);
    });
  });
});

describe('FTIR round trips and invariances', () => {
  it('%T → A → %T returns the input', () => {
    const t = Float64Array.from([0.5, 12, 48.3, 99.99]);
    const back = toPercentTransmittance(toAbsorbance(t, 'transmittance', 'percent'));
    back.forEach((v, i) => expect(v).toBeCloseTo(t[i] as number, 12));
  });

  it('peaks, prominences and band areas do not move with a constant offset', () => {
    const shifted = y.map((v) => v + 0.3);
    const a = pickPeaks(x, y, { minProminence: 0.02 });
    const b = pickPeaks(x, shifted, { minProminence: 0.02 });
    b.forEach((p, i) =>
      expect(p.wavenumber).toBeCloseTo((a[i] as (typeof a)[number]).wavenumber, 9),
    );
    b.forEach((p, i) =>
      expect(p.prominence).toBeCloseTo((a[i] as (typeof a)[number]).prominence, 12),
    );
    const { from, to } = fixture.area;
    expect(bandArea(x, shifted, from, to)?.area).toBeCloseTo(
      bandArea(x, y, from, to)?.area as number,
      10,
    );
  });

  it('scaling the spectrum scales areas and the subtraction factor, not positions', () => {
    const scaled = y.map((v) => 2.5 * v);
    const { from, to } = fixture.area;
    expect(
      rel(
        bandArea(x, scaled, from, to)?.area as number,
        2.5 * (bandArea(x, y, from, to)?.area as number),
      ),
    ).toBeLessThan(1e-12);
    const s = fixture.subtraction;
    const args = [
      Float64Array.from(s.referenceX),
      Float64Array.from(s.reference),
      ...s.range,
    ] as const;
    const k = subtractionFactor(x, Float64Array.from(s.sample), ...args) as number;
    const k2 = subtractionFactor(
      x,
      Float64Array.from(s.sample, (v) => 2.5 * v),
      ...args,
    ) as number;
    expect(rel(k2, 2.5 * k)).toBeLessThan(1e-12);
  });

  it('a known amount of reference is found and removed exactly', () => {
    const s = fixture.subtraction;
    const rx = Float64Array.from(s.referenceX);
    const ref = Float64Array.from(s.reference);
    const inX = Float64Array.from(x.filter((v) => v >= 3650 && v <= 3950));
    const own = subtractSpectrum(inX, new Float64Array(inX.length), rx, ref, -0.6).absorbance;
    expect(subtractionFactor(inX, own, rx, ref, 3650, 3950)).toBeCloseTo(0.6, 12);
    const left = subtractSpectrum(inX, own, rx, ref, 0.6).absorbance;
    left.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-12));
  });

  it('ATR depth is ∝ 1/ν̃, and the correction is the identity at the reference wavenumber', () => {
    const d1000 = penetrationDepthUm(1000, 2.4, 1.5, 45) as number;
    expect(penetrationDepthUm(2000, 2.4, 1.5, 45)).toBeCloseTo(d1000 / 2, 12);
    expect(penetrationDepthUm(500, 2.4, 1.5, 45)).toBeCloseTo(d1000 * 2, 12);
    const corrected = atrCorrect(
      Float64Array.from([1000, 2000]),
      Float64Array.from([0.4, 0.4]),
      1000,
    );
    expect(corrected[0]).toBeCloseTo(0.4, 15);
    // Correcting to the depth at 1000 cm⁻¹ scales by the depth ratio dp(1000) / dp(2000) = 2.
    expect(corrected[1]).toBeCloseTo(0.8, 15);
  });

  it('rubber band and the polynomial baseline follow a straight background added to the data', () => {
    const line = x.map((v) => 0.02 + 1e-5 * v);
    const added = y.map((v, i) => v + (line[i] as number));
    const r0 = rubberBandBaseline(x, y);
    const r1 = rubberBandBaseline(x, added);
    r1.forEach((v, i) => expect(v - (r0[i] as number)).toBeCloseTo(line[i] as number, 10));
    const p0 = polynomialBackground(x, y, 3, 200, -1);
    const p1 = polynomialBackground(x, added, 3, 200, -1);
    p1.forEach((v, i) => expect(v - (p0[i] as number)).toBeCloseTo(line[i] as number, 8));
  });
});
