// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HC_EV_NM,
  absorbanceFromPercentT,
  energyFromWavelength,
  percentTFromAbsorbance,
  wavelengthFromEnergy,
} from '../src/core/uvvis/conversions';
import {
  absorptionSignal,
  derivativeMaximum,
  fitBandGap,
  taucValues,
  urbachFit,
} from '../src/core/uvvis/tauc';
import { savitzkyGolay } from '../src/core/xrd/process/savitzkyGolay';
import { calibrate, firstOrderKinetics } from '../src/core/uvvis/concentration';
import { fitPlasmon } from '../src/core/uvvis/plasmon';

/*
 * The UV-Vis tool against NumPy, SciPy and lmfit (docs/validation.md, "UV-Vis"). The spectra and
 * the expected numbers are written by scripts/validation/spectra/uvvis.py.
 */

const fixture = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/validation/uvvis-reference.json', import.meta.url),
    'utf8',
  ),
) as {
  hcEvNm: number;
  tauc: {
    wavelengthNm: number[];
    absorbance: number[];
    thicknessNm: number;
    window: [number, number];
    taucCheck: Record<string, number>;
    egEv: number;
    egSigma: number;
    slope: number;
    intercept: number;
    n: number;
    derivativeLinear: [number, number];
    derivativeLog: [number, number];
    smoothed: Record<string, number>;
  };
  urbach: {
    energyEv: number[];
    signal: number[];
    window: [number, number];
    euEv: number;
    euSigma: number;
  };
  calibration: {
    concentrations: number[];
    absorbances: number[];
    slope: number;
    intercept: number;
    slopeSigma: number;
    interceptSigma: number;
    rSquared: number;
    originSlope: number;
    originSlopeSigma: number;
  };
  kinetics: { timesMin: number[]; absorbances: number[]; kPerMin: number; kSigma: number };
  plasmon: {
    wavelengthNm: number[];
    absorbance: number[];
    fromNm: number;
    toNm: number;
    startNm: number;
    centerEv: number;
    centerEvSigma: number;
    fwhmEv: number;
    fwhmEvSigma: number;
    height: number;
  };
};

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const { tauc } = fixture;
const wavelength = Float64Array.from(tauc.wavelengthNm);
const absorbance = Float64Array.from(tauc.absorbance);
const signal = absorptionSignal(
  wavelength,
  absorbance,
  { kind: 'absorbance', scale: 'fraction' },
  tauc.thicknessNm,
);
const y = taucValues(signal.energyEv, signal.signal, 2);

