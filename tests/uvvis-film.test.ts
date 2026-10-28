import { describe, expect, it } from 'vitest';
import { fitPlasmon } from '../src/core/uvvis/plasmon';
import { filmIndex, findExtrema, substrateIndex, swanepoel } from '../src/core/uvvis/swanepoel';
import { HC_EV_NM } from '../src/core/uvvis/conversions';
import {
  EXAMPLE_FILM,
  EXAMPLE_PLASMON,
  exampleFilmSpectrum,
  examplePlasmonSpectrum,
} from '../src/modules/uvvis/film/example';

describe('plasmon band fit', () => {
  it('recovers the centre and width of a Lorentzian band on the energy axis', () => {
    const s = examplePlasmonSpectrum();
    const out = fitPlasmon(s.wavelengthNm, s.values, {
      fromNm: 400,
      toNm: 750,
      centresNm: [530],
      profile: 'lorentzian',
    });
    const band = out?.bands[0];
    expect(band?.centerEv).toBeCloseTo(EXAMPLE_PLASMON.centerEv, 4);
    expect(band?.fwhmEv).toBeCloseTo(EXAMPLE_PLASMON.fwhmEv, 3);
    expect(band?.height).toBeCloseTo(EXAMPLE_PLASMON.height, 3);
    expect(band?.centerNm).toBeCloseTo(HC_EV_NM / EXAMPLE_PLASMON.centerEv, 6);
    // The wavelength width is the distance between the two half-height energies.
    const w = EXAMPLE_PLASMON.fwhmEv / 2;
    const expected =
      HC_EV_NM / (EXAMPLE_PLASMON.centerEv - w) - HC_EV_NM / (EXAMPLE_PLASMON.centerEv + w);
    expect(band?.fwhmNm).toBeCloseTo(expected, 1);
    expect(out?.fit.rSquared).toBeGreaterThan(0.9999);
  });

  it('needs enough points in the range', () => {
    const s = examplePlasmonSpectrum();
    expect(
      fitPlasmon(s.wavelengthNm, s.values, {
        fromNm: 500,
        toNm: 505,
        centresNm: [502],
        profile: 'gaussian',
      }),
    ).toBeNull();
  });
});

describe('Swanepoel envelope method', () => {
  it('gives the substrate index from its transmittance', () => {
    const s = 1.51;
    expect(substrateIndex((2 * s) / (s * s + 1))).toBeCloseTo(s, 12);
    expect(substrateIndex(0)).toBeNull();
  });

  it('inverts the envelopes of a non-absorbing film exactly', () => {
    const n = 2.3;
    const s = 1.51;
    const A = 16 * n * n * s;
    const B = (n + 1) ** 3 * (n + s * s);
    const C = 2 * (n * n - 1) * (n * n - s * s);
    const D = (n - 1) ** 3 * (n - s * s);
    expect(filmIndex(A / (B - C + D), A / (B + C + D), s)).toBeCloseTo(n, 12);
  });

  it('recovers the thickness and index of the synthetic film', () => {
    const spec = exampleFilmSpectrum();
    const t = spec.values.map((v) => v / 100);
    const extrema = findExtrema(spec.wavelengthNm, t, 0.02);
    const out = swanepoel(EXAMPLE_FILM.substrate, extrema);
    if (!out.ok) throw new Error(out.error);
    const r = out.result;
    // Linear envelopes and dispersion between extrema leave errors of about a per cent.
    expect(Math.abs(r.d2 / EXAMPLE_FILM.thicknessNm - 1)).toBeLessThan(0.01);
    for (const row of r.rows) {
      expect(Math.abs(row.n2 / EXAMPLE_FILM.index(row.wavelengthNm) - 1)).toBeLessThan(0.01);
      expect(row.m % 0.5).toBe(0);
      expect(Number.isInteger(row.m)).toBe(row.kind === 'max');
    }
  });

  it('refuses a spectrum without fringes', () => {
    const x = Float64Array.from({ length: 100 }, (_, i) => 400 + i);
    expect(
      swanepoel(
        1.5,
        findExtrema(
          x,
          x.map(() => 0.8),
          0.01,
        ),
      ).ok,
    ).toBe(false);
  });
});
