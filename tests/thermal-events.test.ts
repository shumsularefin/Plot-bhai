import { describe, expect, it } from 'vitest';
import weightsFile from '../data/thermal/atomic-weights.json';
import eventsFile from '../data/thermal/events.json';
import { suggestCalcination } from '../src/core/thermal/calcination';
import { rankEvents, type EventRule, type EventTable } from '../src/core/thermal/events';
import {
  molarMass,
  parseFormula,
  REACTION_EXAMPLES,
  type Reaction,
  theoreticalLoss,
  type AtomicWeights,
} from '../src/core/thermal/formula';
import { thermalMethodsParagraph } from '../src/core/thermal/methods';
import { analyseSteps, detectSteps, DEFAULT_DETECT } from '../src/core/thermal/steps';
import { dtg } from '../src/core/thermal/smooth';
import { normalCdf } from '../src/core/thermal/synthetic';

/** Weights typed here only so the hand calculations below are independent of the data file. */
const hand: AtomicWeights = { H: 1, C: 12, O: 16, Ca: 40, Zn: 65 };
const fileWeights: AtomicWeights = Object.fromEntries(
  weightsFile.elements.map((e) => [e.symbol, e.weight]),
);
const example = (i: number): Reaction =>
  (REACTION_EXAMPLES[i] as (typeof REACTION_EXAMPLES)[number]).reaction;
const rules = (eventsFile as EventTable).events;

describe('formulas', () => {
  it('counts atoms with brackets and hydrates', () => {
    expect(parseFormula('Fe(OH)3')).toEqual({ ok: true, counts: { Fe: 1, O: 3, H: 3 } });
    expect(parseFormula('Cu(NO3)2.3H2O')).toEqual({
      ok: true,
      counts: { Cu: 1, N: 2, O: 9, H: 6 },
    });
    expect(parseFormula('CuSO4·5H2O')).toEqual({
      ok: true,
      counts: { Cu: 1, S: 1, O: 9, H: 10 },
    });
    expect(parseFormula('CaCO₃')).toEqual({ ok: true, counts: { Ca: 1, C: 1, O: 3 } });
  });
  it('reports bad formulas in plain words', () => {
    expect(parseFormula('')).toMatchObject({ ok: false });
    expect(parseFormula('Fe(OH')).toMatchObject({ ok: false });
    expect(parseFormula('Fe)OH(')).toMatchObject({ ok: false });
    expect(parseFormula('Fe+3')).toMatchObject({ ok: false });
    expect(molarMass('Xx2', hand)).toMatchObject({ ok: false });
  });
  it('molar mass is the sum of the atomic weights', () => {
    expect(molarMass('Zn(OH)2', hand)).toEqual({ ok: true, gPerMol: 65 + 2 * 17 });
  });
});

