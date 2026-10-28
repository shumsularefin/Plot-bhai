import { describe, expect, it } from 'vitest';
import dscRules from '../data/thermal/dsc-events.json';
import {
  analyseEvent,
  analyseGlassTransition,
  crystallinity,
  defaultGlassWindows,
  detectEvents,
  eventBaseline,
  DEFAULT_DETECT_DSC,
  type EventContext,
} from '../src/core/thermal/dsc';
import {
  cleanDsc,
  DEFAULT_DSC_CLEAN,
  splitSegments,
  toExoPositive,
} from '../src/core/thermal/dscClean';
import {
  DSC_NO_CERTAINTY_NOTE,
  guidanceFor,
  type DscRuleTable,
} from '../src/core/thermal/dscGuidance';
import { buildRun, guessMapping } from '../src/core/thermal/import';
import {
  EXAMPLE_DSC_EVENTS,
  EXAMPLE_DSC_GLASS,
  EXAMPLE_DSC_MASS_MG,
  EXAMPLE_DSC_RATE,
  exampleDscTable,
  normalCdf,
} from '../src/core/thermal/synthetic';
import type { ThermalRun } from '../src/core/thermal/types';

/** Temperatures from a to b in steps of `step`. */
const ramp = (a: number, b: number, step: number) =>
  Float64Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);

const gauss = (t: number, mu: number, sigma: number) => Math.exp(-0.5 * ((t - mu) / sigma) ** 2);

const context: EventContext = {
  rateKPerMin: 10,
  specific: true,
  cooling: false,
  molarMassGPerMol: null,
};

/** Area of A·exp(−(T−μ)²/2σ²) over T is A·σ·√(2π); ΔH = area / (β in K/s). */
const gaussianArea = (a: number, sigma: number) => a * sigma * Math.sqrt(2 * Math.PI);

describe('heat-cool-heat segments', () => {
  it('finds two heating and one cooling ramp, with holds joined to the ramp before them', () => {
    const t: number[] = [];
    for (let x = 25; x <= 200; x += 1) t.push(x);
    for (let k = 0; k < 20; k++) t.push(200); // hold
    for (let x = 199; x >= 25; x -= 1) t.push(x);
    for (let x = 26; x <= 200; x += 1) t.push(x);
    const segments = splitSegments(t);
    expect(segments.map((s) => s.label)).toEqual(['Heating 1', 'Cooling 1', 'Heating 2']);
    expect(segments.map((s) => s.direction)).toEqual(['heating', 'cooling', 'heating']);
    expect(segments[0]?.endC).toBe(200);
    expect(segments[1]?.endC).toBe(25);
  });

  it('ignores a small wiggle and returns nothing for a flat program', () => {
    expect(splitSegments([25, 25.2, 24.9, 25.1, 25, 25, 25])).toEqual([]);
    expect(splitSegments([25])).toEqual([]);
  });
});

describe('heat flow units and sign', () => {
  it('treats mW/mg and W/g as the same numbers and divides mW by the mass', () => {
    const raw = [1, 2, 3];
    expect(Array.from(toExoPositive(raw, { unit: 'mW/mg', fileExoUp: true }, null).exo)).toEqual(
      raw,
    );
    expect(Array.from(toExoPositive(raw, { unit: 'W/g', fileExoUp: true }, null).exo)).toEqual(raw);
    const mw = toExoPositive(raw, { unit: 'mW', fileExoUp: true }, 2);
    expect(Array.from(mw.exo)).toEqual([0.5, 1, 1.5]);
    expect(mw.specific).toBe(true);
  });

  it('keeps mW unnormalised without a mass, and flips the sign when exo points down', () => {
    const plain = toExoPositive([1, -2], { unit: 'mW', fileExoUp: false }, null);
    expect(Array.from(plain.exo)).toEqual([-1, 2]);
    expect(plain.specific).toBe(false);
  });
});

