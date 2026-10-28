import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessMapping } from '../src/core/thermal/import';
import { exampleTgaTable } from '../src/core/thermal/synthetic';
import { AssignStep } from '../src/modules/thermal/AssignStep';
import { CalcinationStep } from '../src/modules/thermal/CalcinationStep';
import {
  initialThermalData,
  migrateThermalData,
  THERMAL_STATE_VERSION,
  type ThermalData,
} from '../src/modules/thermal/data';
import { ResultsStep } from '../src/modules/thermal/ResultsStep';
import { thermalSession } from '../src/modules/thermal/session';
import { thermalSteps } from '../src/modules/thermal/steps';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const table = exampleTgaTable();
const base: ThermalData = {
  ...initialThermalData,
  file: { name: 'Example TGA (synthetic)', table, mapping: guessMapping(table), synthetic: true },
  info: { ...initialThermalData.info, heatingRate: 10, initialMassMg: 10 },
};

type StepComponent = typeof AssignStep;

function Harness(props: {
  initial: ThermalData;
  Step: StepComponent;
  onData?: (d: ThermalData) => void;
}) {
  const [data, setData] = useState(props.initial);
  props.onData?.(data);
  return <props.Step data={data} update={(patch) => setData((p) => ({ ...p, ...patch }))} />;
}

describe('wizard', () => {
  it('has the six steps, none of them a placeholder', () => {
    expect(thermalSteps.map((s) => s.id)).toEqual([
      'upload',
      'clean',
      'steps',
      'assign',
      'calcination',
      'results',
    ]);
  });
});

describe('assign events step', () => {
  it('warns that TGA alone cannot identify the species and that the table is unverified', async () => {
    render(<Harness initial={base} Step={AssignStep} />);
    expect(await screen.findByText(/TGA alone cannot identify the evolved species/)).toBeTruthy();
    expect(screen.getByText(/Ranges not verified yet/)).toBeTruthy();
  });

  it('lists up to three ranked suggestions per step and lets the user accept one', async () => {
    let latest = base;
    render(<Harness initial={base} Step={AssignStep} onData={(d) => (latest = d)} />);
    const first = await screen.findByRole('article', { name: /Step 1:/ });
    expect(within(first).getAllByRole('listitem').length).toBeLessThanOrEqual(3);
    // The first example step peaks near 120 °C: moisture is among the suggestions.
    expect(
      within(first)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
        .join(' '),
    ).toMatch(/moisture/);
    fireEvent.click(
      within(first).getAllByRole('button', { name: 'Accept this' })[0] as HTMLElement,
    );
    expect(latest.assignments[1]?.status).toBe('accepted');
    expect(latest.assignments[1]?.ruleId).not.toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'Reject all suggestions' }));
    expect(latest.assignments[1]?.status).toBe('rejected');
    await within(first).findByText(/You rejected the suggestions/);
  });

  it('compares the theoretical mass loss with a chosen step', async () => {
    let latest = base;
    render(<Harness initial={base} Step={AssignStep} onData={(d) => (latest = d)} />);
    await screen.findByRole('article', { name: /Step 1:/ });
    fireEvent.change(screen.getByLabelText('Compare with step'), { target: { value: '2' } });
    expect(latest.theory.stepId).toBe(2);
    await screen.findByText(/Difference, measured/);
    // Zn(OH)2 → ZnO is about 18.1 %; the second example step loses 32 %, so they disagree.
    expect(screen.getByText(/differs from the theoretical value/)).toBeTruthy();
  });

  it('says plainly when the formula is not understood', async () => {
    const data: ThermalData = {
      ...base,
      theory: {
        ...base.theory,
        exampleId: 'custom',
        reaction: { ...base.theory.reaction, precursor: 'Zn(OH' },
      },
    };
    render(<Harness initial={data} Step={AssignStep} />);
    expect(await screen.findByText(/brackets in the formula do not match/)).toBeTruthy();
  });
});

