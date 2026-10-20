// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { linearFit } from '../src/core/math/linearFit';
import {
  dislocationDensity,
  halderWagner,
  monshi,
  scherrer,
  sizeStrainPlot,
  specificSurfaceArea,
  spacingNm,
  williamsonHallUdedm,
  williamsonHallUdm,
  williamsonHallUsdm,
  type SizePeak,
  type SizeSettings,
} from '../src/core/xrd/size/methods';
import { seededRandom } from '../src/core/xrd/synthetic';

/*
 * Known-answer tests. Peak widths are built from a chosen size D and strain ε with the
 * broadening model each method assumes, so each method must return D and ε:
 *  - exactly (to rounding, relative 1e-9) for noise-free widths, because every method is an
 *    exact inversion of its own model;
 *  - within 3 standard uncertainties for widths with 3 % random noise. The reported σ comes
 *    from the fit residuals, so 3σ is the honest tolerance (about 0.3 % chance of a false
 *    failure per check, and the seed is fixed so the outcome is repeatable).
 */

const DEG = Math.PI / 180;
const LAMBDA = 0.15405929; // nm, Cu Kα1 (Hölzer et al. 1997)
const K = 0.9;
const D = 30; // nm
const EPS = 1.5e-3;
const ANGLES = [25.3, 31.8, 38.1, 44.6, 52.0, 57.9, 64.3, 71.5, 77.8];
const settings: SizeSettings = { k: K, lambdaNm: LAMBDA, modulusGPa: null };
const theta = (twoTheta: number) => (twoTheta / 2) * DEG;

/** Peaks with widths β(2θ) in radians and a small σ. */
function peaksFrom(
  width: (twoTheta: number, i: number) => number,
  noise = 0,
  seed = 1,
): SizePeak[] {
  const random = seededRandom(seed);
  return ANGLES.map((twoTheta, i) => {
    const normal = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const beta = width(twoTheta, i) * (1 + noise * normal);
    return { twoTheta, beta, betaSigma: 0.01 * beta, modulusGPa: null };
  });
}

/** Size-only broadening (Scherrer and Monshi model). */
const sizeOnly = (tt: number) => (K * LAMBDA) / (D * Math.cos(theta(tt)));
/** Williamson–Hall UDM model: β cos θ = Kλ/D + 4ε sin θ. */
const udm = (tt: number) =>
  ((K * LAMBDA) / D + 4 * EPS * Math.sin(theta(tt))) / Math.cos(theta(tt));
/** Lorentzian size and Gaussian strain: β² = β β_D + β_ε² (SSP and Halder–Wagner model). */
const lorentzGauss = (tt: number) => {
  const bd = sizeOnly(tt);
  const be = 4 * EPS * Math.tan(theta(tt));
  return bd / 2 + Math.sqrt((bd * bd) / 4 + be * be);
};

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const within3Sigma = (e: { value: number; sigma: number }, truth: number) =>
  expect(Math.abs(e.value - truth)).toBeLessThan(3 * e.sigma);

describe('straight-line fit', () => {
  it('matches hand-computed values', () => {
    // y = 1 + 2x with residuals +0.1, −0.1, −0.1, +0.1: slope 2, intercept 1, SSR = 0.04.
    const fit = linearFit([0, 1, 2, 3], [1.1, 2.9, 4.9, 7.1]);
    expect(fit?.slope).toBeCloseTo(2, 12);
    expect(fit?.intercept).toBeCloseTo(1, 12);
    // s² = 0.04 / 2 = 0.02, Sxx = 5: σ(slope) = √(0.02/5), σ(intercept) = √(0.02 (1/4 + 2.25/5)).
    expect(fit?.slopeSigma).toBeCloseTo(Math.sqrt(0.02 / 5), 12);
    expect(fit?.interceptSigma).toBeCloseTo(Math.sqrt(0.02 * (0.25 + 2.25 / 5)), 12);
    expect(linearFit([1], [1])).toBeNull();
    expect(linearFit([2, 2], [1, 3])).toBeNull();
  });
});