describe('enthalpy, onset and endset of a peak with a known area', () => {
  const sigma = 3;
  const mu = 150;
  const T = ramp(100, 200, 0.1);

  it('recovers ΔH of an endotherm and an exotherm with the right sign', () => {
    // 1 W/g peak, area 1·3·√(2π) W/g·K at 10 K/min = 1/6 K/s.
    const expected = (gaussianArea(1, sigma) * 60) / 10;
    const endo = T.map((t) => -gauss(t, mu, sigma));
    const exo = T.map((t) => gauss(t, mu, sigma));
    const a = analyseEvent(T, endo, { id: 1, fromC: 100, toC: 200, baseline: 'linear' }, context);
    const b = analyseEvent(T, exo, { id: 1, fromC: 100, toC: 200, baseline: 'linear' }, context);
    expect(a?.direction).toBe('endo');
    expect(a?.enthalpy).toBeCloseTo(expected, 3);
    expect(b?.direction).toBe('exo');
    expect(b?.enthalpy).toBeCloseTo(-expected, 3);
    expect(a?.enthalpyUnit).toBe('J/g');
  });

  it('puts the extrapolated onset at μ − 2σ and the endset at μ + 2σ for a Gaussian', () => {
    // The steepest points of a Gaussian are at μ ± σ, where the tangents meet zero at μ ± 2σ.
    const y = T.map((t) => gauss(t, mu, sigma));
    const e = analyseEvent(T, y, { id: 1, fromC: 100, toC: 200, baseline: 'linear' }, context);
    expect(e?.peakC).toBeCloseTo(mu, 1);
    expect(e?.onsetC).toBeCloseTo(mu - 2 * sigma, 1);
    expect(e?.endsetC).toBeCloseTo(mu + 2 * sigma, 1);
    expect(e?.height).toBeCloseTo(1, 3);
  });

  it('swaps onset and endset on a cooling ramp', () => {
    const y = T.map((t) => gauss(t, mu, sigma));
    const e = analyseEvent(
      T,
      y,
      { id: 1, fromC: 100, toC: 200, baseline: 'linear' },
      { ...context, cooling: true },
    );
    expect(e?.onsetC).toBeCloseTo(mu + 2 * sigma, 1);
    expect(e?.endsetC).toBeCloseTo(mu - 2 * sigma, 1);
  });

  it('gives kJ/mol from the molar mass, and mJ without mass normalisation', () => {
    const y = T.map((t) => -gauss(t, mu, sigma));
    const molar = analyseEvent(
      T,
      y,
      { id: 1, fromC: 100, toC: 200, baseline: 'linear' },
      { ...context, molarMassGPerMol: 100 },
    );
    expect((molar?.enthalpyKJPerMol ?? 0) * 1000).toBeCloseTo((molar?.enthalpy ?? 0) * 100, 6);
    const raw = analyseEvent(
      T,
      y,
      { id: 1, fromC: 100, toC: 200, baseline: 'linear' },
      { ...context, specific: false },
    );
    expect(raw?.enthalpyUnit).toBe('mJ');
    expect(raw?.enthalpyKJPerMol).toBeNull();
  });

  it('has no enthalpy without a scan rate', () => {
    const y = T.map((t) => gauss(t, mu, sigma));
    const e = analyseEvent(
      T,
      y,
      { id: 1, fromC: 100, toC: 200, baseline: 'linear' },
      { ...context, rateKPerMin: null },
    );
    expect(e?.enthalpy).toBeNull();
  });

  it('returns null for limits that hold too few points', () => {
    const y = T.map((t) => gauss(t, mu, sigma));
    expect(
      analyseEvent(T, y, { id: 1, fromC: 150, toC: 150.3, baseline: 'linear' }, context),
    ).toBeNull();
  });
});

