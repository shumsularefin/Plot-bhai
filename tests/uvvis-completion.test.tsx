import { render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { energyFromWavelength } from '../src/core/uvvis/conversions';
import {
  codyGap,
  sigmoid,
  sigmoidGap,
  SIGMOID_N,
  suggestSigmoidRange,
} from '../src/core/uvvis/crossChecks';
import {
  alphaWithReflection,
  extinctionCoefficient,
  indexFromGap,
  inIndexRange,
  slabTransmittance,
} from '../src/core/uvvis/optics';
import { DEFAULT_UVVIS_PEAKS, uvvisPeaks } from '../src/core/uvvis/peaks';
import { bandEdgeAbsorbance } from '../src/core/uvvis/synthetic';
import type { Spectrum } from '../src/core/uvvis/types';
import { fitMessages, resultRows } from '../src/modules/uvvis/analysis';
import { BandsStep } from '../src/modules/uvvis/BandsStep';
import {
  DEFAULT_BAND_GAP,
  initialUvvisData,
  migrateUvvisData,
  type BandGapChoice,
  type UvvisData,
} from '../src/modules/uvvis/data';
import { methodsText } from '../src/modules/uvvis/methodsText';
import { RESULT_COLUMNS } from '../src/modules/uvvis/tables';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const grid = (from: number, to: number, step: number) =>
  Float64Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

function spectrum(id: string, wavelengthNm: Float64Array, values: Float64Array): Spectrum {
  return {
    id,
    name: id,
    source: 'synthetic',
    wavelengthNm,
    values,
    kind: 'absorbance',
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
}

const edge = (id = 's') => {
  const s = bandEdgeAbsorbance({ startNm: 250, endNm: 850, stepNm: 1, bandGapEv: 3.2, n: 0.5 });
  return spectrum(id, s.wavelengthNm, s.values);
};

const session = (spectra: Spectrum[], bandGap: Record<string, BandGapChoice> = {}): UvvisData => ({
  ...initialUvvisData,
  spectra,
  bandGap,
});

describe('Cody gap', () => {
  it('is exact for S = B·E·(E − Eg)²', () => {
    const e = grid(1.2, 2.6, 0.01);
    const s = e.map((x) => (x > 1.7 ? 3e4 * x * (x - 1.7) ** 2 : 0));
    const gap = codyGap(e, s, [1.9, 2.4]);
    expect(gap.fit?.egEv).toBeCloseTo(1.7, 10);
  });

  it('does not change when the signal is scaled', () => {
    const e = grid(1.2, 2.6, 0.01);
    const s = e.map((x) => (x > 1.7 ? x * (x - 1.7) ** 2 + 0.001 * Math.sin(40 * x) : 0));
    const a = codyGap(e, s, [1.9, 2.4]).fit?.egEv as number;
    const b = codyGap(
      e,
      s.map((v) => 123 * v),
      [1.9, 2.4],
    ).fit?.egEv as number;
    expect(b).toBeCloseTo(a, 10);
  });
});

describe('Sigmoid gap (Zanatta 2019)', () => {
  const e = grid(2.6, 3.8, 0.005);
  const s = e.map((x) => sigmoid(x, 1e3, 5e4, 3.25, 0.05));

  it('recovers E0 and δE, and Eg = E0 − n·δE', () => {
    for (const type of ['direct', 'indirect', 'amorphous'] as const) {
      const fit = sigmoidGap(e, s, [3.0, 3.5], type, false);
      expect(fit?.e0Ev).toBeCloseTo(3.25, 6);
      expect(fit?.deltaEv).toBeCloseTo(0.05, 6);
      expect(fit?.egEv).toBeCloseTo(3.25 - SIGMOID_N[type] * 0.05, 6);
    }
  });

  it('does not depend on the order of the range limits or the scale of S', () => {
    const a = sigmoidGap(e, s, [3.0, 3.5], 'direct', false);
    const b = sigmoidGap(
      e,
      s.map((v) => 0.01 * v),
      [3.5, 3.0],
      'direct',
      false,
    );
    expect(b?.egEv).toBeCloseTo(a?.egEv as number, 6);
  });

  it('suggests a range around E0', () => {
    const range = suggestSigmoidRange(e, s, 3.2);
    expect(range).not.toBeNull();
    const mid = ((range?.[0] as number) + (range?.[1] as number)) / 2;
    expect(Math.abs(mid - 3.25)).toBeLessThan(0.03);
  });
});

describe('Optical constants', () => {
  it('inverts the slab transmittance', () => {
    for (const [alpha, r, d] of [
      [1e4, 0.1, 5e-5],
      [3e5, 0.3, 1e-4],
      [50, 0.05, 2e-5],
    ] as const) {
      const t = slabTransmittance(alpha, r, d);
      expect(alphaWithReflection(t, r, d) / alpha).toBeCloseTo(1, 10);
    }
  });

  it('reduces to Beer–Lambert at R = 0 and to Zanatta Eq. 5 at large αd', () => {
    expect(alphaWithReflection(0.2, 0, 1e-4)).toBeCloseTo(Math.log(1 / 0.2) / 1e-4, 6);
    const t = 1e-6;
    const r = 0.2;
    const d = 1e-4;
    expect(alphaWithReflection(t, r, d) / (Math.log((1 - r) ** 2 / t) / d)).toBeCloseTo(1, 8);
  });

  it('gives k = αλ/4π', () => {
    // k = 0.1 at 500 nm means α = 4π·0.1/(500e-7 cm) = 25132.74 cm⁻¹.
    expect(extinctionCoefficient(25132.74122871834, 500)).toBeCloseTo(0.1, 12);
  });

  it('gives n from Eg by the three relations', () => {
    expect(indexFromGap('ravindra', 1)).toBeCloseTo(3.464, 12);
    expect(indexFromGap('herve-vandamme', 3.33)).toBeCloseTo(Math.sqrt(5), 12);
    expect(indexFromGap('moss', 95 / 16)).toBeCloseTo(2, 12);
    expect(indexFromGap('ravindra', 7)).toBeNaN();
    expect(inIndexRange('herve-vandamme', 1)).toBe(false);
    expect(inIndexRange('moss', 3)).toBe(true);
  });
});

describe('UV-Vis band table', () => {
  const x = grid(300, 800, 1);
  const gauss = (c: number, w: number, h: number) =>
    x.map((v) => h * Math.exp(-0.5 * ((v - c) / w) ** 2));
  const y = gauss(450, 18, 0.8).map((v, i) => v + (gauss(620, 30, 0.45)[i] as number) + 0.05);

  it('finds the bands, in nm and eV', () => {
    const peaks = uvvisPeaks(x, y, DEFAULT_UVVIS_PEAKS);
    expect(peaks.map((p) => p.wavelengthNm)).toEqual([
      expect.closeTo(450, 0.3),
      expect.closeTo(620, 0.5),
    ]);
    expect(peaks[0]?.energyEv).toBeCloseTo(energyFromWavelength(peaks[0]?.wavelengthNm as number));
    expect(peaks[0]?.relative).toBeCloseTo(100);
  });

  it('removes a band and adds one by hand or as a shoulder', () => {
    const removed = uvvisPeaks(x, y, DEFAULT_UVVIS_PEAKS, { added: [], removed: [452] });
    expect(removed).toHaveLength(1);
    const added = uvvisPeaks(x, y, DEFAULT_UVVIS_PEAKS, {
      added: [{ id: 'h', wavelengthNm: 520, shoulder: true }],
      removed: [],
    });
    expect(added.map((p) => p.origin)).toEqual(['picked', 'shoulder', 'picked']);
    expect(added[1]?.prominence).toBe(0);
  });
});

describe('UV-Vis 19e in the module', () => {
  it('loads a version 4 session: step past the new Bands step, Eg unchanged', () => {
    const s = edge();
    // A version 4 choice: no reported, sample, pathCm, reflectanceId, cody or sigmoid.
    const added = ['reported', 'sample', 'pathCm', 'reflectanceId', 'cody', 'sigmoid'];
    const v4choice = Object.fromEntries(
      Object.entries(DEFAULT_BAND_GAP).filter(([k]) => !added.includes(k)),
    );
    const saved = {
      step: 3,
      furthest: 3,
      data: { spectra: [s], plot: initialUvvisData.plot, bandGap: { s: v4choice } },
    };
    const migrated = migrateUvvisData(saved, 4);
    expect(migrated?.step).toBe(4);
    expect(migrated?.furthest).toBe(4);
    expect(migrated?.data.bandGap.s?.sample).toBe('film');
    expect(migrated?.data.figures).toEqual(initialUvvisData.figures);
    const before = resultRows(session([s]))[0]?.analysis.fit?.egEv;
    expect(resultRows(migrated?.data as UvvisData)[0]?.analysis.fit?.egEv).toBe(before);
  });

  it('reports a second transition as its own row, with cross-checks on the first only', () => {
    const rows = resultRows(
      session([edge()], {
        s: {
          ...DEFAULT_BAND_GAP,
          reported: ['indirect-allowed'],
          cody: { enabled: true, region: null },
          sigmoid: { enabled: true, type: null, range: null },
        },
      }),
    );
    expect(rows.map((r) => [r.choice.transition, r.primary])).toEqual([
      ['direct-allowed', true],
      ['indirect-allowed', false],
    ]);
    expect(rows[0]?.analysis.cody).not.toBeNull();
    expect(rows[0]?.analysis.sigmoid).not.toBeNull();
    expect(rows[1]?.analysis.cody).toBeNull();
    expect(rows[1]?.analysis.sigmoid).toBeNull();
  });

  it('turns absorbance into α for a 1 cm cuvette without moving Eg', () => {
    const plain = resultRows(session([edge()]))[0];
    const [row] = resultRows(
      session([edge()], { s: { ...DEFAULT_BAND_GAP, sample: 'solution', pathCm: 1 } }),
    );
    expect(row?.analysis.signal.unit).toBe('alpha');
    const i = 100;
    expect(row?.analysis.signal.signal[i]).toBeCloseTo(
      Math.LN10 * (plain?.analysis.signal.signal[i] as number),
      10,
    );
    expect(row?.analysis.fit?.egEv).toBeCloseTo(plain?.analysis.fit?.egEv as number, 6);
    expect(fitMessages(row?.analysis as never).some((m) => m.text.includes('solution'))).toBe(true);
  });

  it('corrects the α of a film for reflection and says so', () => {
    const s = edge();
    const r: Spectrum = {
      ...spectrum(
        'r',
        s.wavelengthNm,
        s.wavelengthNm.map(() => 10),
      ),
      kind: 'reflectance',
    };
    const choice = { ...DEFAULT_BAND_GAP, thicknessNm: 500 };
    const without = resultRows(session([s, r], { s: choice }))[0];
    const [row] = resultRows(session([s, r], { s: { ...choice, reflectanceId: 'r' } }));
    expect(without?.analysis.reflection).toEqual({ state: 'none' });
    expect(row?.analysis.reflection).toEqual({ state: 'corrected', name: 'r' });
    const i = 50;
    const n = s.values.length;
    const a = s.values[n - 1 - i] as number;
    expect(row?.analysis.signal.signal[i]).toBeCloseTo(
      alphaWithReflection(10 ** -a, 0.1, 500e-7),
      6,
    );
    const texts = (x: typeof row) => fitMessages(x?.analysis as never).map((m) => m.text);
    expect(texts(row).some((t) => t.includes('corrected for reflection'))).toBe(true);
    expect(texts(without).some((t) => t.includes('reflect'))).toBe(true);
  });

  it('puts the new methods in the methods text and the CSV', () => {
    const text = methodsText(
      session([edge()], {
        s: {
          ...DEFAULT_BAND_GAP,
          cody: { enabled: true, region: null },
          sigmoid: { enabled: true, type: null, range: null },
        },
      }),
    );
    expect(text).toContain('Cody');
    expect(text).toContain('Zanatta');
    const headers = RESULT_COLUMNS.map((c) => c.header);
    for (const h of [
      'Transition role',
      'Sample type',
      'Path length (cm)',
      'Reflection correction',
      'Cody Eg (eV)',
      'Sigmoid Eg (eV)',
      'n Moss (estimate)',
    ])
      expect(headers).toContain(h);
  });

  it('renders the Bands step with its table', () => {
    const x = grid(300, 800, 1);
    const y = x.map((v) => 0.8 * Math.exp(-0.5 * ((v - 450) / 18) ** 2) + 0.05);
    render(<BandsStep data={session([spectrum('b', x, y)])} update={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Band table (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /band at 450\.0 nm/, hidden: true })).toBeTruthy();
  });
});
