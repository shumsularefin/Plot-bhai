import { describe, expect, it } from 'vitest';
import {
  alphaWithReflection,
  extinctionCoefficient,
  indexFromGap,
  opticalConductivity,
  slabTransmittance,
} from '../src/core/uvvis/optics';
import { filmIndex, substrateIndex, swanepoel, type Extremum } from '../src/core/uvvis/swanepoel';

describe('UV-Vis Swanepoel (1983) and optical constants independent validation', () => {
  it('reproduces analytical transparent thin-film thickness (1000 nm) and refractive index', () => {
    // Exact Swanepoel (1983) transparent-region interference fringes:
    // 2 * n(lambda) * d = m * lambda, T_M = 2s/(s^2+1), T_m = 4 n^2 s / (n^4 + n^2(s^2+1) + s^2)
    const s = 1.51;
    const dTrue = 1000;
    const tMax = (2 * s) / (s * s + 1);
    expect(substrateIndex(tMax)).toBeCloseTo(s, 6);

    const nOf = (nm: number) => 2.4 + 2e5 / (nm * nm);
    const solveLambda = (order: number) => {
      let lo = 400;
      let hi = 2500;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (2 * nOf(mid) * dTrue - order * mid > 0) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };

    const orders = [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5];
    const extrema: Extremum[] = orders.map((m) => {
      const wavelengthNm = solveLambda(m);
      const n = nOf(wavelengthNm);
      const tMin = (4 * n * n * s) / (n ** 4 + n * n * (s * s + 1) + s * s);
      const isMax = Number.isInteger(m);
      return { kind: isMax ? 'max' : 'min', wavelengthNm, t: isMax ? tMax : tMin };
    });

    const nCheck = nOf(1000);
    const tMinCheck =
      (4 * nCheck * nCheck * s) / (nCheck ** 4 + nCheck * nCheck * (s * s + 1) + s * s);
    expect(filmIndex(tMax, tMinCheck, s)).toBeCloseTo(nCheck, 6);

    const out = swanepoel(s, extrema);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.d2).toBeGreaterThan(985);
      expect(out.result.d2).toBeLessThan(1015);
    }
  });

  it('inverts Zanatta slab transmittance exactly and clamps noisy T + R > 1 to zero', () => {
    const dCm = 5e-5; // 500 nm film
    const r = 0.12;
    const alphaTrue = 1.5e4;
    const t = slabTransmittance(alphaTrue, r, dCm);
    expect(alphaWithReflection(t, r, dCm)).toBeCloseTo(alphaTrue, 4);
    expect(alphaWithReflection(0.95, 0.1, dCm)).toBe(0);

    // k = alpha * lambda / (4 pi) with lambda in cm
    const k = extinctionCoefficient(alphaTrue, 500);
    expect(k).toBeCloseTo((alphaTrue * 500e-7) / (4 * Math.PI), 6);

    // Optical conductivity sigma = eps0 * c * n * alpha
    const sigma = opticalConductivity(alphaTrue, 2.2);
    expect(sigma).toBeGreaterThan(0);

    // Hervé–Vandamme (1994) Eq. 10: n = sqrt(1 + (13.6 / (Eg + 3.4))^2)
    expect(indexFromGap('herve-vandamme', 3.4)).toBeCloseTo(Math.sqrt(1 + (13.6 / 6.8) ** 2), 6);
  });
});
