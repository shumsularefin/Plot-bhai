import { describe, expect, it } from 'vitest';
import { energyFromWavelength } from '../src/core/uvvis/conversions';
import {
  absorptionSignal,
  analyseTaucGap,
  componentFactor,
  componentGap,
  interpolateOnto,
  TRANSITIONS,
  type TaucGapOptions,
  type TransitionId,
} from '../src/core/uvvis/tauc';
import { edgeShape, seededNoise } from '../src/core/uvvis/synthetic';
import type { Spectrum } from '../src/core/uvvis/types';
import { fitMessages, resultRows } from '../src/modules/uvvis/analysis';
import {
  DEFAULT_BAND_GAP,
  initialUvvisData,
  migrateUvvisData,
  type BandGapChoice,
  type UvvisData,
} from '../src/modules/uvvis/data';
import { methodsText } from '../src/modules/uvvis/methodsText';
import { RESULT_COLUMNS } from '../src/modules/uvvis/tables';

// Makuła, Pacia and Macyk, J. Phys. Chem. Lett. 9 (2018) 6814, eq 4: the spectrum of a modified
// semiconductor is α = α_s + c·α_m, and Eg is read from the Tauc plot of α − c·α_m (their Table 1,
// column 2). Synthetic model of their system: an edge at 3.2 eV plus a broad dye band centred
// at 2.9 eV (Gaussian in E, σ 0.4 eV, peak 0.4) that still absorbs across the edge, so no straight line
// describes it there. The dye measured on its own has 1/0.6 times the strength, so c = 0.6.

const EG = 3.2;
const C = 0.6;
const wavelengths = (step = 1, start = 250) =>
  Float64Array.from({ length: Math.floor((850 - start) / step) + 1 }, (_, i) => start + i * step);
const dye = (e: number) => 0.4 * Math.exp(-0.5 * ((e - 2.9) / 0.4) ** 2);
const STRENGTH: Record<TransitionId, number> = {
  'direct-allowed': 1.2,
  'indirect-allowed': 1.5,
  'direct-forbidden': 1.5,
  'indirect-forbidden': 1.5,
};
const edge = (e: number, id: TransitionId) =>
  edgeShape(e, EG, 1 / TRANSITIONS[id].exponent, STRENGTH[id]);

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const absorbance = (wl: Float64Array, f: (e: number) => number) =>
  absorptionSignal(
    wl,
    wl.map((w) => f(energyFromWavelength(w))),
    { kind: 'absorbance', scale: 'percent' },
    null,
  );
/** Percent reflectance whose Kubelka–Munk function is f(E). */
const reflectance = (wl: Float64Array, f: (e: number) => number) =>
  absorptionSignal(
    wl,
    wl.map((w) => {
      const k = f(energyFromWavelength(w));
      return 100 * (1 + k - Math.sqrt(k * k + 2 * k));
    }),
    { kind: 'reflectance', scale: 'percent' },
    null,
  );

function options(
  component: Float64Array,
  factor: number | null = null,
  extra: Partial<TaucGapOptions> = {},
): TaucGapOptions {
  return {
    method: 'subtract-component',
    edgeRegion: null,
    baselineRegion: null,
    component: { signal: component, factor },
    ...extra,
  };
}

