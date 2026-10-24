import { describe, expect, it } from 'vitest';
import { HC_EV_NM } from '../src/core/uvvis/conversions';
import { DEFAULT_CLEANING } from '../src/core/uvvis/process';
import { EXAMPLE_BAND_GAP_EV } from '../src/core/uvvis/synthetic';
import { analyseBandGap, cleanAll, fitMessages, resultRows } from '../src/modules/uvvis/analysis';
import {
  DEFAULT_BAND_GAP,
  exampleSpectra,
  initialUvvisData,
  migrateUvvisData,
  UVVIS_STATE_VERSION,
  type UvvisData,
} from '../src/modules/uvvis/data';
import { methodsText } from '../src/modules/uvvis/methodsText';
import { parseUvvisSession, serialiseUvvisSession } from '../src/modules/uvvis/session';

function exampleData(): UvvisData {
  const spectra = exampleSpectra();
  const [sample, blank] = spectra;
  if (!sample || !blank) throw new Error('example spectra missing');
  return {
    ...initialUvvisData,
    spectra,
    cleaning: {
      [sample.id]: { ...DEFAULT_CLEANING, blank: { enabled: true, blankId: blank.id } },
    },
  };
}

describe('band gap of the example spectra', () => {
  it('recovers the chosen gap from the blank-corrected absorbance and the reflectance example', () => {
    const rows = resultRows(exampleData());
    const absorbance = rows[0]?.analysis.fit;
    const reflectance = rows[2]?.analysis.fit;
    expect(Math.abs((absorbance?.egEv ?? NaN) - EXAMPLE_BAND_GAP_EV)).toBeLessThan(0.02);
    expect(Math.abs((reflectance?.egEv ?? NaN) - EXAMPLE_BAND_GAP_EV)).toBeLessThan(0.02);
    expect(rows[0]?.edgeNm).toBeCloseTo(HC_EV_NM / (absorbance?.egEv ?? NaN), 9);
  });

  it('uses a typed region instead of the suggestion and says which it used', () => {
    const data = exampleData();
    const [sample] = data.spectra;
    if (!sample) throw new Error('missing');
    const cleaned = cleanAll(data.spectra, data.cleaning)[0];
    if (!cleaned) throw new Error('missing');
    const suggested = analyseBandGap(sample, cleaned, DEFAULT_BAND_GAP);
    expect(suggested.suggested).toBe(true);
    const typed = analyseBandGap(sample, cleaned, {
      ...DEFAULT_BAND_GAP,
      regions: { 'direct-allowed': [3.6, 4.2] },
    });
    expect(typed.suggested).toBe(false);
    expect(typed.fit?.fromEv).toBeGreaterThanOrEqual(3.6);
    expect(typed.fit?.toEv).toBeLessThanOrEqual(4.2);
  });
});

describe('fitMessages', () => {
  it('explains a failed fit and a missing thickness in plain words', () => {
    const data = exampleData();
    const [sample] = data.spectra;
    const cleaned = cleanAll(data.spectra, data.cleaning)[0];
    if (!sample || !cleaned) throw new Error('missing');
    const bad = analyseBandGap(sample, cleaned, {
      ...DEFAULT_BAND_GAP,
      regions: { 'direct-allowed': [1.5, 1.6] },
    });
    expect(fitMessages(bad)[0]?.text).toContain('No rising straight line');
    const good = analyseBandGap(sample, cleaned, DEFAULT_BAND_GAP);
    expect(fitMessages(good).some((m) => m.text.includes('No film thickness'))).toBe(true);
  });
});

describe('Urbach and derivative settings flow through', () => {
  it('reports the derivative maximum when switched on', () => {
    const data = exampleData();
    const [sample] = data.spectra;
    const cleaned = cleanAll(data.spectra, data.cleaning)[0];
    if (!sample || !cleaned) throw new Error('missing');
    const analysis = analyseBandGap(sample, cleaned, { ...DEFAULT_BAND_GAP, derivative: 'linear' });
    expect(analysis.derivative?.egEv).toBeGreaterThan(EXAMPLE_BAND_GAP_EV);
    expect(analyseBandGap(sample, cleaned, DEFAULT_BAND_GAP).derivative).toBeNull();
  });
});

