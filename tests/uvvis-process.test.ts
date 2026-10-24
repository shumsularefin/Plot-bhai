import { describe, expect, it } from 'vitest';
import {
  absorbanceFromPercentT,
  energyFromWavelength,
  kubelkaMunk,
} from '../src/core/uvvis/conversions';
import {
  availableQuantities,
  cleanSpectrum,
  DEFAULT_CLEANING,
  lambdaMax,
  toQuantity,
  type CleaningSettings,
} from '../src/core/uvvis/process';
import {
  blankAbsorbance,
  directGapAbsorbance,
  directGapReflectance,
  EXAMPLE_BAND_GAP_EV,
} from '../src/core/uvvis/synthetic';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const grid = { startNm: 250, endNm: 800, stepNm: 1 };
const absorbance = (values: Float64Array, wavelengthNm: Float64Array) => ({
  wavelengthNm,
  values,
  kind: 'absorbance' as const,
  scale: 'percent' as const,
});
const withSettings = (patch: Partial<CleaningSettings>): CleaningSettings => ({
  ...DEFAULT_CLEANING,
  ...patch,
});

describe('cleanSpectrum', () => {
  it('returns the data unchanged with every step off', () => {
    const { wavelengthNm, values } = directGapAbsorbance({ ...grid, bandGapEv: 3.2 });
    const cleaned = cleanSpectrum(absorbance(values, wavelengthNm), DEFAULT_CLEANING);
    expect(Array.from(cleaned.values)).toEqual(Array.from(values));
  });

  it('subtracts a blank absorbance recovering the true curve', () => {
    const sample = directGapAbsorbance({ ...grid, bandGapEv: 3.2, baseline: 0 });
    const blank = blankAbsorbance({ ...grid, offset: 0.05, slopePerNm: 0.0002 });
    const measured = sample.values.map((v, i) => v + (blank.values[i] as number));
    const cleaned = cleanSpectrum(
      absorbance(measured, sample.wavelengthNm),
      withSettings({ blank: { enabled: true, blankId: 'b' } }),
      absorbance(blank.values, blank.wavelengthNm),
    );
    for (let i = 0; i < measured.length; i += 37) {
      expect(cleaned.values[i]).toBeCloseTo(sample.values[i] as number, 10);
    }
  });

  it('interpolates a blank measured on a coarser grid and drops points it does not cover', () => {
    const sample = directGapAbsorbance({ ...grid, bandGapEv: 3.2, baseline: 0 });
    const blank = blankAbsorbance({
      startNm: 300,
      endNm: 800,
      stepNm: 5,
      offset: 0.1,
      slopePerNm: 0,
    });
    const cleaned = cleanSpectrum(
      absorbance(sample.values, sample.wavelengthNm),
      withSettings({ blank: { enabled: true, blankId: 'b' } }),
      absorbance(blank.values, blank.wavelengthNm),
    );
    expect(cleaned.wavelengthNm[0]).toBe(300);
    expect(cleaned.values[0]).toBeCloseTo((sample.values[50] as number) - 0.1, 10);
    expect(cleaned.messages.blank?.[0]?.text).toContain('50 points were removed');
  });

  it('removes a baseline offset measured in a window', () => {
    const sample = directGapAbsorbance({ ...grid, bandGapEv: 3.2, baseline: 0 });
    const shifted = sample.values.map((v) => v + 0.3);
    const cleaned = cleanSpectrum(
      absorbance(shifted, sample.wavelengthNm),
      withSettings({ offset: { enabled: true, fromNm: 700, toNm: 800 } }),
    );
    // Above 388 nm (3.2 eV) the true absorbance is zero, so the window mean is the offset.
    expect(cleaned.values[500]).toBeCloseTo(0, 10);
    expect(cleaned.values[0]).toBeCloseTo(sample.values[0] as number, 10);
  });

  it('treats a transmittance blank as a ratio: T_sample / T_blank', () => {
    const wavelengthNm = Float64Array.from({ length: 30 }, (_, i) => 300 + i);
    const tSample = Float64Array.from(wavelengthNm, (_, i) => 40 + i);
    const tBlank = Float64Array.from(wavelengthNm, () => 80);
    const cleaned = cleanSpectrum(
      { wavelengthNm, values: tSample, kind: 'transmittance', scale: 'percent' },
      withSettings({ blank: { enabled: true, blankId: 'b' } }),
      { wavelengthNm, values: tBlank, kind: 'transmittance', scale: 'percent' },
    );
    expect(cleaned.values[0]).toBeCloseTo(50, 9);
    expect(cleaned.values[20]).toBeCloseTo((60 / 80) * 100, 9);
  });

  it('removes points where the logarithm cannot be taken and says so', () => {
    const wavelengthNm = Float64Array.from({ length: 30 }, (_, i) => 300 + i);
    const t = Float64Array.from(wavelengthNm, (_, i) => (i === 4 ? 0 : 50));
    const cleaned = cleanSpectrum(
      { wavelengthNm, values: t, kind: 'transmittance', scale: 'percent' },
      withSettings({ offset: { enabled: true, fromNm: 310, toNm: 329 } }),
    );
    expect(cleaned.values).toHaveLength(29);
    expect(cleaned.messages.offset?.some((m) => m.text.includes('1 point was removed'))).toBe(true);
  });

  it('smooths noise towards the true curve and keeps the input unchanged', () => {
    const clean = directGapAbsorbance({ ...grid, bandGapEv: 3.2 });
    const noisy = directGapAbsorbance({ ...grid, bandGapEv: 3.2, noiseSeed: 7, noiseSd: 0.02 });
    const copy = Array.from(noisy.values);
    const smoothed = cleanSpectrum(
      absorbance(noisy.values, noisy.wavelengthNm),
      withSettings({ smoothing: { enabled: true, window: 21, order: 3 } }),
    );
    // Compare above 500 nm, away from the absorption edge, where the true curve is smooth.
    const rms = (a: Float64Array) => {
      const from = 250;
      let sum = 0;
      for (let i = from; i < a.length; i++)
        sum += ((a[i] as number) - (clean.values[i] as number)) ** 2;
      return Math.sqrt(sum / (a.length - from));
    };
    expect(rms(smoothed.values)).toBeLessThan(rms(noisy.values) / 2);
    expect(Array.from(noisy.values)).toEqual(copy);
  });

  it('skips smoothing for unevenly spaced wavelengths and for too few points', () => {
    const x = Float64Array.from([
      300, 301, 302, 304, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324,
      325, 326, 327, 328, 329, 330,
    ]);
    const y = Float64Array.from(x, (_, i) => Math.sin(i));
    const uneven = cleanSpectrum(
      absorbance(y, x),
      withSettings({ smoothing: { enabled: true, window: 5, order: 2 } }),
    );
    expect(uneven.messages.smoothing?.[0]?.text).toContain('not even');
    expect(Array.from(uneven.values)).toEqual(Array.from(y));
    const few = cleanSpectrum(
      absorbance(y.slice(0, 4), x.slice(0, 4)),
      withSettings({ smoothing: { enabled: true, window: 5, order: 2 } }),
    );
    expect(few.messages.smoothing?.[0]?.text).toContain('fewer than the window');
  });
});