describe('calcination step', () => {
  it('suggests a minimum after the last step and always shows the warning', async () => {
    render(<Harness initial={base} Step={CalcinationStep} />);
    expect(await screen.findByText(/not an optimal temperature/)).toBeTruthy();
    const status = await screen.findByText(/Lowest temperature worth trying/);
    // The last example step is centred at 640 °C with sigma 18, so the endset is near 660 °C.
    const value = Number(/(\d+) °C/.exec(status.textContent ?? '')?.[1]);
    expect(value).toBeGreaterThan(690);
    expect(value).toBeLessThan(760);
  });

  it('moves with the safety margin', async () => {
    render(<Harness initial={base} Step={CalcinationStep} />);
    const read = async () =>
      Number(
        /(\d+) °C/.exec(
          (await screen.findByText(/Lowest temperature worth trying/)).textContent ?? '',
        )?.[1],
      );
    const before = await read();
    fireEvent.input(screen.getByLabelText('Safety margin (°C)'), { target: { value: '20' } });
    await waitFor(async () => expect(await read()).toBeLessThan(before - 20));
  });
});

describe('results step', () => {
  it('shows the table with the user’s event, the methods text and the session buttons', async () => {
    const data: ThermalData = {
      ...base,
      assignments: {
        1: { status: 'accepted', ruleId: 'moisture', label: 'Loss of adsorbed moisture' },
      },
    };
    render(<Harness initial={data} Step={ResultsStep} />);
    await screen.findByRole('table');
    expect(screen.getByText('Loss of adsorbed moisture')).toBeTruthy();
    expect(screen.getAllByText('not assigned').length).toBe(2);
    const methods = screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement;
    expect(methods.value).toContain('generated example data');
    expect(methods.value).toContain('10 K/min');
    expect(screen.getByRole('button', { name: /Download results/ })).toBeTruthy();
  });
});

describe('comparing samples', () => {
  it('adds the example samples and ranks them by the temperature of the fastest mass loss', async () => {
    let latest: ThermalData = base;
    render(<Harness initial={base} Step={ResultsStep} onData={(d) => (latest = d)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try with example samples' }));
    const table = await screen.findByRole('region', { name: /Comparison table/ });
    const rows = within(table).getAllByRole('row');
    expect(rows.length).toBe(4); // header, this sample, two examples
    expect(latest.compare.length).toBe(2);
    // The example samples' main steps are at 430 and 380 °C (synthetic, see CompareRuns).
    const fastest = (row: HTMLElement) => Number(within(row).getAllByRole('cell')[3]?.textContent);
    expect(fastest(rows[2] as HTMLElement)).toBeCloseTo(430, -1);
    expect(fastest(rows[3] as HTMLElement)).toBeCloseTo(380, -1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Example sample C (synthetic)' }));
    await waitFor(() => expect(latest.compare.length).toBe(1));
  });
});

describe('saved state', () => {
  it('upgrades a version 1 state with defaults for the new settings', () => {
    const v1: Partial<ThermalData> = { ...base };
    delete v1.assignments;
    delete v1.theory;
    delete v1.calcination;
    const migrated = migrateThermalData({ step: 2, furthest: 2, data: v1 }, 1);
    expect(migrated?.step).toBe(2);
    expect(migrated?.data.assignments).toEqual({});
    expect(migrated?.data.calcination.marginC).toBe(50);
    expect(migrated?.data.theory.stepId).toBeNull();
    expect(migrated?.data.compare).toEqual([]);
    const withoutCompare: Partial<ThermalData> = { ...base };
    delete withoutCompare.compare;
    expect(
      migrateThermalData({ step: 5, furthest: 5, data: withoutCompare }, 2)?.data.compare,
    ).toEqual([]);
    expect(migrateThermalData(null, 1)).toBeUndefined();
    expect(migrateThermalData({}, 7)).toBeUndefined();
  });

  it('round-trips through the session file', () => {
    const data: ThermalData = {
      ...base,
      assignments: { 2: { status: 'changed', ruleId: null, label: 'my own' } },
    };
    const text = thermalSession.serialise({ step: 5, furthest: 5, data });
    const back = thermalSession.parse(text);
    if (!back.ok) throw new Error(back.reason);
    expect(back.state.data.assignments).toEqual(data.assignments);
    expect(back.state.data.file?.table.columns[0]).toEqual(table.columns[0]);
    expect(THERMAL_STATE_VERSION).toBe(3);
    expect(thermalSession.parse('{"app":"x"}')).toMatchObject({ ok: false });
  });
});