describe('Scherrer and Monshi recover a size-only sample', () => {
  it('Scherrer gives D for every peak, with zero spread', () => {
    const r = scherrer(peaksFrom(sizeOnly), settings);
    for (const row of r.rows) expect(rel(row.size.value, D)).toBeLessThan(1e-9);
    expect(rel(r.mean, D)).toBeLessThan(1e-9);
    expect(r.sd).toBeLessThan(1e-9);
    expect(r.rows[0]?.size.sigma).toBeCloseTo(0.01 * D, 9);
  });

  it('Monshi gives D with slope 1', () => {
    const r = monshi(peaksFrom(sizeOnly), settings);
    expect(rel(r.size?.value as number, D)).toBeLessThan(1e-9);
    expect(r.fit?.slope).toBeCloseTo(1, 9);
    expect(r.messages).toHaveLength(0);
  });

  it('with 3 % noise both stay within 3σ', () => {
    const peaks = peaksFrom(sizeOnly, 0.03, 4);
    const s = scherrer(peaks, settings);
    expect(Math.abs(s.mean - D)).toBeLessThan((3 * s.sd) / Math.sqrt(s.rows.length));
    within3Sigma(monshi(peaks, settings).size as { value: number; sigma: number }, D);
  });

  it('with strain present, Scherrer underestimates the size (it puts all width on size)', () => {
    expect(scherrer(peaksFrom(udm), settings).mean).toBeLessThan(D);
  });
});

describe('Williamson–Hall recovers size and strain', () => {
  it('UDM: exact D and ε', () => {
    const r = williamsonHallUdm(peaksFrom(udm), settings);
    expect(rel(r.size?.value as number, D)).toBeLessThan(1e-9);
    expect(rel(r.strain?.value as number, EPS)).toBeLessThan(1e-9);
    expect(r.fit?.rSquared).toBeCloseTo(1, 9);
  });

  it('UDM with 3 % noise: D and ε within 3σ', () => {
    const r = williamsonHallUdm(peaksFrom(udm, 0.03, 2), settings);
    within3Sigma(r.size as { value: number; sigma: number }, D);
    within3Sigma(r.strain as { value: number; sigma: number }, EPS);
  });

  // Direction-dependent moduli (GPa), one per peak, with a uniform stress of 0.3 GPa.
  const E = [130, 210, 170, 250, 140, 190, 230, 160, 200];
  const STRESS = 0.3;
  const withModuli = (width: (tt: number, i: number) => number) =>
    peaksFrom(width).map((p, i) => ({ ...p, modulusGPa: E[i] as number }));

  it('USDM: exact D and stress with per-peak moduli; strain = mean σ/E', () => {
    const usdm = (tt: number, i: number) =>
      ((K * LAMBDA) / D + (4 * STRESS * Math.sin(theta(tt))) / (E[i] as number)) /
      Math.cos(theta(tt));
    const r = williamsonHallUsdm(withModuli(usdm), settings);
    expect(rel(r.size?.value as number, D)).toBeLessThan(1e-9);
    expect(rel(r.stress?.value as number, STRESS)).toBeLessThan(1e-9);
    const meanStrain = E.reduce((s, e) => s + STRESS / e, 0) / E.length;
    expect(rel(r.strain?.value as number, meanStrain)).toBeLessThan(1e-9);
  });

  it('UDEDM: exact D and energy density u (kJ/m³)', () => {
    const uGPa = 2.25e-4; // = ε² E / 2 for ε = 1.5e-3, E = 200 GPa
    const udedm = (tt: number, i: number) =>
      ((K * LAMBDA) / D + 4 * Math.sin(theta(tt)) * Math.sqrt((2 * uGPa) / (E[i] as number))) /
      Math.cos(theta(tt));
    const r = williamsonHallUdedm(withModuli(udedm), settings);
    expect(rel(r.size?.value as number, D)).toBeLessThan(1e-9);
    expect(rel(r.energyDensity?.value as number, uGPa * 1e6)).toBeLessThan(1e-9);
  });

  it('with one common modulus, USDM and UDEDM reduce to UDM strain', () => {
    const common = { ...settings, modulusGPa: 200 };
    const peaks = peaksFrom(udm);
    const usdm = williamsonHallUsdm(peaks, common);
    const udedm = williamsonHallUdedm(peaks, common);
    expect(rel(usdm.strain?.value as number, EPS)).toBeLessThan(1e-9);
    expect(rel(usdm.stress?.value as number, EPS * 200)).toBeLessThan(1e-9);
    expect(rel(udedm.strain?.value as number, EPS)).toBeLessThan(1e-9);
    expect(rel(udedm.energyDensity?.value as number, ((EPS * EPS * 200) / 2) * 1e6)).toBeLessThan(
      1e-9,
    );
  });

  it('USDM and UDEDM say what is missing without a modulus', () => {
    expect(williamsonHallUsdm(peaksFrom(udm), settings).unavailable).toContain("Young's modulus");
    expect(williamsonHallUdedm(peaksFrom(udm), settings).unavailable).toContain("Young's modulus");
  });
});

