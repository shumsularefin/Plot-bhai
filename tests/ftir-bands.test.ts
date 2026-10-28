// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  bandArea,
  derivativeBands,
  fitBands,
  secondDerivative,
  subtractionFactor,
  subtractSpectrum,
} from '../src/core/ftir/bands';
import { generateFtir } from '../src/core/ftir/synthetic';
import { savitzkyGolayDerivative } from '../src/core/xrd/process/savitzkyGolay';

const grid = (start: number, end: number, step: number) =>
  Float64Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => start + i * step);

/** Gaussian of height h, centre c and FWHM w. */
const gauss = (v: number, h: number, c: number, w: number) =>
  h * Math.exp((-4 * Math.LN2 * (v - c) ** 2) / (w * w));

describe('Savitzky–Golay derivatives', () => {
  const x = grid(0, 10, 0.5);
  const y = x.map((v) => 3 * v * v + 2 * v + 1);

  it('gives the exact second derivative of a quadratic everywhere, ends included', () => {
    const d2 = savitzkyGolayDerivative(y, 7, 2, 2, 0.5);
    for (const v of d2) expect(v).toBeCloseTo(6, 9);
  });

  it('gives the exact first derivative of a quadratic', () => {
    const d1 = savitzkyGolayDerivative(y, 7, 3, 1, 0.5);
    x.forEach((v, i) => expect(d1[i] as number).toBeCloseTo(6 * v + 2, 9));
  });

  it('keeps a cubic second derivative with order 3', () => {
    const cubic = x.map((v) => v ** 3 - v);
    const d2 = savitzkyGolayDerivative(cubic, 9, 3, 2, 0.5);
    x.forEach((v, i) => expect(d2[i] as number).toBeCloseTo(6 * v, 8));
  });
});

