import { describe, expect, it } from 'vitest';
import groups from '../data/ftir/groups.json';
import { statesBroad, suggestAssignments } from '../src/core/ftir/assign';
import {
  DEFAULT_FTIR_PROCESSING,
  processSpectrum,
  straightenRange,
  toAbsorbance,
  type FtirProcessing,
} from '../src/core/ftir/process';
import type { FtirSpectrum } from '../src/core/ftir/types';
import { peaksOfSpectrum } from '../src/modules/ftir/analysis';
import {
  DEFAULT_COMPARE_SETTINGS,
  initialFtirData,
  migrateFtirData,
  newId,
  type FtirData,
} from '../src/modules/ftir/data';
import { methodsText } from '../src/modules/ftir/methodsText';
import { shownQuantity } from '../src/modules/ftir/quantity';

function must<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('missing');
  return v;
}

const grid = Float64Array.from({ length: 1801 }, (_, i) => 400 + 2 * i);
const gauss = (x: number, c: number, w: number, h: number) =>
  h * Math.exp((-4 * Math.LN2 * (x - c) ** 2) / w ** 2);
const settings = (patch: Partial<FtirProcessing>): FtirProcessing => ({
  ...DEFAULT_FTIR_PROCESSING,
  ...patch,
});
const absorbance = (values: Float64Array) => ({
  wavenumber: grid,
  values,
  kind: 'absorbance' as const,
  scale: 'percent' as const,
});

describe('reflectance to an absorbance-like quantity', () => {
  it('gives F(R) = (1 − R)²/(2R) for known reflectances, in percent or as a fraction', () => {
    // Synthetic values with exact answers: R = 0.5 → 0.25, R = 0.2 → 1.6, R = 1 → 0.
    const fraction = Float64Array.from([0.5, 0.2, 1]);
    const km = toAbsorbance(fraction, 'reflectance', 'fraction', 'kubelka-munk');
    expect(Array.from(km)).toEqual([0.25, 0.6400000000000001 / 0.4, 0]);
    expect(km[1]).toBeCloseTo(1.6, 14);
    const percent = toAbsorbance(
      fraction.map((v) => v * 100),
      'reflectance',
      'percent',
      'kubelka-munk',
    );
    expect(Array.from(percent)).toEqual(Array.from(km));
    const log = toAbsorbance(fraction, 'reflectance', 'fraction', 'log-inverse');
    expect(log[0]).toBeCloseTo(Math.log10(2), 14);
    expect(log[1]).toBeCloseTo(Math.log10(5), 14);
    expect(log[2]).toBeCloseTo(0, 15);
  });

  it('round-trips: R = 1 + F − √(F² + 2F) recovers the reflectance', () => {
    const r = Float64Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
    const f = toAbsorbance(r, 'reflectance', 'fraction', 'kubelka-munk');
    f.forEach((v, i) => expect(1 + v - Math.sqrt(v * v + 2 * v)).toBeCloseTo(r[i] as number, 12));
  });

  it('removes points with zero or negative reflectance and says why', () => {
    const values = Float64Array.from(grid, (_, i) => (i === 10 ? 0 : 50));
    const out = processSpectrum(
      { wavenumber: grid, values, kind: 'reflectance', scale: 'percent' },
      DEFAULT_FTIR_PROCESSING,
    );
    expect(out.wavenumber).toHaveLength(grid.length - 1);
    expect(out.messages.baseline?.[0]?.text).toContain('reflectance zero or negative');
  });
});