describe('UV-Vis against NumPy, SciPy and lmfit', () => {
  it('h c / e is the CODATA value of scipy.constants', () => {
    expect(rel(HC_EV_NM, fixture.hcEvNm)).toBeLessThan(1e-15);
  });

  it('α from absorbance and film thickness, and the Tauc quantity (αE)²', () => {
    expect(signal.unit).toBe('alpha');
    for (const [i, value] of Object.entries(tauc.taucCheck))
      expect(rel(y[Number(i)] as number, value)).toBeLessThan(1e-12);
  });

  it('Tauc line, Eg = −a/b and σ(Eg) from the full covariance (scipy curve_fit)', () => {
    const fit = fitBandGap(signal.energyEv, y, ...tauc.window);
    expect(fit?.n).toBe(tauc.n);
    // curve_fit is iterative (Levenberg–Marquardt, ftol 1e-8); the closed form here is exact.
    expect(rel(fit?.slope as number, tauc.slope)).toBeLessThan(1e-7);
    expect(rel(fit?.intercept as number, tauc.intercept)).toBeLessThan(1e-7);
    expect(Math.abs((fit?.egEv as number) - tauc.egEv)).toBeLessThan(1e-8);
    expect(rel(fit?.egSigma as number, tauc.egSigma)).toBeLessThan(1e-6);
  });

  it('Urbach energy and its uncertainty', () => {
    const u = fixture.urbach;
    const fit = urbachFit(Float64Array.from(u.energyEv), Float64Array.from(u.signal), ...u.window);
    expect(rel(fit?.euEv as number, u.euEv)).toBeLessThan(1e-9);
    expect(rel(fit?.euSigma as number, u.euSigma)).toBeLessThan(1e-6);
  });

  it('derivative maximum of A and of ln A (9-point numpy.polyfit lines)', () => {
    const e = signal.energyEv;
    const a = Float64Array.from(e, (_, i) => absorbance[absorbance.length - 1 - i] as number);
    const linear = derivativeMaximum(e, a, 'linear', 3, 4);
    expect(linear?.egEv).toBeCloseTo(tauc.derivativeLinear[0], 12);
    expect(rel(linear?.value as number, tauc.derivativeLinear[1])).toBeLessThan(1e-9);
    const log = derivativeMaximum(e, a, 'log', 3, 4);
    expect(log?.egEv).toBeCloseTo(tauc.derivativeLog[0], 12);
    expect(rel(log?.value as number, tauc.derivativeLog[1])).toBeLessThan(1e-9);
  });

  it('Savitzky–Golay smoothing equals scipy savgol_filter(mode="interp"), ends included', () => {
    const smoothed = savitzkyGolay(absorbance, 11, 3);
    for (const [i, value] of Object.entries(tauc.smoothed))
      expect(Math.abs((smoothed[Number(i)] as number) - value)).toBeLessThan(1e-12);
  });

  it('Beer–Lambert line with and without intercept (scipy linregress, curve_fit)', () => {
    const c = fixture.calibration;
    const free = calibrate(c.concentrations, c.absorbances, 1, false);
    expect(rel(free?.fit.slope as number, c.slope)).toBeLessThan(1e-12);
    expect(rel(free?.fit.intercept as number, c.intercept)).toBeLessThan(1e-10);
    expect(rel(free?.fit.slopeSigma as number, c.slopeSigma)).toBeLessThan(1e-9);
    expect(rel(free?.fit.interceptSigma as number, c.interceptSigma)).toBeLessThan(1e-9);
    expect(rel(free?.fit.rSquared as number, c.rSquared)).toBeLessThan(1e-12);
    const origin = calibrate(c.concentrations, c.absorbances, 1, true);
    expect(rel(origin?.fit.slope as number, c.originSlope)).toBeLessThan(1e-9);
    expect(rel(origin?.fit.slopeSigma as number, c.originSlopeSigma)).toBeLessThan(1e-6);
  });

  it('pseudo-first-order rate constant and its standard error', () => {
    const k = fixture.kinetics;
    const result = firstOrderKinetics(k.timesMin, k.absorbances);
    expect(rel(result?.kPerMin as number, k.kPerMin)).toBeLessThan(1e-9);
    expect(rel(result?.kSigma as number, k.kSigma)).toBeLessThan(1e-6);
  });

  it('plasmon band on the energy axis agrees with lmfit LorentzianModel + LinearModel', () => {
    const p = fixture.plasmon;
    const result = fitPlasmon(Float64Array.from(p.wavelengthNm), Float64Array.from(p.absorbance), {
      fromNm: p.fromNm,
      toNm: p.toNm,
      centresNm: [p.startNm],
      profile: 'lorentzian',
    });
    const band = result?.bands[0];
    expect(Math.abs((band?.centerEv as number) - p.centerEv)).toBeLessThan(1e-6);
    expect(rel(band?.fwhmEv as number, p.fwhmEv)).toBeLessThan(1e-5);
    expect(rel(band?.height as number, p.height)).toBeLessThan(1e-5);
    expect(rel(band?.centerEvSigma as number, p.centerEvSigma)).toBeLessThan(1e-3);
    expect(rel(band?.fwhmEvSigma as number, p.fwhmEvSigma)).toBeLessThan(1e-3);
  });
});

describe('UV-Vis round trips and invariances', () => {
  it('%T → A → %T and λ → E → λ return the input', () => {
    for (const t of [0.1, 3, 37.5, 99.9])
      expect(percentTFromAbsorbance(absorbanceFromPercentT(t))).toBeCloseTo(t, 12);
    for (const l of [190, 365.4, 800, 2500])
      expect(wavelengthFromEnergy(energyFromWavelength(l))).toBeCloseTo(l, 10);
  });

  it('the Tauc gap does not depend on the order of the points', () => {
    const forward = fitBandGap(signal.energyEv, y, ...tauc.window);
    const backward = fitBandGap(
      signal.energyEv.slice().reverse(),
      y.slice().reverse(),
      ...tauc.window,
    );
    expect(backward?.egEv).toBeCloseTo(forward?.egEv as number, 12);
    expect(backward?.egSigma).toBeCloseTo(forward?.egSigma as number, 12);
  });

  it('Eg and Eu do not change when the signal is scaled (thickness unknown, other units)', () => {
    const base = fitBandGap(signal.energyEv, y, ...tauc.window);
    for (const k of [1e-4, 0.37, 52]) {
      const scaled = taucValues(
        signal.energyEv,
        signal.signal.map((v) => v * k),
        2,
      );
      const fit = fitBandGap(signal.energyEv, scaled, ...tauc.window);
      expect(fit?.egEv).toBeCloseTo(base?.egEv as number, 10);
      expect(rel(fit?.egSigma as number, base?.egSigma as number)).toBeLessThan(1e-8);
    }
    const u = fixture.urbach;
    const e = Float64Array.from(u.energyEv);
    const s = Float64Array.from(u.signal);
    const eu = urbachFit(e, s, ...u.window)?.euEv as number;
    expect(
      urbachFit(
        e,
        s.map((v) => v * 1e3),
        ...u.window,
      )?.euEv,
    ).toBeCloseTo(eu, 10);
  });

  it('the same spectrum given as %T gives the same α', () => {
    const percentT = absorbance.map((a) => percentTFromAbsorbance(a));
    const fromT = absorptionSignal(
      wavelength,
      percentT,
      { kind: 'transmittance', scale: 'percent' },
      tauc.thicknessNm,
    );
    fromT.signal.forEach((v, i) => expect(rel(v, signal.signal[i] as number)).toBeLessThan(1e-10));
  });
});