describe('baselines', () => {
  const sigma = 3;
  const mu = 150;
  const T = ramp(100, 200, 0.1);
  const peak = T.map((t) => gauss(t, mu, sigma));
  const expected = (gaussianArea(1, sigma) * 60) / 10;

  it('linear baseline recovers the area on a sloped straight baseline', () => {
    const y = T.map((t, i) => 0.3 + 0.004 * (t - 100) + (peak[i] as number));
    const e = analyseEvent(T, y, { id: 1, fromC: 100, toC: 200, baseline: 'linear' }, context);
    expect(Math.abs((e?.enthalpy ?? 0) + expected)).toBeLessThan(0.002 * expected);
  });

  it('spline baseline follows a curved baseline that a straight line misses', () => {
    const curved = (t: number) => 0.2 + 0.003 * (t - 100) + 0.00005 * (t - 100) ** 2;
    const y = T.map((t, i) => curved(t) + (peak[i] as number));
    const limit = { id: 1, fromC: 100, toC: 200 };
    const straight = analyseEvent(T, y, { ...limit, baseline: 'linear' }, context);
    const spline = analyseEvent(T, y, { ...limit, baseline: 'spline' }, context);
    const error = (v: number | null | undefined) => Math.abs((v ?? 0) + expected) / expected;
    expect(error(spline?.enthalpy)).toBeLessThan(0.02);
    expect(error(straight?.enthalpy)).toBeGreaterThan(error(spline?.enthalpy));
  });

  it('sigmoidal baseline reproduces a step that grows with the peak area', () => {
    // Baseline steps from 0.1 to 0.4 in proportion to the area passed: the sigmoidal model itself.
    const truth = T.map((t) => 0.1 + 0.3 * normalCdf((t - mu) / sigma));
    const y = T.map((_, i) => (truth[i] as number) + (peak[i] as number));
    const found = eventBaseline(T, y, 0, T.length - 1, 'sigmoidal');
    let worst = 0;
    for (let i = 0; i < T.length; i++) {
      worst = Math.max(worst, Math.abs((found[i] as number) - (truth[i] as number)));
    }
    expect(worst).toBeLessThan(0.01); // 3 % of the 0.3 step
    const e = analyseEvent(T, y, { id: 1, fromC: 100, toC: 200, baseline: 'sigmoidal' }, context);
    expect(Math.abs((e?.enthalpy ?? 0) + expected)).toBeLessThan(0.01 * expected);
  });
});

describe('glass transition', () => {
  // e = h / (1 + exp(−(T − Tm)/w)): midpoint Tm, steepest slope h/(4w) at Tm, so the tangent
  // meets a flat pre line at Tm − 2w and a flat post line at Tm + 2w.
  const Tm = 80;
  const w = 2;
  const h = 0.05;
  const T = ramp(30, 130, 0.1);
  const windows = { preFromC: 35, preToC: 60, postFromC: 100, postToC: 125 };

  it('returns the half-height midpoint, onset, endset and ΔCp of a logistic step', () => {
    const exo = T.map((t) => -h / (1 + Math.exp(-(t - Tm) / w)));
    const result = analyseGlassTransition(T, exo, windows, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.glass;
    expect(g.midpointC).toBeCloseTo(Tm, 2);
    expect(g.onsetC).toBeCloseTo(Tm - 2 * w, 1);
    expect(g.endsetC).toBeCloseTo(Tm + 2 * w, 1);
    // The tails of the logistic reach the windows (small), so allow 1 %.
    expect(g.stepHeight).toBeGreaterThan(0.99 * h);
    // ΔCp = Δe / β with β = 10 K/min = 1/6 K/s.
    expect(g.deltaCp).toBeCloseTo((g.stepHeight * 6) / 1, 6);
    expect(Math.abs((g.deltaCp ?? 0) - h * 6) / (h * 6)).toBeLessThan(0.01);
  });

  it('still finds the midpoint when the lines before and after are sloped', () => {
    // signal = pre + (post − pre)·S: half-height is exactly at Tm whatever the slopes.
    const pre = (t: number) => 0.2 + 0.0005 * (t - 30);
    const post = (t: number) => 0.28 + 0.0009 * (t - 30);
    const exo = T.map((t) => -(pre(t) + (post(t) - pre(t)) / (1 + Math.exp(-(t - Tm) / w))));
    const result = analyseGlassTransition(T, exo, windows, context);
    expect(result.ok && result.glass.midpointC).toBeCloseTo(Tm, 1);
  });

  it('flips the sign of the step when exo points the other way, giving a negative ΔCp warning', () => {
    const exo = T.map((t) => h / (1 + Math.exp(-(t - Tm) / w)));
    const result = analyseGlassTransition(T, exo, windows, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.glass.deltaCp).toBeLessThan(0);
    expect(result.glass.notes.join(' ')).toMatch(/negative/);
  });

  it('gives no ΔCp for unnormalised heat flow and mirrors onset on a cooling ramp', () => {
    const exo = T.map((t) => -h / (1 + Math.exp(-(t - Tm) / w)));
    const unnormalised = analyseGlassTransition(T, exo, windows, { ...context, specific: false });
    expect(unnormalised.ok && unnormalised.glass.deltaCp).toBeNull();
    const cooling = analyseGlassTransition(T, exo, windows, { ...context, cooling: true });
    expect(cooling.ok && cooling.glass.onsetC).toBeCloseTo(Tm + 2 * w, 1);
  });

  it('refuses windows without a step between them or with too few points', () => {
    const flat = T.map(() => -0.1);
    expect(analyseGlassTransition(T, flat, windows, context).ok).toBe(false);
    const tiny = { preFromC: 35, preToC: 35.1, postFromC: 100, postToC: 125 };
    expect(analyseGlassTransition(T, flat, tiny, context).ok).toBe(false);
  });

  it('proposes windows around the step and keeps them off a melting peak', () => {
    const peakAt = 110;
    const exo = T.map((t) => -h / (1 + Math.exp(-(t - Tm) / w)) - 0.3 * gauss(t, peakAt, 3));
    const limits = detectEvents(T, exo, DEFAULT_DETECT_DSC, 'linear');
    expect(limits).toHaveLength(1);
    const found = defaultGlassWindows(
      T,
      exo,
      limits.map((l) => [l.fromC, l.toC] as const),
    );
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.preToC).toBeLessThan(Tm);
    expect(found.postFromC).toBeGreaterThan(Tm);
    expect(found.postToC).toBeLessThanOrEqual(limits[0]?.fromC ?? 0);
    const result = analyseGlassTransition(T, exo, found, context);
    expect(result.ok && result.glass.midpointC).toBeCloseTo(Tm, 0);
  });
});

