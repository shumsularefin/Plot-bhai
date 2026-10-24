import { describe, expect, it } from 'vitest';
import weightsFile from '../data/thermal/atomic-weights.json';
import eventsFile from '../data/thermal/events.json';
import { suggestCalcination } from '../src/core/thermal/calcination';
import { rankEvents, type EventRule } from '../src/core/thermal/events';
import {
  REACTION_EXAMPLES,
  molarMass,
  parseFormula,
  theoreticalLoss,
} from '../src/core/thermal/formula';
import { analyseSteps, detectSteps, DEFAULT_DETECT } from '../src/core/thermal/steps';
import { dtg } from '../src/core/thermal/smooth';
import { normalCdf, type SyntheticStep } from '../src/core/thermal/synthetic';

const weights = weightsFile.elements;
const rules = eventsFile.rules as EventRule[];

describe('atomic weight table', () => {
  it('holds the CIAAW abridged values it was built from', () => {
    // Values printed in data/thermal/source/abridged-atomic-weights.html (CIAAW 2024).
    expect(weights.H.weight).toBe(1.008);
    expect(weights.O.weight).toBe(15.999);
    expect(weights.Ca.weight).toBe(40.078);
    expect(Object.keys(weights).length).toBeGreaterThan(80);
  });
});

describe('formulas', () => {
  const composition = (text: string) => {
    const r = parseFormula(text, weights);
    if (!r.ok) throw new Error(r.error);
    return r.composition;
  };
  it('reads brackets and hydrates', () => {
    expect(composition('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(composition('Cu(NO3)2·3H2O')).toEqual({ Cu: 1, N: 2, O: 9, H: 6 });
    expect(composition('Cu(NO3)2.3H2O')).toEqual({ Cu: 1, N: 2, O: 9, H: 6 });
    expect(composition('Al2(SO4)3*18H2O')).toEqual({ Al: 2, S: 3, O: 30, H: 36 });
    expect(composition('CaC₂O₄')).toEqual({ Ca: 1, C: 2, O: 4 });
  });
  it('tells CO from Co', () => {
    expect(composition('CO')).toEqual({ C: 1, O: 1 });
    expect(composition('Co')).toEqual({ Co: 1 });
  });
  it('explains what is wrong', () => {
    for (const bad of ['', 'Mg(OH', 'Mg)OH', 'Xx2', 'mgo', 'MgO·']) {
      const r = parseFormula(bad, weights);
      expect(r.ok, bad).toBe(false);
    }
  });
  it('adds molar masses', () => {
    // 24.305 + 2 × (15.999 + 1.008) = 58.319 g/mol
    expect(molarMass(composition('Mg(OH)2'), weights)).toBeCloseTo(58.319, 6);
  });
});

describe('theoretical mass loss, worked by hand from the table values', () => {
  const loss = (label: string) => {
    const example = REACTION_EXAMPLES.find((e) => e.label.startsWith(label));
    if (!example) throw new Error(label);
    const r = theoreticalLoss(example, weights);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  it('Mg(OH)2 → MgO: (58.319 − 40.304) / 58.319 = 30.89 %', () => {
    expect(loss('Mg(OH)2').lossPct).toBeCloseTo(30.8904, 3);
  });
  it('2 Al(OH)3 → Al2O3: 1 − 0.5 × 101.961 / 78.003 = 34.64 %', () => {
    expect(loss('2 Al(OH)3').lossPct).toBeCloseTo(34.6429, 3);
  });
  it('CaCO3 → CaO: (100.086 − 56.077) / 100.086 = 43.97 %', () => {
    expect(loss('CaCO3').lossPct).toBeCloseTo(43.9712, 3);
  });
  it('Cu(NO3)2·3H2O → CuO: (241.599 − 79.545) / 241.599 = 67.08 %', () => {
    expect(loss('Cu(NO3)2').lossPct).toBeCloseTo(67.0756, 3);
  });
  it('loss and residue add to 100 % and every example gives a loss between 0 and 100', () => {
    for (const e of REACTION_EXAMPLES) {
      const r = theoreticalLoss(e, weights);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.lossPct + r.value.residuePct).toBeCloseTo(100, 9);
        expect(r.value.lossPct).toBeGreaterThan(0);
        expect(r.value.lossPct).toBeLessThan(100);
      }
    }
  });
  it('refuses a bad coefficient or formula', () => {
    expect(theoreticalLoss({ precursor: 'MgO', product: 'MgO', coefficient: 0 }, weights).ok).toBe(
      false,
    );
    expect(theoreticalLoss({ precursor: 'Q', product: 'MgO', coefficient: 1 }, weights).ok).toBe(
      false,
    );
  });
});

describe('event table', () => {
  it('has a range and a quote for every sourced rule, and none invented for todo rules', () => {
    for (const rule of rules) {
      if (rule.status === 'sourced') {
        expect(rule.range, rule.id).not.toBeNull();
        expect(rule.quote, rule.id).toBeTruthy();
        expect(rule.quote, rule.id).toContain(String(rule.range?.fromC));
        expect(rule.quote, rule.id).toContain(String(rule.range?.toC));
      } else {
        expect(rule.range, rule.id).toBeNull();
      }
    }
  });
});

describe('event ranking', () => {
  const rule = (over: Partial<EventRule> & { id: string }): EventRule => ({
    name: over.id,
    range: { fromC: 100, toC: 200 },
    atmosphere: 'any',
    categories: ['biomass'],
    status: 'sourced',
    overlap: '',
    ...over,
  });
  const step = { onsetC: 120, peakC: 150, endsetC: 180, lossPct: 8 };

  it('puts the rule that contains the step first and gives medium only with peak and category', () => {
    const list = [
      rule({ id: 'far', range: { fromC: 400, toC: 500 } }),
      rule({ id: 'partial', range: { fromC: 160, toC: 300 } }),
      rule({ id: 'whole' }),
    ];
    const c = rankEvents(step, { atmosphere: 'nitrogen', category: 'biomass' }, list);
    expect(c.map((x) => x.ruleId)).toEqual(['whole', 'partial']);
    expect(c[0]?.confidence).toBe('medium');
    expect(c[1]?.confidence).toBe('low');
    const unknown = rankEvents(step, { atmosphere: 'nitrogen', category: 'unspecified' }, list);
    expect(unknown[0]?.confidence).toBe('low');
  });
  it('skips rules without a range and oxidising rules in nitrogen, and caps at three', () => {
    const list = [
      rule({ id: 'none', range: null, status: 'todo' }),
      rule({ id: 'burn', atmosphere: 'oxidising' }),
      rule({ id: 'a' }),
      rule({ id: 'b' }),
      rule({ id: 'c' }),
      rule({ id: 'd' }),
    ];
    const inert = rankEvents(step, { atmosphere: 'nitrogen', category: 'biomass' }, list);
    expect(inert.map((x) => x.ruleId)).not.toContain('none');
    expect(inert.map((x) => x.ruleId)).not.toContain('burn');
    expect(inert).toHaveLength(3);
    const air = rankEvents(step, { atmosphere: 'air', category: 'biomass' }, [
      list[1] as EventRule,
    ]);
    expect(air.map((x) => x.ruleId)).toEqual(['burn']);
  });
  it('never claims high confidence and always explains', () => {
    for (const c of rankEvents(step, { atmosphere: 'air', category: 'biomass' }, rules)) {
      expect(['low', 'medium']).toContain(c.confidence);
      expect(c.reason.length).toBeGreaterThan(40);
    }
  });
});

describe('calcination suggestion on a synthetic curve with known steps', () => {
  const truth: SyntheticStep[] = [
    { loss: 10, peak: 120, sigma: 15 },
    { loss: 30, peak: 400, sigma: 20 },
    { loss: 0.5, peak: 650, sigma: 15 },
  ];
  const T = Float64Array.from({ length: 1401 }, (_, i) => 30 + i * 0.5);
  const mass = T.map(
    (t) => 100 - truth.reduce((m, s) => m + s.loss * normalCdf((t - s.peak) / s.sigma), 0),
  );
  const slope = dtg(T, mass, 20);
  const limits = detectSteps(T, slope, { ...DEFAULT_DETECT, prominencePercent: 0.5 });
  const { steps } = analyseSteps(T, mass, slope, limits, 10);

  it('uses the endset of the last step that loses at least the threshold, plus the margin', () => {
    // True endset of the 30 % step: 400 + 20 · √(2π) / 2 = 425.07 °C.
    const s = suggestCalcination(steps, T, mass, { thresholdPct: 1, marginC: 50 });
    expect(s.lastStep?.peakC).toBeCloseTo(400, 0);
    expect(Math.abs((s.minimumC as number) - (425.07 + 50))).toBeLessThan(1.5);
    expect(s.candidatesC).toEqual([
      Math.round(s.minimumC as number),
      Math.round((s.minimumC as number) + 50),
      Math.round((s.minimumC as number) + 100),
    ]);
    expect(s.plateau?.toC).toBe(730);
  });
  it('moves to the small last step when the threshold is lowered, and warns about a rising plateau', () => {
    const s = suggestCalcination(steps, T, mass, { thresholdPct: 0.2, marginC: 50 });
    expect(s.lastStep?.peakC).toBeCloseTo(650, 0);
    const low = suggestCalcination(steps, T, mass, { thresholdPct: 1, marginC: 50 });
    expect(low.plateau?.flat).toBe(false);
    expect(low.warnings.join(' ')).toContain('not flat');
  });
  it('says so when there is no significant step, or the run ends too early', () => {
    expect(suggestCalcination([], T, mass, { thresholdPct: 1, marginC: 50 }).minimumC).toBeNull();
    const short = suggestCalcination(steps, T, mass, { thresholdPct: 1, marginC: 400 });
    expect(short.plateau).toBeNull();
    expect(short.warnings.join(' ')).toContain('no plateau');
  });
});
