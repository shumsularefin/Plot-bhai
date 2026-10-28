import { render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyse, prepareRuns, uploadProblem } from '../src/modules/thermal/kinetics/analysis';
import { initialKineticsData, type KineticsData } from '../src/modules/thermal/kinetics/data';
import {
  EXAMPLE_MODEL,
  EXAMPLE_RATES,
  exampleKineticRun,
} from '../src/modules/thermal/kinetics/example';
import { kineticsMethodsText } from '../src/modules/thermal/kinetics/methodsText';
import { KineticsResultsStep } from '../src/modules/thermal/kinetics/ResultsStep';
import { kineticsSession } from '../src/modules/thermal/kinetics/session';
import { kineticsSteps } from '../src/modules/thermal/kinetics/steps';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const loaded: KineticsData = {
  ...initialKineticsData,
  runs: EXAMPLE_RATES.map((rate, i) => ({ ...exampleKineticRun(rate), id: i + 1, rate })),
  nextId: EXAMPLE_RATES.length + 1,
};

describe('kinetics wizard', () => {
  it('asks for three runs with different rates before Next', () => {
    expect(kineticsSteps[0]?.validate?.(initialKineticsData)).toMatch(/at least three runs/i);
    const same = { ...loaded, runs: loaded.runs.map((r) => ({ ...r, rate: 10 })) };
    expect(uploadProblem(same.runs)).toMatch(/three different/);
    expect(kineticsSteps[0]?.validate?.(loaded)).toBeNull();
  });

  it.each(['kissinger', 'fwo', 'kas', 'starink', 'friedman'] as const)(
    '%s recovers Ea of the example within 3 %%',
    (method) => {
      const data = { ...loaded, method };
      const outcome = analyse(data, prepareRuns(data));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const values =
        outcome.method === 'kissinger' ? [outcome.result.eaKJ] : outcome.levels.map((l) => l.eaKJ);
      for (const ea of values) {
        expect(Math.abs(ea - EXAMPLE_MODEL.eaKJ) / EXAMPLE_MODEL.eaKJ).toBeLessThan(0.03);
      }
    },
  );

  it('Coats–Redfern ranks first order best for every example run and writes the table and text', () => {
    const data = { ...loaded, method: 'coats-redfern' as const };
    const prepared = prepareRuns(data);
    const outcome = analyse(data, prepared);
    expect(outcome.ok && outcome.method === 'coats-redfern').toBe(true);
    if (!outcome.ok || outcome.method !== 'coats-redfern') return;
    for (const r of outcome.runs) {
      expect(r.fits[0]?.model).toBe('F1');
      expect(
        Math.abs((r.fits[0]?.eaKJ as number) - EXAMPLE_MODEL.eaKJ) / EXAMPLE_MODEL.eaKJ,
      ).toBeLessThan(0.03);
    }
    const text = kineticsMethodsText(data, prepared, outcome);
    expect(text).toContain('Coats–Redfern');
    expect(text).toContain('not proof of the reaction mechanism');
    render(<KineticsResultsStep data={data} update={() => {}} />);
    expect(screen.getByRole('heading', { name: /Reaction models/ })).toBeTruthy();
    expect(screen.getAllByText(/\(best\)/).length).toBe(EXAMPLE_RATES.length);
  });

  it('refuses a window with no peak or a mixed set', () => {
    const data = { ...loaded, fromC: 500, toC: 590 };
    const outcome = analyse(data, prepareRuns(data));
    expect(outcome.ok === false || outcome.notes.some((n) => /edge/.test(n.text))).toBe(true);
  });

  it('shows the headline, the warning about apparent energy and the methods text', () => {
    const data = { ...loaded, method: 'kas' as const };
    render(<KineticsResultsStep data={data} update={() => {}} />);
    expect(screen.getByText(/apparent/, { selector: 'strong' })).toBeTruthy();
    const text = kineticsMethodsText(data, prepareRuns(data), analyse(data, prepareRuns(data)));
    expect(text).toMatch(/Kissinger–Akahira–Sunose/);
    expect(text).toMatch(/8\.314462618/);
    expect(text).toMatch(/synthetic example data/);
  });

  it('round-trips the session file', () => {
    const text = kineticsSession.serialise({ step: 2, furthest: 2, data: loaded });
    const parsed = kineticsSession.parse(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.data.runs).toHaveLength(5);
  });
});