describe('toQuantity and lambdaMax', () => {
  it('converts between transmittance and absorbance and offers only valid views', () => {
    expect(availableQuantities('reflectance')).toEqual(['reflectance', 'kubelka-munk']);
    const a = toQuantity(
      Float64Array.from([100, 10, 1]),
      { kind: 'transmittance', scale: 'percent' },
      'absorbance',
    );
    expect(Array.from(must(a))).toEqual([0, 1, 2].map((v) => expect.closeTo(v, 12)));
    const t = toQuantity(
      Float64Array.from([0, 1, 2]),
      { kind: 'absorbance', scale: 'percent' },
      'transmittance',
    );
    expect(must(t)[1]).toBeCloseTo(10, 12);
    expect(
      toQuantity(
        Float64Array.from([0.5]),
        { kind: 'absorbance', scale: 'percent' },
        'kubelka-munk',
      ),
    ).toBeNull();
    const fraction = toQuantity(
      Float64Array.from([0.5]),
      { kind: 'transmittance', scale: 'fraction' },
      'transmittance',
    );
    expect(must(fraction)[0]).toBe(50);
    expect(absorbanceFromPercentT(50)).toBeCloseTo(
      toQuantity(
        Float64Array.from([0.5]),
        { kind: 'transmittance', scale: 'fraction' },
        'absorbance',
      )?.[0] as number,
      12,
    );
  });

  it('recovers the Kubelka-Munk function used to build a reflectance spectrum', () => {
    const { wavelengthNm, values } = directGapReflectance({
      ...grid,
      bandGapEv: EXAMPLE_BAND_GAP_EV,
      floor: 0,
    });
    const f = toQuantity(values, { kind: 'reflectance', scale: 'percent' }, 'kubelka-munk');
    if (!f) throw new Error('expected a conversion');
    const i = wavelengthNm.indexOf(300);
    const e = energyFromWavelength(300);
    expect(f[i]).toBeCloseTo((8 * Math.sqrt(e - EXAMPLE_BAND_GAP_EV)) / e, 8);
    expect(kubelkaMunk(0.5)).toBeCloseTo(0.25, 12);
  });

  it('finds the wavelength of the strongest absorbance within a range', () => {
    const x = Float64Array.from({ length: 101 }, (_, i) => 400 + i);
    const y = Float64Array.from(
      x,
      (w) => Math.exp(-(((w - 450) / 20) ** 2)) + 0.5 * Math.exp(-(((w - 480) / 5) ** 2)),
    );
    const m = { kind: 'absorbance' as const, scale: 'percent' as const };
    expect(lambdaMax(x, y, m)?.wavelengthNm).toBe(450);
    expect(lambdaMax(x, y, m, 470, 500)?.wavelengthNm).toBe(480);
    expect(lambdaMax(x, y, m, 400, 430)?.wavelengthNm).toBe(430);
    expect(lambdaMax(x, y, m, 900, 950)).toBeNull();
    const t = Float64Array.from(y, (a) => 100 * 10 ** -a);
    expect(lambdaMax(x, t, { kind: 'transmittance', scale: 'percent' })?.wavelengthNm).toBe(450);
    const r = Float64Array.from(y, (a) => 100 * 10 ** -a);
    expect(lambdaMax(x, r, { kind: 'reflectance', scale: 'percent' })?.quantity).toBe(
      'kubelka-munk',
    );
  });
});
