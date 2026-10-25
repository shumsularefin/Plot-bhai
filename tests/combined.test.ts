import { describe, expect, it } from 'vitest';
import { suggestCalcination, DEFAULT_CALCINATION } from '../src/core/thermal/calcination';
import {
  alignOnTemperature,
  calcinationMarks,
  correlateEvent,
  rerankDscGuidance,
  rerankStepCandidates,
} from '../src/core/thermal/combined';
import { analyseEvent, DEFAULT_DETECT_DSC, detectEvents } from '../src/core/thermal/dsc';
import { cleanDsc, DEFAULT_DSC_CLEAN } from '../src/core/thermal/dscClean';
import type { DscRuleTable } from '../src/core/thermal/dscGuidance';
import { rankEvents, type EventTable } from '../src/core/thermal/events';
import { buildRun, guessMapping } from '../src/core/thermal/import';
import { cleanRun, DEFAULT_CLEAN } from '../src/core/thermal/process';
import { dtg } from '../src/core/thermal/smooth';
import { analyseSteps, detectSteps, DEFAULT_DETECT } from '../src/core/thermal/steps';
import {
  EXAMPLE_STA_EVENTS,
  EXAMPLE_STA_MASS_MG,
  EXAMPLE_STA_STEPS,
  exampleStaTable,
  syntheticMassPct,
} from '../src/core/thermal/synthetic';
import dscRulesFile from '../data/thermal/dsc-events.json';
import tgaRulesFile from '../data/thermal/events.json';
import combinedFile from '../data/thermal/combined-rules.json';

const ramp = (from: number, to: number, step: number) =>
  Float64Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('alignOnTemperature', () => {
  it('gives the mass of a straight-line curve exactly on the DSC temperatures', () => {
    const tga = {
      temperatureC: ramp(40, 500, 3.7),
      massPct: ramp(40, 500, 3.7).map((t) => 100 - 0.05 * (t - 40)),
    };
    const dsc = { temperatureC: ramp(20, 600, 0.5), exo: ramp(20, 600, 0.5).map((t) => t * 2) };
    const aligned = alignOnTemperature(dsc, tga);
    expect(aligned).not.toBeNull();
    if (!aligned) return;
    // Only temperatures covered by both curves are kept, and the heat flow is untouched.
    expect(aligned.fromC).toBe(40);
    expect(aligned.toC).toBeLessThanOrEqual(500);
    expect(aligned.temperatureC[0]).toBe(40);
    aligned.temperatureC.forEach((t, i) => {
      expect(aligned.massPct[i]).toBeCloseTo(100 - 0.05 * (t - 40), 9);
      expect(aligned.exo[i]).toBe(t * 2);
    });
  });

  it('returns null when the curves do not overlap', () => {
    const a = { temperatureC: ramp(20, 100, 1), exo: new Float64Array(81) };
    const b = { temperatureC: ramp(200, 300, 1), massPct: new Float64Array(101).fill(100) };
    expect(alignOnTemperature(a, b)).toBeNull();
  });
});

describe('correlateEvent', () => {
  const T = ramp(30, 700, 0.5);
  const tga = {
    temperatureC: T,
    massPct: T.map((t) => syntheticMassPct(t, [{ loss: 20, peak: 300, sigma: 15 }])),
  };
  const at = (direction: 'endo' | 'exo', fromC: number, toC: number) =>
    correlateEvent({ id: 1, direction, fromC, toC }, tga);

  it('applies the four rules of the specification', () => {
    expect(at('endo', 240, 360).kind).toBe('loss-endo');
    expect(at('exo', 240, 360).kind).toBe('loss-exo');
    expect(at('exo', 450, 550).kind).toBe('none-exo');
    expect(at('endo', 450, 550).kind).toBe('none-endo');
  });

  it('reports the mass change over the event, negative for a loss', () => {
    expect(at('endo', 100, 500).massChangePct).toBeCloseTo(-20, 3);
  });

  it('treats a change below the threshold as none, and a gain without re-ranking', () => {
    const small = {
      temperatureC: T,
      massPct: T.map((t) => syntheticMassPct(t, [{ loss: 0.3, peak: 300, sigma: 15 }])),
    };
    expect(correlateEvent({ id: 1, direction: 'endo', fromC: 100, toC: 500 }, small).change).toBe(
      'none',
    );
    const gain = { temperatureC: T, massPct: T.map((t) => 100 + (t > 300 ? 2 : 0)) };
    const g = correlateEvent({ id: 1, direction: 'exo', fromC: 250, toC: 350 }, gain);
    expect(g.change).toBe('gain');
    expect(g.supports).toEqual([]);
    expect(g.against).toEqual([]);
  });
});