describe('CO₂ region replaced by a straight line', () => {
  // A linear baseline with a doublet inside 2280–2400 cm⁻¹: the line recovers the baseline exactly.
  const base = (x: number) => 0.1 + 0.00005 * x;
  const values = Float64Array.from(
    grid,
    (x) => base(x) + gauss(x, 2337, 10, 0.3) + gauss(x, 2361, 10, 0.35) + gauss(x, 1700, 30, 1),
  );

  it('recovers the underlying straight baseline and leaves every other point unchanged', () => {
    const out = processSpectrum(
      absorbance(values),
      settings({ co2: { enabled: true, fromCm: 2280, toCm: 2400 } }),
    );
    grid.forEach((x, i) => {
      const v = out.absorbance[i] as number;
      if (x >= 2280 && x <= 2400) expect(v).toBeCloseTo(base(x) + gauss(2280, 2337, 10, 0.3), 6);
      else expect(v).toBe(values[i]);
    });
    expect(out.edited).toEqual({ fromCm: 2280, toCm: 2400 });
    expect(out.messages.co2?.[0]?.level).toBe('info');
  });

  it('does not depend on the order of the limits, and is idempotent', () => {
    const a = straightenRange(grid, values, 2280, 2400);
    const b = straightenRange(grid, values, 2400, 2280);
    expect(a).toEqual(b);
    expect(straightenRange(grid, must(a), 2280, 2400)).toEqual(a);
  });

  it('warns and changes nothing for a range outside the spectrum, and is off by default', () => {
    const out = processSpectrum(
      absorbance(values),
      settings({ co2: { enabled: true, fromCm: 4100, toCm: 4200 } }),
    );
    expect(out.absorbance).toEqual(values);
    expect(out.edited).toBeNull();
    expect(out.messages.co2?.[0]?.level).toBe('warning');
    expect(DEFAULT_FTIR_PROCESSING.co2.enabled).toBe(false);
  });

  it('keeps every peak out of the edited range, picked or added by hand', () => {
    const spectrum: FtirSpectrum = {
      id: 's',
      name: 'CO2 test',
      source: 'synthetic',
      wavenumber: grid,
      values,
      kind: 'absorbance',
      scale: 'percent',
      kindOrigin: 'generated',
      synthetic: true,
      notes: [],
    };
    const data: FtirData = { ...initialFtirData, spectra: [spectrum] };
    const before = peaksOfSpectrum(data, spectrum);
    expect(before.some((p) => p.wavenumber > 2280 && p.wavenumber < 2400)).toBe(true);
    const edited: FtirData = {
      ...data,
      processing: { s: settings({ co2: { enabled: true, fromCm: 2280, toCm: 2400 } }) },
      peakEdits: { s: { added: [{ id: 'h', wavenumber: 2361, shoulder: false }], removed: [] } },
    };
    const after = peaksOfSpectrum(edited, spectrum);
    expect(after.some((p) => p.wavenumber >= 2280 && p.wavenumber <= 2400)).toBe(false);
    expect(after.some((p) => Math.abs(p.wavenumber - 1700) < 2)).toBe(true);
    expect(methodsText(edited)).toMatch(/2280–2400 cm⁻¹ was replaced by a straight line/);
    expect(methodsText(data)).not.toMatch(/CO2/);
  });
});

describe('normalisation to a chosen band', () => {
  // A Gaussian of height 0.6 and FWHM 40 cm⁻¹ at 1600 cm⁻¹ on a sloped baseline.
  const sloped = (x: number) => 0.05 + 0.0001 * x;
  const values = Float64Array.from(
    grid,
    (x) => sloped(x) + gauss(x, 1600, 40, 0.6) + gauss(x, 1000, 60, 0.9),
  );
  const band = (measure: 'height' | 'area', fromCm = 1400, toCm = 1800) =>
    settings({ normalise: { enabled: true, method: 'band', band: { fromCm, toCm, measure } } });

  it('divides by the height above the line between the range ends (known answer)', () => {
    const out = processSpectrum(absorbance(values), band('height'));
    // The ends of ±200 cm⁻¹ lie 5 FWHM out, where the band is below 1e-29: the line is the baseline.
    const i = grid.indexOf(1600);
    expect((out.absorbance[i] as number) - sloped(1600) / 0.6).toBeCloseTo(1, 10);
    expect(out.messages.normalise?.[0]?.text).toContain('height of the band at 1600');
  });

  it('divides by the area, ∫ = h·FWHM·√(π / (4 ln 2)) for a Gaussian', () => {
    const out = processSpectrum(absorbance(values), band('area'));
    const area = 0.6 * 40 * Math.sqrt(Math.PI / (4 * Math.LN2));
    const i = grid.indexOf(1000);
    expect(out.absorbance[i] as number).toBeCloseTo((values[i] as number) / area, 6);
  });

  it('gives the same result for a spectrum scaled by any factor and for reversed limits', () => {
    const scaled = processSpectrum(absorbance(values.map((v) => v * 7.5)), band('area'));
    const plain = processSpectrum(absorbance(values), band('area', 1800, 1400));
    scaled.absorbance.forEach((v, i) => expect(v).toBeCloseTo(plain.absorbance[i] as number, 12));
  });

  it('warns and changes nothing when the band is absent, negative or not typed', () => {
    for (const [s, text] of [
      [band('height', 2500, 2700), 'absent or negative'],
      [band('height', 1625, 1700), 'at an end of the range'],
      [band('area', 5000, 6000), 'not inside the spectrum'],
      [
        settings({
          normalise: {
            enabled: true,
            method: 'band',
            band: { fromCm: null, toCm: null, measure: 'height' },
          },
        }),
        'Type the range',
      ],
    ] as const) {
      const out = processSpectrum(absorbance(values), s);
      expect(out.absorbance).toEqual(values);
      expect(out.messages.normalise?.[0]?.level).toBe('warning');
      expect(out.messages.normalise?.[0]?.text).toContain(text);
    }
    // A dip (a negative band) is refused too.
    const dip = Float64Array.from(grid, (x) => 1 - gauss(x, 1600, 40, 0.5));
    const out = processSpectrum(absorbance(dip), band('height'));
    expect(out.absorbance).toEqual(dip);
    expect(out.messages.normalise?.[0]?.text).toContain('absent or negative');
  });
});

