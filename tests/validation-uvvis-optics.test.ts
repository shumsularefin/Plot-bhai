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
  it('reproduces Swanepoel (1983) Table 1 a-Si:H film thickness (1000 nm) and refractive index', () => {
    // Swanepoel (1983), J. Phys. E: Sci. Instrum. 16, 1214, Table 1 (s = 1.51, true d = 1000 nm)
    const s = 1.51;
    expect(substrateIndex(0.92)).toBeCloseTo(1.512, 2);

    const extrema: Extremum[] = [
      { kind: 'max', wavelengthNm: 1470, value: 0.92, opposite: 0.562 },
      { kind: 'min', wavelengthNm: 1215, value: 0.553, opposite: 0.92 },
      { kind: 'max', wavelengthNm: 1039, value: 0.92, opposite: 0.541 },
      { kind: 'min', wavelengthNm: 910, value: 0.525, opposite: 0.92 },
      { kind: 'max', wavelengthNm: 814, value: 0.92, opposite: 0.506 },
      { kind: 'min', wavelengthNm: 737, value: 0.483, opposite: 0.92 },
      { kind: 'max', wavelengthNm: 677, value: 0.918, opposite: 0.453 },
    ];
    expect(filmIndex(0.92, 0.562, s)).toBeCloseTo(2.61, 2);
    const out = swanepoel(s, extrema);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.thicknessNm).toBeGreaterThan(980);
      expect(out.result.thicknessNm).toBeLessThan(1020);
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

    // Optical conductivity sigma = eps0 * c * n * alpha (in S/m when alpha in m^-1)
    const sigma = opticalConductivity(alphaTrue, 2.2);
    expect(sigma).toBeGreaterThan(0);

    // Hervé–Vandamme (1994) Eq. 10: n = sqrt(1 + (13.6 / (Eg + 3.4))^2)
    expect(indexFromGap('herve-vandamme', 3.4)).toBeCloseTo(Math.sqrt(1 + (13.6 / 6.8) ** 2), 6);
  });
});