describe('re-ranking with the mass evidence', () => {
  const rules = (dscRulesFile as DscRuleTable).events;
  const evidence = (direction: 'endo' | 'exo', peakC: number) => ({
    event: { direction, peakC, onsetC: peakC - 10, endsetC: peakC + 10 },
    scan: 'heating' as const,
    atmosphere: 'nitrogen' as const,
    category: 'unspecified' as const,
  });
  const lossEndo = {
    eventId: 1,
    direction: 'endo' as const,
    massChangePct: -8,
    change: 'loss' as const,
    kind: 'loss-endo' as const,
    text: 'loss',
    supports: ['dehydration-evaporation', 'decomposition'],
    against: ['melting', 'crystallisation', 'solid-solid'],
  };
  const noneEndo = {
    ...lossEndo,
    massChangePct: 0,
    change: 'none' as const,
    kind: 'none-endo' as const,
    text: 'none',
    supports: ['melting', 'solid-solid'],
    against: ['dehydration-evaporation', 'oxidation', 'decomposition'],
  };

  it('puts dehydration first for an endotherm with mass loss, and melting first without', () => {
    const withLoss = rerankDscGuidance(evidence('endo', 150), rules, lossEndo);
    expect(withLoss[0]?.rule.id).toBe('dehydration-evaporation');
    expect(withLoss[0]?.mass).toBe('supported');
    const without = rerankDscGuidance(evidence('endo', 150), rules, noneEndo);
    expect(without[0]?.rule.id).toBe('melting');
    expect(without.find((g) => g.rule.id === 'dehydration-evaporation')?.mass ?? 'against').toBe(
      'against',
    );
  });

  it('gives "high" only with the mass evidence, and mentions it in the reason', () => {
    const top = rerankDscGuidance(evidence('endo', 150), rules, lossEndo)[0];
    expect(top?.confidence).toBe('high');
    expect(top?.reason).toMatch(/The mass curve supports it/);
  });

  it('moves a TGA step candidate that fits the DSC direction up', () => {
    const table = tgaRulesFile as EventTable;
    const usual = combinedFile.tgaUsualDirection as Record<string, 'endo' | 'exo' | 'either'>;
    const base = rankEvents(
      { peakC: 450, lossPct: 10 },
      { atmosphere: 'air', category: 'unspecified' },
      table.events,
    );
    expect(base.length).toBeGreaterThan(1);
    const exo = rerankStepCandidates(
      { fromC: 400, toC: 500 },
      base,
      [{ id: 1, direction: 'exo', peakC: 450 }],
      usual,
    );
    const endo = rerankStepCandidates(
      { fromC: 400, toC: 500 },
      base,
      [{ id: 1, direction: 'endo', peakC: 450 }],
      usual,
    );
    const rank = (list: typeof base, id: string) => list.findIndex((c) => c.rule.id === id);
    expect(rank(exo.candidates, 'carbon-oxidation')).toBeLessThanOrEqual(
      rank(endo.candidates, 'carbon-oxidation'),
    );
    expect(exo.event?.id).toBe(1);
    expect(
      rerankStepCandidates(
        { fromC: 100, toC: 200 },
        base,
        [{ id: 1, direction: 'exo', peakC: 450 }],
        usual,
      ).event,
    ).toBeNull();
  });
});

describe('the simultaneous example, end to end', () => {
  it('finds each event, reads it against the mass, and marks the crystallisation above the last step', () => {
    const table = exampleStaTable();
    const built = buildRun('sta', table, guessMapping(table));
    if (!built.ok) throw new Error(built.error);
    const info = { initialMassMg: EXAMPLE_STA_MASS_MG, heatingRate: 10 };
    const dscClean = cleanDsc(
      built.run,
      { unit: 'mW', fileExoUp: true, displayExoUp: null },
      info,
      DEFAULT_DSC_CLEAN,
    );
    const tgaClean = cleanRun(built.run, null, info, DEFAULT_CLEAN);
    if (!dscClean.ok || !tgaClean.ok) throw new Error('cleaning failed');
    const { temperatureC: T, exo } = dscClean.curve;
    const limits = detectEvents(T, exo, DEFAULT_DETECT_DSC, 'linear');
    const events = limits.map((l) =>
      analyseEvent(T, exo, l, {
        rateKPerMin: 10,
        specific: true,
        cooling: false,
        molarMassGPerMol: null,
      }),
    );
    expect(events).toHaveLength(EXAMPLE_STA_EVENTS.length);
    const found = events.filter((e) => e !== null);
    found.forEach((e, i) =>
      expect(e.peakC).toBeCloseTo((EXAMPLE_STA_EVENTS[i] as { peakC: number }).peakC, -1),
    );

    const aligned = alignOnTemperature(dscClean.curve, tgaClean.curve);
    expect(aligned).not.toBeNull();
    const correlations = found.map((e) => correlateEvent(e, tgaClean.curve));
    expect(correlations.map((c) => c.kind)).toEqual([
      'loss-endo',
      'none-endo',
      'loss-endo',
      'none-exo',
    ]);

    const slope = dtg(tgaClean.curve.temperatureC, tgaClean.curve.massPct, 20);
    const steps = analyseSteps(
      tgaClean.curve.temperatureC,
      tgaClean.curve.massPct,
      slope,
      detectSteps(tgaClean.curve.temperatureC, slope, DEFAULT_DETECT),
      tgaClean.curve.referenceMg,
    ).steps;
    expect(steps).toHaveLength(EXAMPLE_STA_STEPS.length);
    const suggestion = suggestCalcination(
      tgaClean.curve.temperatureC,
      tgaClean.curve.massPct,
      steps,
      DEFAULT_CALCINATION,
    );
    const marks = calcinationMarks(suggestion, correlations, found);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.peakC).toBeCloseTo(520, -1);
    expect(marks[0]?.text).toMatch(/XRD/);
  });
});