describe('theoretical mass loss, checked by hand', () => {
  // Weights H 1, C 12, O 16, Ca 40, Zn 65 (hand table above).
  it('Zn(OH)2 → ZnO: M = 99 and 81, loss 18/99 = 18.18 %', () => {
    const r = theoreticalLoss(example(0), hand);
    expect(r).toMatchObject({ ok: true, precursorGPerMol: 99, productGPerMol: 81 });
    if (r.ok) expect(r.lossPct).toBeCloseTo((18 / 99) * 100, 10);
  });
  it('CaCO3 → CaO: M = 100 and 56, loss 44 %', () => {
    const r = theoreticalLoss(example(2), hand);
    if (!r.ok) throw new Error(r.error);
    expect(r.lossPct).toBeCloseTo(44, 10);
    expect(r.residuePct).toBeCloseTo(56, 10);
  });
  it('2 Fe(OH)3 → Fe2O3 follows the mole numbers', () => {
    const w = { Fe: 56, O: 16, H: 1 };
    // M(Fe(OH)3) = 107, M(Fe2O3) = 160; loss = (214 − 160) / 214.
    const r = theoreticalLoss(example(1), w);
    if (!r.ok) throw new Error(r.error);
    expect(r.lossPct).toBeCloseTo((54 / 214) * 100, 10);
  });
  it('CuSO4·5H2O → CuSO4 loses 5 H2O (data-file weights, 18.015 per water)', () => {
    const r = theoreticalLoss(example(4), fileWeights);
    if (!r.ok) throw new Error(r.error);
    expect(r.precursorGPerMol - r.productGPerMol).toBeCloseTo(5 * 18.015, 3);
  });
  it('refuses a product heavier than the precursor and zero moles', () => {
    expect(
      theoreticalLoss(
        { precursor: 'CaO', precursorMoles: 1, product: 'CaCO3', productMoles: 1 },
        hand,
      ),
    ).toMatchObject({ ok: false });
    expect(
      theoreticalLoss(
        { precursor: 'CaCO3', precursorMoles: 0, product: 'CaO', productMoles: 1 },
        hand,
      ),
    ).toMatchObject({ ok: false });
  });
  it('every ready example works with the data-file weights', () => {
    for (const e of REACTION_EXAMPLES) {
      const r = theoreticalLoss(e.reaction, fileWeights);
      expect(r.ok, e.id).toBe(true);
    }
  });
});

describe('atomic weight file', () => {
  it('cites its source and holds known elements', () => {
    expect(weightsFile.source.url).toContain('ciaaw.org');
    expect(weightsFile.source.year).toBe(2024);
    expect(fileWeights.H).toBeGreaterThan(1.007);
    expect(fileWeights.H).toBeLessThan(1.009);
    expect(Object.keys(fileWeights).length).toBeGreaterThan(80);
  });
});

describe('event rules', () => {
  it('is flagged for verification and every rule has a source field', () => {
    expect((eventsFile as EventTable).verification).toMatch(/TODO, verify/);
    for (const r of rules) expect(r.source, r.id).not.toBe('');
  });
  const ctx = { atmosphere: 'nitrogen', category: 'unspecified' } as const;

  it('ranks by temperature fit and returns at most three', () => {
    const ranked = rankEvents({ peakC: 100, lossPct: 5 }, ctx, rules);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(3);
    expect(ranked[0]?.rule.id).toBe('moisture');
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(ranked[i]?.score ?? 0);
    }
  });
  it('drops oxidation of carbon in an inert atmosphere but keeps it in air', () => {
    const inert = rankEvents({ peakC: 500, lossPct: 10 }, ctx, rules);
    expect(inert.some((c) => c.rule.id === 'carbon-oxidation')).toBe(false);
    const air = rankEvents(
      { peakC: 500, lossPct: 10 },
      { atmosphere: 'air', category: 'biomass' },
      rules,
    );
    expect(air.some((c) => c.rule.id === 'carbon-oxidation')).toBe(true);
  });
  it('uses the sample category and only gives high confidence with agreeing theory', () => {
    const hydroxide = { atmosphere: 'nitrogen', category: 'hydroxide-or-salt' } as const;
    const plain = rankEvents({ peakC: 300, lossPct: 18 }, hydroxide, rules);
    expect(plain.every((c) => c.confidence !== 'high')).toBe(true);
    const withTheory = rankEvents(
      { peakC: 300, lossPct: 18, theoryAgrees: true },
      hydroxide,
      rules,
    );
    expect(withTheory.some((c) => c.confidence === 'high')).toBe(true);
    expect(withTheory[0]?.reason).toMatch(/theoretical mass loss/);
    const polymer = rankEvents(
      { peakC: 400, lossPct: 80 },
      { atmosphere: 'nitrogen', category: 'polymer' },
      rules,
    );
    expect(polymer[0]?.rule.id).toBe('polymer-degradation');
  });
  it('gives nothing for a temperature far from every range', () => {
    const narrow: EventRule[] = [{ ...(rules[0] as EventRule), fromC: 100, toC: 150 }];
    expect(rankEvents({ peakC: 400, lossPct: 5 }, ctx, narrow)).toEqual([]);
    expect(rankEvents({ peakC: 170, lossPct: 5 }, ctx, narrow)[0]?.confidence).toBe('low');
  });
});