describe('second component subtracted (synthetic, known answer)', () => {
  // Tolerance 0.002 eV, as for the baseline subtraction: the model is exact, only the grid remains.
  const TOLERANCE = 0.002;
  const wl = wavelengths();

  it.each(['direct-allowed', 'indirect-allowed'] as const)(
    '%s, absorbance: c = 0.6 and Eg = 3.200 eV',
    (id) => {
      const sample = absorbance(wl, (e) => edge(e, id) + dye(e));
      const component = absorbance(wl, (e) => dye(e) / C);
      const result = analyseTaucGap(
        sample.energyEv,
        sample.signal,
        TRANSITIONS[id].exponent,
        options(component.signal),
      );
      expect(must(result.componentFactor).value).toBeCloseTo(C, 9);
      expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(TOLERANCE);
    },
  );

  it.each(['direct-allowed', 'indirect-allowed'] as const)(
    '%s, Kubelka–Munk: dye band added to F(R), Eg = 3.200 eV',
    (id) => {
      const sample = reflectance(wl, (e) => 0.002 + edge(e, id) + dye(e));
      const component = reflectance(wl, (e) => (0.002 + dye(e)) / C);
      const result = analyseTaucGap(
        sample.energyEv,
        sample.signal,
        TRANSITIONS[id].exponent,
        options(component.signal),
      );
      expect(must(result.componentFactor).value).toBeCloseTo(C, 6);
      expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(TOLERANCE);
    },
  );

  it('the other three methods read the dye edge instead (measured, recorded in docs/validation.md)', () => {
    const id = 'direct-allowed';
    const sample = absorbance(wl, (e) => edge(e, id) + dye(e));
    const component = absorbance(wl, (e) => dye(e) / C);
    const run = (method: TaucGapOptions['method']) =>
      must(
        analyseTaucGap(sample.energyEv, sample.signal, 2, {
          ...options(component.signal),
          method,
        }).fit,
      ).egEv;
    const errors = {
      component: Math.abs(run('subtract-component') - EG),
      straight: Math.abs(run('subtract-baseline') - EG),
      crossing: Math.abs(run('baseline-crossing') - EG),
      axis: Math.abs(run('axis') - EG),
    };
    expect(errors.component).toBeLessThan(TOLERANCE);
    // Measured: 2.368, 2.424 and 2.396 eV, the edge of the dye band, as in column 1 of Table 1 of
    // Makuła et al. (2.13 to 3.08 eV for TiO2 with methyl orange, against 3.22 eV for TiO2).
    expect(errors.axis).toBeGreaterThan(0.5);
    expect(errors.straight).toBeGreaterThan(0.5);
    expect(errors.crossing).toBeGreaterThan(0.5);
  });

  it('a typed c of 0.6 gives the same gap; a wrong c moves it', () => {
    const sample = absorbance(wl, (e) => edge(e, 'direct-allowed') + dye(e));
    const component = absorbance(wl, (e) => dye(e) / C);
    const typed = analyseTaucGap(sample.energyEv, sample.signal, 2, options(component.signal, C));
    expect(must(typed.componentFactor)).toEqual({ value: C, sigma: 0, n: 0 });
    expect(Math.abs(must(typed.fit).egEv - EG)).toBeLessThan(TOLERANCE);
    // Over the same edge region as the right c, half of the dye is left in and pulls Eg down.
    const edgeRegion = must(typed.region);
    const wrong = analyseTaucGap(
      sample.energyEv,
      sample.signal,
      2,
      options(component.signal, 0.3, { edgeRegion }),
    );
    expect(must(wrong.fit).egEv).toBeLessThan(EG - 0.01);
  });
});

describe('factor c (independent hand calculation)', () => {
  it('S = 2·M exactly: c = 2, σ = 0', () => {
    const e = Float64Array.from([1, 2, 3, 4, 5]);
    const f = componentFactor(
      e,
      Float64Array.from([2, 4, 6, 8, 99]),
      Float64Array.from([1, 2, 3, 4, 5]),
      [1, 4],
    );
    expect(f).toEqual({ value: 2, sigma: 0, n: 4 });
  });

  it('S = (1, 3, 2, 5), M = (1, 1, 1, 2): c = 12/7, σ by hand', () => {
    const e = Float64Array.from([1, 2, 3, 4]);
    const f = must(
      componentFactor(e, Float64Array.from([1, 3, 2, 5]), Float64Array.from([1, 1, 1, 2]), [0, 9]),
    );
    // Σ S·M = 1 + 3 + 2 + 10 = 16, Σ M² = 7, c = 16/7; residuals 1 − 16/7, 3 − 16/7, 2 − 16/7,
    // 5 − 32/7, so RSS = (81 + 25 + 4 + 9)/49 = 119/49 and σ² = (119/49)/3/7.
    expect(f.value).toBeCloseTo(16 / 7, 12);
    expect(f.sigma).toBeCloseTo(Math.sqrt(119 / 49 / 3 / 7), 12);
  });

  it('needs 4 points and a component that is not zero', () => {
    const e = Float64Array.from([1, 2, 3, 4]);
    const s = Float64Array.from([1, 2, 3, 4]);
    expect(componentFactor(e, s, s, [1, 3])).toBeNull();
    expect(componentFactor(e, s, new Float64Array(4), [0, 9])).toBeNull();
  });
});

describe('uncertainty of the factor c carried into Eg (Monte Carlo, independent)', () => {
  it('400 data sets with noise only in the region where c is fitted: σ reported ≈ scatter', () => {
    const wl = wavelengths();
    const clean = absorbance(wl, (e) => edge(e, 'direct-allowed') + dye(e));
    const component = absorbance(wl, (e) => dye(e) / C);
    const region: [number, number] = [2.3, 3.0];
    const edgeRegion: [number, number] = [3.22, 3.45];
    const gaps: number[] = [];
    const sigmas: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const noise = seededNoise(seed, 0.003);
      const signal = clean.signal.map((v, i) => {
        const e = clean.energyEv[i] as number;
        return e >= region[0] && e <= region[1] ? v + noise() : v;
      });
      const factor = must(componentFactor(clean.energyEv, signal, component.signal, region));
      const fit = must(
        componentGap(clean.energyEv, signal, 2, component.signal, factor, edgeRegion),
      );
      gaps.push(fit.egEv);
      sigmas.push(fit.egSigma);
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const scatter = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length - 1));
    const reported = sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
    expect(reported / scatter).toBeGreaterThan(0.85);
    expect(reported / scatter).toBeLessThan(1.15);
    expect(Math.abs(mean - EG)).toBeLessThan(0.002);
  });
});

