// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { methodsParagraph, type MethodsInput } from '../src/core/xrd/report/methods';
import {
  DEFAULT_PEAK_STATE,
  initialXrdData,
  examplePatternRecords,
  type XrdData,
} from '../src/modules/xrd/data';
import { methodsFor } from '../src/modules/xrd/methodsText';
import { parseSession, serialiseSession } from '../src/modules/xrd/session';
import { initialWizardState } from '../src/ui/wizard/types';

const base: MethodsInput = {
  software: 'XRD Toolkit',
  radiation: { anode: 'Cu', kAlpha1A: 1.5405929, kAlpha2A: 1.5444274, kAlpha1Only: false },
  scan: { fromDeg: 10, toDeg: 80, stepDeg: 0.02 },
  patterns: 1,
  allSynthetic: false,
  processing: {
    zeroShiftDeg: null,
    smoothing: null,
    background: null,
    kAlpha2Stripped: null,
    normalisedTo: null,
  },
  fit: null,
  instrument: { kind: 'skipped' },
  size: null,
  phases: [],
  toleranceDeg: 0.15,
};

describe('methodsParagraph', () => {
  it('states only the settings used, with their real values', () => {
    const text = methodsParagraph({
      ...base,
      processing: {
        zeroShiftDeg: 0.05,
        smoothing: { window: 11, order: 3 },
        background: { method: 'snip', degree: 4, snipWidthDeg: 2, arplsWidthDeg: 4, anchors: 0 },
        kAlpha2Stripped: { ratio: 0.5 },
        normalisedTo: null,
      },
      fit: { profile: 'pseudo-voigt', fixedEta: null },
      instrument: { kind: 'standard', method: 'voigt', standardMaterial: 'LaB6' },
      size: { k: 0.9, methods: ['Scherrer', 'Williamson–Hall UDM'] },
      phases: [{ name: 'Anatase', formula: 'TiO2', reference: 'COD 9009086' }],
    });
    expect(text).toContain('Cu Kα radiation (Kα1 λ = 1.540593 Å, Kα2 λ = 1.544427 Å)');
    expect(text).toContain('10° to 80° 2θ in steps of 0.02°');
    expect(text).toContain('zero-shift correction of 0.05°');
    expect(text).toContain('Savitzky–Golay smoothing (11 points, polynomial order 3)');
    expect(text).toContain('SNIP, clipping width 2° 2θ');
    expect(text).toContain('Rachinger method (intensity ratio 0.5)');
    expect(text).toContain('pseudo-Voigt profile functions, with the Lorentzian fraction fitted');
    expect(text).toContain('measured LaB6 standard');
    expect(text).toContain('Scherrer and Williamson–Hall UDM using a shape factor K = 0.9');
    expect(text).toContain('Anatase (TiO2, COD 9009086)');
    expect(text).toContain('within 0.15° 2θ');
  });

  it('leaves out steps that were not used and does not invent any', () => {
    const text = methodsParagraph(base);
    expect(text).toContain('not smoothed, background-corrected or otherwise processed');
    expect(text).toContain('Instrumental broadening was not corrected');
    expect(text).not.toMatch(/Scherrer|Williamson|Crystallography Open Database|fitting/);
  });

  it('says plainly that example data are not a measurement', () => {
    const text = methodsParagraph({ ...base, allSynthetic: true });
    expect(text).toContain('generated example data, not measurements');
    expect(text).not.toContain('scan covered');
  });

  it('describes a Kα1-only source without a Kα2 wavelength', () => {
    const text = methodsParagraph({
      ...base,
      radiation: { ...base.radiation, kAlpha1Only: true },
    });
    expect(text).toContain('Cu Kα1 radiation (λ = 1.540593 Å)');
    expect(text).not.toContain('Kα2 λ');
  });
});

describe('methodsFor on the example data', () => {
  it('reads the radiation and the pattern from the saved data and says the data are synthetic', () => {
    const data: XrdData = { ...initialXrdData, patterns: examplePatternRecords() };
    const text = methodsFor(data, []);
    expect(text).toContain('generated example data');
    expect(text).toContain('Cu Kα radiation');
  });
});

describe('session file', () => {
  const data: XrdData = {
    ...initialXrdData,
    patterns: examplePatternRecords().map((p) => ({ ...p, sigma: p.intensity.map(Math.sqrt) })),
    peaks: { x: { ...DEFAULT_PEAK_STATE, guesses: [{ center: 25.3, width: 0.2 }] } },
  };
  const state = { ...initialWizardState(data), step: 3, furthest: 5 };

  it('round-trips the whole analysis, including typed arrays', () => {
    const parsed = parseSession(serialiseSession(state, new Date('2026-01-02T03:04:05Z')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.step).toBe(3);
    expect(parsed.state.furthest).toBe(5);
    expect(parsed.state.data.peaks).toEqual(data.peaks);
    expect(parsed.state.data.radiation).toEqual(data.radiation);
    const [a, b] = [data.patterns[0], parsed.state.data.patterns[0]];
    expect(b?.twoTheta).toBeInstanceOf(Float64Array);
    expect(Array.from(b?.twoTheta ?? [])).toEqual(Array.from(a?.twoTheta ?? []));
    expect(Array.from(b?.intensity ?? [])).toEqual(Array.from(a?.intensity ?? []));
    expect(Array.from(b?.sigma ?? [])).toEqual(Array.from(a?.sigma ?? []));
  });

  it('keeps NaN and Infinity, which plain JSON would turn into null', () => {
    const odd = { ...state, data: { ...data, results: { ...data.results, modulusGPa: Infinity } } };
    const parsed = parseSession(serialiseSession(odd));
    expect(parsed.ok && parsed.state.data.results.modulusGPa).toBe(Infinity);
  });

  it('refuses files that are not sessions, or from a newer version, with a plain message', () => {
    expect(parseSession('not json')).toMatchObject({ ok: false });
    expect(parseSession('{"app":"other"}')).toMatchObject({
      ok: false,
      reason: 'This is not an XRD Toolkit session file.',
    });
    const newer = JSON.parse(serialiseSession(state)) as { version: number };
    newer.version += 1;
    const refused = parseSession(JSON.stringify(newer));
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain('newer version');
  });

  it('upgrades an older version through the migration', () => {
    const old = JSON.parse(serialiseSession(state)) as {
      version: number;
      state: { data: Partial<XrdData> };
    };
    old.version = 6;
    delete old.state.data.material;
    delete old.state.data.analysis;
    const parsed = parseSession(JSON.stringify(old));
    expect(parsed.ok && parsed.state.data.material).toEqual(initialXrdData.material);
    expect(parsed.ok && parsed.state.data.analysis).toEqual(initialXrdData.analysis);
  });

  it('refuses a damaged pattern', () => {
    const damaged = JSON.parse(serialiseSession(state)) as {
      state: { data: { patterns: { intensity: { $f64: number[] } }[] } };
    };
    (damaged.state.data.patterns[0] as { intensity: { $f64: number[] } }).intensity = { $f64: [1] };
    expect(parseSession(JSON.stringify(damaged))).toMatchObject({ ok: false });
  });
});