describe('calcination suggestion', () => {
  const T = Float64Array.from({ length: 3851 }, (_, i) => 30 + i * 0.2);
  const truth = [
    { loss: 10, peak: 120, sigma: 12 },
    { loss: 30, peak: 400, sigma: 20 },
  ];
  const mass = T.map(
    (t) => 100 - truth.reduce((m, s) => m + s.loss * normalCdf((t - s.peak) / s.sigma), 0),
  );
  const d = dtg(T, mass, 10);
  const { steps } = analyseSteps(T, mass, d, detectSteps(T, d, DEFAULT_DETECT), null);
  const options = { minLossPct: 1, marginC: 50, spacingC: 100 };

  it('is the endset of the last step plus the margin, with three candidates', () => {
    const s = suggestCalcination(T, mass, steps, options);
    if (!s.ok) throw new Error(s.error);
    const trueEndset = 400 + (20 * Math.sqrt(2 * Math.PI)) / 2;
    expect(s.minimumC).toBeCloseTo(trueEndset + 50, 0);
    expect(s.candidatesC).toHaveLength(3);
    expect((s.candidatesC[1] ?? 0) - (s.candidatesC[0] ?? 0)).toBe(100);
    expect(Math.abs(s.plateauChangePct as number)).toBeLessThan(0.5);
  });
  it('ignores steps below the threshold and moves with the margin', () => {
    const big = suggestCalcination(T, mass, steps, { ...options, minLossPct: 20 });
    if (!big.ok) throw new Error(big.error);
    expect(big.step.id).toBe(steps.find((s) => s.lossPct >= 20)?.id);
    const wider = suggestCalcination(T, mass, steps, { ...options, marginC: 80 });
    const base = suggestCalcination(T, mass, steps, options);
    if (!wider.ok || !base.ok) throw new Error('failed');
    expect(wider.minimumC - base.minimumC).toBeCloseTo(30, 10);
  });
  it('says so when no step is big enough or the curve ends too early', () => {
    expect(suggestCalcination(T, mass, steps, { ...options, minLossPct: 90 })).toMatchObject({
      ok: false,
    });
    const s = suggestCalcination(T, mass, steps, { ...options, marginC: 500 });
    if (!s.ok) throw new Error(s.error);
    expect(s.candidatesC).toEqual([]);
    expect(s.plateauChangePct).toBeNull();
    expect(s.notes.join(' ')).toMatch(/higher temperature/);
  });
});

describe('methods text', () => {
  it('uses only the given settings', () => {
    const text = thermalMethodsParagraph({
      software: 'XRD Toolkit',
      synthetic: false,
      atmosphere: 'air',
      atmosphereOther: '',
      heatingRate: 10,
      initialMassMg: 8.5,
      sample: 'zinc hydroxide',
      category: 'hydroxide-or-salt',
      clean: { fromC: 30, toC: null, smoothWindowC: 0, normaliseAtC: 150, blank: false },
      dtgWindowC: 20,
      prominencePercent: 5,
      minSeparationC: 20,
      limitsEditedByHand: true,
      stepCount: 2,
      assignmentsAccepted: 1,
      rangeSource: 'table flagged for verification',
      theory: { precursor: 'Zn(OH)2', product: 'ZnO', lossPct: 18.1818 },
      calcination: { marginC: 50, minLossPct: 1, minimumC: 412.3 },
    });
    expect(text).toContain('atmosphere: air');
    expect(text).toContain('10 K/min');
    expect(text).toContain('8.5 mg');
    expect(text).toContain('set to 100 % at 150 °C');
    expect(text).toContain('adjusted by hand');
    expect(text).toContain('18.18 %');
    expect(text).toContain('starting point');
    expect(text).not.toContain('smoothed');
  });
});