describe('methods text', () => {
  it('is written only from the settings used and says when the data are synthetic', () => {
    const text = methodsText(exampleData());
    expect(text).toContain('generated example data, not measurements');
    expect(text).toContain('subtraction of a blank spectrum (1 of 3 spectra)');
    expect(text).toContain('hc = 1239.84 eV nm');
    expect(text).toContain('n = 1/2 (direct allowed transition) for all spectra');
    expect(text).toContain('Kubelka–Munk');
    expect(text).not.toContain('Urbach');
    expect(text).not.toContain('Savitzky');
  });

  it('mentions smoothing, Urbach and the derivative only when they are on', () => {
    const data = exampleData();
    const [sample, , reflectance] = data.spectra;
    if (!sample || !reflectance) throw new Error('missing');
    const text = methodsText({
      ...data,
      cleaning: {
        ...data.cleaning,
        [reflectance.id]: {
          ...DEFAULT_CLEANING,
          smoothing: { enabled: true, window: 9, order: 3 },
        },
      },
      bandGap: {
        [sample.id]: {
          ...DEFAULT_BAND_GAP,
          thicknessNm: 250,
          derivative: 'log',
          urbach: { enabled: true, region: null },
        },
      },
    });
    expect(text).toContain('Savitzky–Golay smoothing (9 points, polynomial order 3)');
    expect(text).toContain('t = 250 nm');
    expect(text).toContain('d(ln S)/dE');
  });
});

describe('UV-Vis session file', () => {
  it('round-trips the whole analysis including the typed arrays', () => {
    const data: UvvisData = {
      ...exampleData(),
      bandGap: { x: { ...DEFAULT_BAND_GAP, regions: { 'direct-allowed': [3.4, 3.9] } } },
    };
    const text = serialiseUvvisSession({ step: 3, furthest: 3, data });
    const parsed = parseUvvisSession(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.step).toBe(3);
    expect(parsed.state.data.bandGap).toEqual(data.bandGap);
    expect(Array.from(parsed.state.data.spectra[0]?.values ?? [])).toEqual(
      Array.from(data.spectra[0]?.values ?? []),
    );
    expect(parsed.state.data.spectra[0]?.wavelengthNm).toBeInstanceOf(Float64Array);
  });

  it('refuses other files, damaged files and newer versions with a plain reason', () => {
    expect(parseUvvisSession('not json')).toMatchObject({ ok: false });
    expect(parseUvvisSession('{"app":"xrd-toolkit","kind":"xrd-session"}')).toMatchObject({
      ok: false,
      reason: 'This is not a UV-Vis session file.',
    });
    const text = serialiseUvvisSession({ step: 0, furthest: 0, data: exampleData() });
    const newer = text.replace(`"version":${UVVIS_STATE_VERSION}`, '"version":99');
    const refused = parseUvvisSession(newer);
    expect(!refused.ok && refused.reason).toContain('newer version');
    const damaged = text.replace('"values":{"$f64":[', '"values":{"$f64":[1,');
    expect(parseUvvisSession(damaged)).toMatchObject({ ok: false });
  });

  it('upgrades a version 1 session by adding empty band gap settings', () => {
    const { bandGap: _unused, ...v1 } = exampleData();
    void _unused;
    const state = migrateUvvisData({ step: 1, furthest: 1, data: v1 }, 1);
    expect(state?.data.bandGap).toEqual({});
    expect(state?.data.spectra).toHaveLength(3);
    expect(migrateUvvisData({}, 1)).toBeUndefined();
    expect(migrateUvvisData({ step: 0, furthest: 0, data: v1 }, 7)).toBeUndefined();
  });
});
