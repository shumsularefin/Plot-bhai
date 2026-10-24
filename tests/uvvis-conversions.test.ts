import { describe, expect, it } from 'vitest';
import {
  absorbanceFromPercentT,
  energyFromWavelength,
  HC_EV_NM,
  kubelkaMunk,
  percentTFromAbsorbance,
  wavelengthFromEnergy,
} from '../src/core/uvvis/conversions';

describe('UV-Vis conversions', () => {
  it('converts percent transmittance to absorbance with the known values', () => {
    expect(absorbanceFromPercentT(100)).toBeCloseTo(0, 12);
    expect(absorbanceFromPercentT(10)).toBeCloseTo(1, 12);
    expect(absorbanceFromPercentT(1)).toBeCloseTo(2, 12);
    expect(absorbanceFromPercentT(50)).toBeCloseTo(0.30103, 5);
  });

  it('round-trips %T and absorbance', () => {
    for (const t of [0.5, 3, 25, 80, 99.9]) {
      expect(percentTFromAbsorbance(absorbanceFromPercentT(t))).toBeCloseTo(t, 9);
    }
    for (const a of [0, 0.1, 1.7, 3]) {
      expect(absorbanceFromPercentT(percentTFromAbsorbance(a))).toBeCloseTo(a, 9);
    }
  });

  it('returns NaN where absorbance is undefined', () => {
    expect(absorbanceFromPercentT(0)).toBeNaN();
    expect(absorbanceFromPercentT(-2)).toBeNaN();
  });

  it('gives Kubelka-Munk F(0.5) = 0.25 and F(1) = 0', () => {
    expect(kubelkaMunk(0.5)).toBeCloseTo(0.25, 12);
    expect(kubelkaMunk(1)).toBe(0);
    expect(kubelkaMunk(0.25)).toBeCloseTo(0.5625 / 0.5, 12);
    expect(kubelkaMunk(0)).toBeNaN();
  });

  it('has hc close to 1239.84 eV nm and converts wavelength and energy both ways', () => {
    expect(HC_EV_NM).toBeGreaterThan(1239.84);
    expect(HC_EV_NM).toBeLessThan(1239.85);
    expect(energyFromWavelength(HC_EV_NM)).toBeCloseTo(1, 12);
    expect(energyFromWavelength(500)).toBeCloseTo(HC_EV_NM / 500, 12);
    expect(wavelengthFromEnergy(energyFromWavelength(387))).toBeCloseTo(387, 9);
  });
});