describe('size–strain plot and Halder–Wagner recover size and strain', () => {
  it('both give exact D and ε for Lorentzian size with Gaussian strain', () => {
    for (const method of [sizeStrainPlot, halderWagner]) {
      const r = method(peaksFrom(lorentzGauss), settings);
      expect(rel(r.size?.value as number, D)).toBeLessThan(1e-9);
      expect(rel(r.strain?.value as number, EPS)).toBeLessThan(1e-9);
    }
  });

  it('with 3 % noise: within 3σ, and the two methods agree exactly', () => {
    const peaks = peaksFrom(lorentzGauss, 0.03, 3);
    const ssp = sizeStrainPlot(peaks, settings);
    const hw = halderWagner(peaks, settings);
    within3Sigma(ssp.size as { value: number; sigma: number }, D);
    within3Sigma(ssp.strain as { value: number; sigma: number }, EPS);
    expect(rel(hw.size?.value as number, ssp.size?.value as number)).toBeLessThan(1e-9);
    expect(rel(hw.strain?.value as number, ssp.strain?.value as number)).toBeLessThan(1e-9);
  });

  it('d from Bragg: 2θ = 30° with λ = 0.15405929 nm', () => {
    expect(spacingNm(30, LAMBDA)).toBeCloseTo(LAMBDA / (2 * Math.sin(15 * DEG)), 14);
  });
});

describe('physically meaningless results are refused, with a reason', () => {
  it('a width that falls with angle gives no strain (negative slope)', () => {
    // β cos θ decreasing with sin θ.
    const falling = (tt: number) => (0.01 - 0.004 * Math.sin(theta(tt))) / Math.cos(theta(tt));
    const r = williamsonHallUdm(peaksFrom(falling), settings);
    expect(r.strain?.value).toBeNaN();
    expect(r.messages.some((m) => m.level === 'error' && m.text.includes('negative'))).toBe(true);
    expect(r.size?.value).toBeGreaterThan(0);
  });

  it('a negative intercept gives no size', () => {
    const steep = (tt: number) => (-0.0005 + 0.01 * Math.sin(theta(tt))) / Math.cos(theta(tt));
    const r = williamsonHallUdm(peaksFrom(steep), settings);
    expect(r.size?.value).toBeNaN();
    expect(r.messages.some((m) => m.text.includes('at or below zero'))).toBe(true);
  });

  it('size-only data give a negative SSP intercept → no strain, size still given', () => {
    // Pure size broadening has zero strain; 3 % noise pushes the intercept either way.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = sizeStrainPlot(peaksFrom(sizeOnly, 0.03, seed), settings);
      if ((r.fit?.intercept as number) < 0) {
        expect(r.strain?.value).toBeNaN();
        expect(r.messages.some((m) => m.text.includes('below zero'))).toBe(true);
        return;
      }
    }
    throw new Error('no seed gave a negative intercept');
  });

  it('Monshi warns when the slope is far from 1', () => {
    const r = monshi(
      peaksFrom((tt) => 4 * EPS * Math.tan(theta(tt))),
      settings,
    );
    expect(r.messages.some((m) => m.text.includes('far from the value of 1'))).toBe(true);
  });
});

describe('derived quantities', () => {
  it('dislocation density and specific surface area', () => {
    const delta = dislocationDensity({ value: 20, sigma: 1 });
    expect(delta.value).toBeCloseTo(1 / 20e-9 ** 2, 0);
    expect(delta.sigma / delta.value).toBeCloseTo(0.1, 12);
    // 6 / (ρ D): ρ = 4 g/cm³ = 4e6 g/m³, D = 20e-9 m → 6 / 0.08 = 75 m²/g.
    expect(specificSurfaceArea({ value: 20, sigma: 0 }, 4).value).toBeCloseTo(75, 12);
    expect(dislocationDensity({ value: NaN, sigma: NaN }).value).toBeNaN();
  });
});
