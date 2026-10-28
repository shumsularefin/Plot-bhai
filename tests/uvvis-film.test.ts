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

describe('Swanepoel (1983) published values', () => {
  // Table 1 of the paper (a-Si:H film on glass, s = 1.51): wavelength, T_M, T_m and n₁ from eq. (11).
  const table1: [number, number, number, number][] = [
    [859, 0.919, 0.478, 3.015],
    [814, 0.919, 0.47, 3.052],
    [775, 0.916, 0.46, 3.095],
    [740, 0.913, 0.448, 3.149],
    [710, 0.908, 0.437, 3.198],
    [683, 0.896, 0.426, 3.24],
    [659, 0.882, 0.413, 3.293],
    [636, 0.847, 0.398, 3.335],
    [617, 0.805, 0.378, 3.4],
    [598, 0.715, 0.354, 3.42],
    [582, 0.616, 0.319, 3.496],
    [564, 0.433, 0.256, 3.57],
    [555, 0.328, 0.21, 3.668],
  ];

  it('reproduces the refractive index of every row of Table 1', () => {
    for (const [, tMax, tMin, n1] of table1) {
      expect(filmIndex(tMax, tMin, 1.51)).toBeCloseTo(n1, 2);
    }
  });

  it('gives the thickness of the first pairs of adjacent maxima or minima (eq. 23)', () => {
    // The paper's d₁ column in nm (rows 3 to 11; the last two rows were rejected there), found from
    // the rounded n₁ of the table.
    const published = [1035, 988, 979, 1023, 1013, 1002, 975, 1049, 1006];
    published.forEach((d1, k) => {
      const [l1, , , n1] = table1[k] as (typeof table1)[number];
      const [l2, , , n2] = table1[k + 2] as (typeof table1)[number];
      const d = (l1 * l2) / (2 * (l1 * n2 - l2 * n1));
      expect(Math.abs(d - d1)).toBeLessThan(3);
    });
  });
});