describe('second derivative of a spectrum', () => {
  it('resolves two overlapping bands that show as one maximum', () => {
    // Two Lorentzians 16 cm⁻¹ apart with 30 cm⁻¹ FWHM (below Γ/√3 = 17.3 cm⁻¹): one maximum.
    const s = generateFtir({
      startCm: 1500,
      endCm: 1900,
      stepCm: 1,
      bands: [
        { centre: 1692, fwhm: 30, height: 0.5 },
        { centre: 1708, fwhm: 30, height: 0.5 },
      ],
    });
    let maxima = 0;
    for (let i = 1; i < s.absorbance.length - 1; i++)
      if (
        (s.absorbance[i] as number) > (s.absorbance[i - 1] as number) &&
        (s.absorbance[i] as number) > (s.absorbance[i + 1] as number)
      )
        maxima++;
    expect(maxima).toBe(1);
    const d2 = secondDerivative(s.wavenumber, s.absorbance, 9, 3) as Float64Array;
    const bands = derivativeBands(s.wavenumber, d2, 10);
    expect(bands.map((b) => Math.round(b.wavenumber))).toHaveLength(2);
    // The derivative minima are pulled slightly towards each other by the overlap.
    expect(Math.abs((bands[0]?.wavenumber as number) - 1692)).toBeLessThan(3);
    expect(Math.abs((bands[1]?.wavenumber as number) - 1708)).toBeLessThan(3);
    for (const b of bands) expect(b.value).toBeLessThan(0);
  });

  it('refuses unevenly spaced data', () => {
    const x = Float64Array.from([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(secondDerivative(x, x.slice(), 5, 2)).toBeNull();
  });
});

describe('band area', () => {
  it('integrates a Gaussian above a sloped straight baseline', () => {
    const x = grid(1000, 1400, 0.5);
    const w = 20;
    const a = x.map((v) => gauss(v, 0.8, 1200, w) + 0.1 + 0.0004 * (v - 1000));
    const area = bandArea(x, a, 1260, 1140) as NonNullable<ReturnType<typeof bandArea>>;
    // ∫ h exp(−4 ln2 (ν − c)² / w²) dν = h · w · ½ √(π / ln 2); ±60 cm⁻¹ is ±6 widths, so the tails are negligible.
    expect(area.area).toBeCloseTo(0.8 * w * 0.5 * Math.sqrt(Math.PI / Math.LN2), 3);
    expect(area.peakCm).toBeCloseTo(1200, 6);
    expect(area.height).toBeCloseTo(0.8, 6);
    expect(area.fromCm).toBe(1140);
  });

  it('interpolates range ends between data points', () => {
    const x = grid(0, 10, 1);
    const a = x.map(() => 1);
    expect(bandArea(x, a, 2.5, 7.25)?.area).toBeCloseTo(0, 12);
    const tri = x.map((v) => (v <= 5 ? v : 10 - v));
    // Line from (2.5, 2.5) to (7.5, 2.5); triangle above it from 2.5 to 7.5 with height 2.5.
    expect(bandArea(x, tri, 2.5, 7.5)?.area).toBeCloseTo(6.25, 12);
  });

  it('is null outside the data', () => {
    const x = grid(0, 10, 1);
    expect(bandArea(x, x.slice(), 5, 12)).toBeNull();
  });
});

describe('spectrum subtraction', () => {
  // Reference: a band at 1640 only. Sample: 0.7 × reference plus a band at 1100, on another grid.
  const refX = grid(800, 2000, 1.5);
  const refA = refX.map((v) => gauss(v, 0.6, 1640, 50));
  const x = grid(900, 1900, 1);
  const a = x.map((v) => 0.7 * gauss(v, 0.6, 1640, 50) + gauss(v, 0.4, 1100, 30));

  it('finds the scale factor from a range where only the reference absorbs', () => {
    expect(subtractionFactor(x, a, refX, refA, 1560, 1720) as number).toBeCloseTo(0.7, 3);
  });

  it('leaves only the sample band', () => {
    const diff = subtractSpectrum(x, a, refX, refA, 0.7);
    expect(diff.wavenumber.length).toBe(x.length);
    diff.wavenumber.forEach((v, i) =>
      expect(diff.absorbance[i] as number).toBeCloseTo(gauss(v, 0.4, 1100, 30), 3),
    );
  });

  it('keeps only the wavenumbers both spectra cover', () => {
    const short = grid(1000, 1500, 1);
    const diff = subtractSpectrum(
      x,
      a,
      short,
      short.map(() => 0),
      1,
    );
    expect(diff.wavenumber[0]).toBe(1000);
    expect(diff.wavenumber[diff.wavenumber.length - 1]).toBe(1500);
  });

  it('has no factor where the reference does not absorb', () => {
    expect(
      subtractionFactor(
        x,
        a,
        refX,
        refA.map(() => 0),
        900,
        1000,
      ),
    ).toBeNull();
  });
});

describe('band fitting', () => {
  it('recovers two overlapping Gaussian bands on a sloped baseline', () => {
    const x = grid(1550, 1800, 1);
    const truth = [
      { h: 0.5, c: 1650, w: 30 },
      { h: 0.3, c: 1685, w: 25 },
    ];
    const a = x.map(
      (v) => truth.reduce((s, b) => s + gauss(v, b.h, b.c, b.w), 0) + 0.05 + 0.0002 * (v - 1550),
    );
    const fit = fitBands(x, a, {
      fromCm: 1800,
      toCm: 1550,
      centres: [1655, 1680],
      profile: 'gaussian',
    });
    expect(fit.converged).toBe(true);
    expect(fit.rSquared).toBeGreaterThan(0.99999);
    fit.peaks.forEach((p, i) => {
      const t = truth[i] as (typeof truth)[number];
      expect(p.center).toBeCloseTo(t.c, 3);
      expect(p.fwhm).toBeCloseTo(t.w, 3);
      expect(p.height).toBeCloseTo(t.h, 4);
      expect(p.area).toBeCloseTo(t.h * t.w * 0.5 * Math.sqrt(Math.PI / Math.LN2), 3);
    });
    expect(fit.background.slope).toBeCloseTo(0.0002, 6);
  });

  it('fits a Lorentzian band with a pseudo-Voigt and finds η = 1', () => {
    const s = generateFtir({
      startCm: 1000,
      endCm: 1400,
      stepCm: 1,
      bands: [{ centre: 1200, fwhm: 40, height: 0.6 }],
    });
    const fit = fitBands(s.wavenumber, s.absorbance, {
      fromCm: 1000,
      toCm: 1400,
      centres: [1195],
      profile: 'pseudo-voigt',
    });
    const p = fit.peaks[0];
    expect(p?.center).toBeCloseTo(1200, 2);
    expect(p?.eta).toBeGreaterThan(0.95);
  });

  it('ignores starting positions outside the region', () => {
    const x = grid(0, 100, 1);
    const fit = fitBands(
      x,
      x.map((v) => gauss(v, 1, 50, 10)),
      {
        fromCm: 20,
        toCm: 80,
        centres: [50, 95],
        profile: 'gaussian',
      },
    );
    expect(fit.peaks).toHaveLength(1);
  });
});