describe('invariance', () => {
  const wl = wavelengths();
  const sample = absorbance(wl, (e) => edge(e, 'direct-allowed') + dye(e));

  it('component 37 times stronger: c / 37, Eg unchanged', () => {
    const one = absorbance(wl, (e) => dye(e) / C);
    const big = absorbance(wl, (e) => (37 * dye(e)) / C);
    const a = analyseTaucGap(sample.energyEv, sample.signal, 2, options(one.signal));
    const b = analyseTaucGap(sample.energyEv, sample.signal, 2, options(big.signal));
    expect(must(b.componentFactor).value * 37).toBeCloseTo(must(a.componentFactor).value, 9);
    expect(must(b.fit).egEv).toBeCloseTo(must(a.fit).egEv, 9);
  });

  it('component on another grid (2 nm steps from 251 nm), interpolated: Eg = 3.200 eV', () => {
    const other = absorbance(wavelengths(2, 251), (e) => dye(e) / C);
    const onGrid = interpolateOnto(other.energyEv, other.signal, sample.energyEv);
    const result = analyseTaucGap(sample.energyEv, sample.signal, 2, options(onGrid));
    expect(Math.abs(must(result.fit).egEv - EG)).toBeLessThan(0.002);
  });

  it('interpolation is exact on a straight line and NaN outside the data', () => {
    const x = Float64Array.from([1, 2, 4]);
    const y = Float64Array.from([3, 5, 9]);
    const out = interpolateOnto(x, y, Float64Array.from([0.5, 1, 1.5, 3, 4, 5]));
    expect(Array.from(out)).toEqual([NaN, 3, 4, 7, 9, NaN]);
  });
});

function spectrum(
  id: string,
  kind: 'absorbance' | 'reflectance',
  f: (e: number) => number,
): Spectrum {
  const wl = wavelengths();
  return {
    id,
    name: id,
    source: 'synthetic',
    wavelengthNm: wl,
    values: wl.map((w) => {
      const v = f(energyFromWavelength(w));
      return kind === 'absorbance' ? v : 100 * (1 + v - Math.sqrt(v * v + 2 * v));
    }),
    kind,
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
}

describe('in the module (results table, methods text, messages, saved sessions)', () => {
  const sample = spectrum('dyed TiO2', 'absorbance', (e) => edge(e, 'direct-allowed') + dye(e));
  const dyeAlone = spectrum('dye alone', 'absorbance', (e) => dye(e) / C);
  const choice: BandGapChoice = {
    ...DEFAULT_BAND_GAP,
    method: 'subtract-component',
    component: { spectrumId: 'dye alone', factor: null },
  };
  const data = (bandGap: UvvisData['bandGap']): UvvisData => ({
    ...initialUvvisData,
    spectra: [sample, dyeAlone],
    bandGap,
  });
  const column = (header: string) => must(RESULT_COLUMNS.find((c) => c.header === header));

  it('names the component and c in the table, the CSV and the methods text', () => {
    const d = data({ 'dyed TiO2': choice });
    const [row] = resultRows(d);
    const r = must(row);
    expect(Math.abs(must(r.analysis.fit).egEv - EG)).toBeLessThan(0.002);
    expect(column('Second component').value(r)).toBe('dye alone');
    expect(Number(column('Factor c').value(r))).toBeCloseTo(C, 6);
    const text = methodsText(d);
    expect(text).toContain('α_s = α − c·α_m');
    expect(text).toContain('dye alone, c = 0.6');
    expect(text).toContain('Makuła, Pacia and Macyk');
  });

  it('asks for a component when none is chosen, and refuses one measured another way', () => {
    const none = resultRows(data({ 'dyed TiO2': { ...choice, component: null } }))[0];
    expect(must(none).analysis.fit).toBeNull();
    expect(
      fitMessages(must(none).analysis)
        .map((m) => m.text)
        .join(' '),
    ).toContain('Choose the spectrum of the second component');
    const reflecting = spectrum('dye alone', 'reflectance', (e) => dye(e) / C);
    const mixed = resultRows({
      ...initialUvvisData,
      spectra: [sample, reflecting],
      bandGap: { 'dyed TiO2': choice },
    })[0];
    expect(must(mixed).analysis.componentProblem).toBe('unit');
  });

  it('a version 3 session is read unchanged, with no component', () => {
    const v3choice = { ...DEFAULT_BAND_GAP, method: 'subtract-baseline' } as Record<
      string,
      unknown
    >;
    delete v3choice.component;
    const v3 = { step: 2, furthest: 3, data: { ...data({}), bandGap: { 'dyed TiO2': v3choice } } };
    const upgraded = must(migrateUvvisData(v3, 3));
    expect(upgraded.data.bandGap['dyed TiO2']).toEqual({
      ...DEFAULT_BAND_GAP,
      method: 'subtract-baseline',
      component: null,
    });
  });
});