describe('reflectance in the FTIR module', () => {
  const r: FtirSpectrum = {
    id: 'r',
    name: 'DRIFTS',
    source: 'csv',
    wavenumber: grid,
    values: Float64Array.from(grid, (x) => 80 - 40 * Math.exp(-(((x - 1600) / 20) ** 2))),
    kind: 'reflectance',
    scale: 'percent',
    kindOrigin: 'header',
    synthetic: false,
    notes: [],
  };

  it('names the quantity and keeps a transmittance view from showing it', () => {
    const view = { quantity: 'transmittance' as const };
    const km = shownQuantity({ view, processing: {} }, [r]);
    expect(km).toMatchObject({ quantity: 'absorbance', name: 'Kubelka–Munk F(R)' });
    expect(km.reason).toContain('reflectance spectrum');
    const log = shownQuantity(
      { view, processing: { r: settings({ reflectance: 'log-inverse' }) } },
      [r],
    );
    expect(log.csvName).toBe('log10(1/R)');
    expect(
      shownQuantity({ view: { quantity: 'absorbance' }, processing: {} }, [r]).reason,
    ).toBeNull();
  });

  it('states the Kubelka–Munk conversion and its assumption in the methods text', () => {
    const data: FtirData = { ...initialFtirData, spectra: [r] };
    expect(methodsText(data)).toMatch(/Kubelka–Munk function F\(R\) = \(1 − R\)²\/\(2R\)/);
    expect(methodsText(data)).toMatch(/optically thick, diluted and strongly scattering/);
    const log = { ...data, processing: { r: settings({ reflectance: 'log-inverse' }) } };
    expect(methodsText(log)).toMatch(/apparent absorbance log10\(1\/R\)/);
    expect(methodsText(log)).not.toMatch(/Kubelka/);
  });
});

describe('saved FTIR sessions, version 5', () => {
  it('get the defaults for reflectance, the CO₂ line and the band normalisation', () => {
    const old = {
      atr: DEFAULT_FTIR_PROCESSING.atr,
      baseline: { ...DEFAULT_FTIR_PROCESSING.baseline, enabled: true },
      smoothing: DEFAULT_FTIR_PROCESSING.smoothing,
      normalise: { enabled: true, method: 'minmax' },
    };
    const id = newId();
    const upgraded = migrateFtirData(
      {
        step: 2,
        furthest: 5,
        data: { ...initialFtirData, processing: { [id]: old }, toleranceCm: 9 },
      },
      5,
    );
    const p = must(upgraded?.data.processing[id]);
    expect(p.reflectance).toBe('kubelka-munk');
    expect(p.co2.enabled).toBe(false);
    expect(p.normalise).toEqual({
      enabled: true,
      method: 'minmax',
      band: DEFAULT_FTIR_PROCESSING.normalise.band,
    });
    expect(p.baseline.enabled).toBe(true);
    expect(upgraded?.data.toleranceCm).toBe(9);
    expect(upgraded?.data.compare).toEqual(DEFAULT_COMPARE_SETTINGS);
    expect(upgraded?.step).toBe(2);
  });
});

describe('suggestions use the width of the peak where the table states it', () => {
  it('reads "broad" only where the label says so', () => {
    const broad = groups.functionalGroups.filter((g) => statesBroad(g.label)).map((g) => g.label);
    expect(broad).toEqual([
      'OH of water (broad)',
      'hydrogen–bonded –OH str. (broad)',
      'N–H wagging vib. (2° amines), broad',
      'NH2 def. vib. (1° amides), broad',
    ]);
  });

  const table = {
    functionalGroups: [
      { id: 'a', label: 'free O–H str.', ranges: [{ from: 3300, to: 3500 }] },
      { id: 'b', label: 'hydrogen–bonded –OH str. (broad)', ranges: [{ from: 3200, to: 3500 }] },
    ],
    metalOxides: [],
  };

  it('ranks a broad row first for a broad peak and last for a narrow one, and says why', () => {
    const plain = suggestAssignments(3400, table, 15);
    expect(plain.map((s) => s.id)).toEqual(['a', 'b']);
    const broad = suggestAssignments(3400, table, 15, 6, undefined, { broad: true, fwhm: 250 });
    expect(broad.map((s) => s.id)).toEqual(['b', 'a']);
    expect(broad[0]?.reason).toContain('broad (250 cm⁻¹ wide at half height), so it ranks higher');
    expect(broad[1]?.reason).not.toContain('broad');
    const narrow = suggestAssignments(3400, table, 15, 6, undefined, { broad: false, fwhm: 20 });
    expect(narrow.map((s) => s.id)).toEqual(['a', 'b']);
    expect(narrow[1]?.reason).toContain('but this peak is not');
  });

  it('never lets the width outrank the position', () => {
    const t = {
      functionalGroups: [
        { id: 'in', label: 'x', ranges: [{ from: 3390, to: 3410 }] },
        { id: 'near', label: 'y (broad)', ranges: [{ from: 3420, to: 3500 }] },
      ],
      metalOxides: [],
    };
    const s = suggestAssignments(3400, t, 30, 6, undefined, { broad: true, fwhm: 200 });
    expect(s.map((x) => x.id)).toEqual(['in', 'near']);
  });
});