describe('peak detection', () => {
  it('finds an endotherm and an exotherm, numbered by temperature, with limits around each', () => {
    const T = ramp(30, 250, 0.2);
    const exo = T.map((t) => 0.5 * gauss(t, 110, 4) - 1 * gauss(t, 190, 5));
    const events = detectEvents(T, exo, DEFAULT_DETECT_DSC, 'linear');
    expect(events.map((e) => e.id)).toEqual([1, 2]);
    expect((events[0]?.fromC ?? 0) < 110 && (events[0]?.toC ?? 0) > 110).toBe(true);
    expect((events[1]?.fromC ?? 0) < 190 && (events[1]?.toC ?? 0) > 190).toBe(true);
    const a = analyseEvent(T, exo, events[0] as NonNullable<(typeof events)[0]>, context);
    const b = analyseEvent(T, exo, events[1] as NonNullable<(typeof events)[0]>, context);
    expect(a?.direction).toBe('exo');
    expect(b?.direction).toBe('endo');
    // Default limits are 0.5 % of the height from the peak foot, so the area is within 1 %.
    const expectedB = (gaussianArea(1, 5) * 60) / 10;
    expect(Math.abs((b?.enthalpy ?? 0) - expectedB) / expectedB).toBeLessThan(0.01);
  });

  it('finds nothing in a flat curve', () => {
    const T = ramp(30, 250, 0.5);
    expect(
      detectEvents(
        T,
        T.map(() => 0.2),
        DEFAULT_DETECT_DSC,
        'linear',
      ),
    ).toEqual([]);
  });
});

describe('cleaning a run into one DSC curve', () => {
  /** Heating 25 to 200, cooling to 25, heating again, 1 K per 0.1 min. */
  function threeRamps(): ThermalRun {
    const t: number[] = [];
    const q: number[] = [];
    const minutes: number[] = [];
    let clock = 0;
    const add = (temperature: number, value: number) => {
      t.push(temperature);
      q.push(value);
      minutes.push(clock);
      clock += 0.1;
    };
    for (let x = 25; x <= 200; x++) add(x, x === 100 ? 5 : 1); // heating 1: marker at 100 °C
    for (let x = 199; x >= 25; x--) add(x, 2); // cooling
    for (let x = 26; x <= 200; x++) add(x, 3); // heating 2
    return {
      name: 'test',
      temperatureC: Float64Array.from(t),
      mass: null,
      massUnit: 'mg',
      timeMin: Float64Array.from(minutes),
      heatFlow: Float64Array.from(q),
      notes: [],
    };
  }
  const setup = { unit: 'mW' as const, fileExoUp: true, displayExoUp: null };
  const info = { initialMassMg: 5, heatingRate: null };

  it('needs the exo direction to be chosen', () => {
    const result = cleanDsc(threeRamps(), { ...setup, fileExoUp: null }, info, DEFAULT_DSC_CLEAN);
    expect(result.ok).toBe(false);
  });

  it('picks the first heating ramp by default, normalises by mass and reads the rate from the time column', () => {
    const result = cleanDsc(threeRamps(), setup, info, DEFAULT_DSC_CLEAN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.curve;
    expect(c.segment.label).toBe('Heating 1');
    expect(c.unit).toBe('W/g');
    expect(c.exo[75]).toBeCloseTo(5 / 5, 9); // the marker at 100 °C, 5 mW / 5 mg
    // 1 K per 0.1 min is 10 K/min.
    expect(c.rateKPerMin).toBeCloseTo(10, 6);
    expect(c.rateSource).toBe('time column');
    expect(result.segments).toHaveLength(3);
  });

  it('reverses a cooling ramp so temperature increases, and prefers the entered rate', () => {
    const result = cleanDsc(
      threeRamps(),
      setup,
      { initialMassMg: 5, heatingRate: 20 },
      { ...DEFAULT_DSC_CLEAN, segmentId: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.curve.cooling).toBe(true);
    expect(result.curve.temperatureC[0]).toBe(25);
    expect(result.curve.exo[0]).toBeCloseTo(2 / 5, 9);
    expect(result.curve.rateKPerMin).toBe(20);
    expect(result.curve.rateSource).toBe('entered');
    for (let i = 1; i < result.curve.temperatureC.length; i++) {
      expect(result.curve.temperatureC[i]).toBeGreaterThan(
        result.curve.temperatureC[i - 1] as number,
      );
    }
  });

  it('crops to a range and refuses a range that leaves too few points', () => {
    const cropped = cleanDsc(threeRamps(), setup, info, {
      ...DEFAULT_DSC_CLEAN,
      fromC: 50,
      toC: 150,
    });
    expect(cropped.ok && cropped.curve.temperatureC[0]).toBe(50);
    const empty = cleanDsc(threeRamps(), setup, info, {
      ...DEFAULT_DSC_CLEAN,
      fromC: 100,
      toC: 103,
    });
    expect(empty.ok).toBe(false);
  });

  it('switching exo up to exo down flips the signs of the curve and every event consistently', () => {
    // The same physical run written by two instruments: one exo up, one exo down.
    const T = ramp(30, 250, 0.2);
    const physical = T.map((t) => 0.5 * gauss(t, 110, 4) - 1 * gauss(t, 190, 5)); // exo positive
    const run = (sign: number): ThermalRun => ({
      name: 'x',
      temperatureC: T,
      mass: null,
      massUnit: 'mg',
      timeMin: null,
      heatFlow: physical.map((v) => sign * v),
      notes: [],
    });
    const base = { initialMassMg: 1, heatingRate: 10 };
    const up = cleanDsc(
      run(1),
      { unit: 'W/g', fileExoUp: true, displayExoUp: null },
      base,
      DEFAULT_DSC_CLEAN,
    );
    const down = cleanDsc(
      run(-1),
      { unit: 'W/g', fileExoUp: false, displayExoUp: null },
      base,
      DEFAULT_DSC_CLEAN,
    );
    expect(up.ok && down.ok).toBe(true);
    if (!up.ok || !down.ok) return;
    expect(Array.from(down.curve.exo)).toEqual(Array.from(up.curve.exo));
    // Declaring the wrong convention flips every event's direction and enthalpy sign.
    const wrong = cleanDsc(
      run(1),
      { unit: 'W/g', fileExoUp: false, displayExoUp: null },
      base,
      DEFAULT_DSC_CLEAN,
    );
    if (!wrong.ok) throw new Error('unexpected');
    const limits = detectEvents(up.curve.temperatureC, up.curve.exo, DEFAULT_DETECT_DSC, 'linear');
    const ctx = { ...context };
    const right = limits.map((l) => analyseEvent(up.curve.temperatureC, up.curve.exo, l, ctx));
    const flipped = limits.map((l) =>
      analyseEvent(wrong.curve.temperatureC, wrong.curve.exo, l, ctx),
    );
    right.forEach((r, i) => {
      expect(flipped[i]?.direction).not.toBe(r?.direction);
      expect(flipped[i]?.enthalpy).toBeCloseTo(-(r?.enthalpy ?? 0), 9);
    });
  });
});

describe('crystallinity', () => {
  it('computes (ΔHm − ΔHcc) / (w · ΔH0) · 100 by hand', () => {
    // (50 − 10) / (1 · 200) = 0.2; with w = 0.5 it is 0.4.
    const a = crystallinity({
      meltingJPerG: 50,
      coldJPerG: 10,
      weightFraction: 1,
      fullyCrystallineJPerG: 200,
    });
    const b = crystallinity({
      meltingJPerG: 50,
      coldJPerG: 10,
      weightFraction: 0.5,
      fullyCrystallineJPerG: 200,
    });
    expect(a.ok && a.percent).toBeCloseTo(20, 9);
    expect(b.ok && b.percent).toBeCloseTo(40, 9);
  });

  it('needs ΔH0 and a sensible weight fraction, and flags impossible results', () => {
    const base = { meltingJPerG: 50, coldJPerG: 0, weightFraction: 1, fullyCrystallineJPerG: 100 };
    expect(crystallinity({ ...base, fullyCrystallineJPerG: 0 }).ok).toBe(false);
    expect(crystallinity({ ...base, weightFraction: 1.5 }).ok).toBe(false);
    const high = crystallinity({ ...base, meltingJPerG: 150 });
    expect(high.ok && high.notes.join(' ')).toMatch(/above 100/);
    const low = crystallinity({ ...base, coldJPerG: 80 });
    expect(low.ok && low.notes.join(' ')).toMatch(/negative/);
  });
});

describe('event type guidance', () => {
  const table = dscRules as DscRuleTable;
  const event = (direction: 'endo' | 'exo', peakC: number) => ({
    direction,
    peakC,
    onsetC: peakC - 6,
    endsetC: peakC + 6,
  });
  const ids = (list: { rule: { id: string } }[]) => list.map((g) => g.rule.id);

  it('keeps only rules that fit the direction and the scan', () => {
    const endo = guidanceFor(
      { event: event('endo', 165), scan: 'heating', atmosphere: 'nitrogen', category: 'polymer' },
      table.events,
    );
    expect(ids(endo)).toContain('melting');
    expect(ids(endo)).not.toContain('crystallisation');
    expect(ids(endo)).not.toContain('oxidation');
    const cooling = guidanceFor(
      { event: event('exo', 120), scan: 'cooling', atmosphere: 'nitrogen', category: 'polymer' },
      table.events,
    );
    expect(ids(cooling)).toContain('crystallisation');
    expect(ids(cooling)).not.toContain('melting');
  });

  it('only suggests oxidation in air or oxygen', () => {
    const run = (atmosphere: 'nitrogen' | 'air') =>
      ids(
        guidanceFor(
          { event: event('exo', 300), scan: 'heating', atmosphere, category: 'unspecified' },
          table.events,
        ),
      );
    expect(run('nitrogen')).not.toContain('oxidation');
    expect(run('air')).toContain('oxidation');
  });

  it('is ranked, at most three, never "high", and explains itself in plain language', () => {
    const list = guidanceFor(
      {
        event: event('endo', 100),
        scan: 'heating',
        atmosphere: 'nitrogen',
        category: 'hydroxide-or-salt',
      },
      table.events,
    );
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < list.length; i++) {
      expect((list[i - 1] as { score: number }).score).toBeGreaterThanOrEqual(
        (list[i] as { score: number }).score,
      );
    }
    for (const g of list) {
      expect(['low', 'medium']).toContain(g.confidence);
      expect(g.reason).toMatch(/endotherm/);
    }
    expect(DSC_NO_CERTAINTY_NOTE).toMatch(/DSC alone cannot/);
  });

  it('flags the table as unverified', () => {
    expect(table.verification).toMatch(/TODO, verify/);
    // Directions are cited to the textbook; every temperature range is still a placeholder.
    expect(table.events.every((r) => /TODO, verify/.test(r.source))).toBe(true);
    for (const id of ['melting', 'dehydration-evaporation', 'crystallisation', 'oxidation'])
      expect(table.events.find((r) => r.id === id)?.source, id).toMatch(
        /Gaisford, Kett & Haines \(2016\) §/,
      );
  });
});

describe('the DSC example run', () => {
  const table = exampleDscTable();
  const mapping = guessMapping(table);
  const built = buildRun('example', table, mapping);
  const setup = { unit: 'mW' as const, fileExoUp: true, displayExoUp: null };
  const info = { initialMassMg: EXAMPLE_DSC_MASS_MG, heatingRate: EXAMPLE_DSC_RATE };

  it('is read as temperature, time and heat flow with two heating ramps and one cooling ramp', () => {
    expect(mapping.temperature).toBe(0);
    expect(mapping.time).toBe(1);
    expect(mapping.heatFlow).toBe(2);
    expect(mapping.mass).toBeNull();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(splitSegments(built.run.temperatureC).map((s) => s.label)).toEqual([
      'Heating 1',
      'Cooling 1',
      'Heating 2',
    ]);
  });

  it('gives back the made-up enthalpies and glass transitions from each scan', () => {
    if (!built.ok) throw new Error('example did not build');
    const ctx = { rateKPerMin: EXAMPLE_DSC_RATE, specific: true, molarMassGPerMol: null };
    const scans = [
      {
        segmentId: 0,
        cooling: false,
        events: EXAMPLE_DSC_EVENTS.filter((e) => e.scans.includes('heating1')),
      },
      {
        segmentId: 1,
        cooling: true,
        events: EXAMPLE_DSC_EVENTS.filter((e) => e.scans.includes('cooling')),
      },
      {
        segmentId: 2,
        cooling: false,
        events: EXAMPLE_DSC_EVENTS.filter((e) => e.scans.includes('heating2')),
      },
    ];
    for (const scan of scans) {
      const cleaned = cleanDsc(built.run, setup, info, {
        ...DEFAULT_DSC_CLEAN,
        segmentId: scan.segmentId,
      });
      if (!cleaned.ok) throw new Error(cleaned.error);
      const { temperatureC: T, exo } = cleaned.curve;
      const limits = detectEvents(T, exo, DEFAULT_DETECT_DSC, 'linear');
      expect(limits).toHaveLength(scan.events.length);
      limits.forEach((limit, i) => {
        const truth = scan.events[i] as (typeof scan.events)[number];
        const found = analyseEvent(
          T,
          exo,
          { ...limit, baseline: 'linear' },
          {
            ...ctx,
            cooling: scan.cooling,
          },
        );
        expect(found?.peakC).toBeCloseTo(truth.peakC, 0);
        // Within 5 % of the made-up enthalpy (the example has no baseline step across its peaks, so a linear baseline is the right one).
        expect(
          Math.abs((found?.enthalpy ?? 0) - truth.enthalpy) / Math.abs(truth.enthalpy),
        ).toBeLessThan(0.05);
      });
      const windows = defaultGlassWindows(
        T,
        exo,
        limits.map((l) => [l.fromC, l.toC] as const),
      );
      expect(windows).not.toBeNull();
      if (!windows) continue;
      const glass = analyseGlassTransition(T, exo, windows, { ...ctx, cooling: scan.cooling });
      expect(glass.ok).toBe(true);
      if (!glass.ok) continue;
      const truthTg = scan.cooling ? EXAMPLE_DSC_GLASS.coolingC : EXAMPLE_DSC_GLASS.heatingC;
      expect(Math.abs(glass.glass.midpointC - truthTg)).toBeLessThan(1.5);
      expect(
        Math.abs((glass.glass.deltaCp ?? 0) - EXAMPLE_DSC_GLASS.deltaCp) /
          EXAMPLE_DSC_GLASS.deltaCp,
      ).toBeLessThan(0.1);
    }
  });
});
