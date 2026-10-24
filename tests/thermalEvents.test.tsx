import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessMapping } from '../src/core/thermal/import';
import { exampleTgaTable } from '../src/core/thermal/synthetic';
import { AssignStep } from '../src/modules/thermal/AssignStep';
import { CalcinationStep } from '../src/modules/thermal/CalcinationStep';
import {
  initialThermalData,
  migrateThermalData,
  type ThermalData,
} from '../src/modules/thermal/data';
import { ResultsStep } from '../src/modules/thermal/ResultsStep';
import { thermalSession } from '../src/modules/thermal/session';
import type { StepContext } from '../src/ui/wizard/types';

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
  info: { ...initialThermalData.info, heatingRate: 10, initialMassMg: 10, category: 'biomass' },
};

function Harness(props: {
  initial: ThermalData;
  Step: (p: StepContext<ThermalData>) => preact.JSX.Element;
  onData?: (d: ThermalData) => void;
}) {
  const [data, setData] = useState(props.initial);
  props.onData?.(data);
  return (
    <props.Step
      data={data}
      update={(patch) => setData((previous) => ({ ...previous, ...patch }))}
    />
  );
}

describe('assign events step', () => {
  it('suggests ranked events with reasons, never certainty, and records the decision', async () => {
    let latest = base;
    render(<Harness initial={base} Step={AssignStep} onData={(d) => (latest = d)} />);
    expect(screen.getByText(/TGA alone cannot tell which substance is lost/)).toBeTruthy();
    expect(screen.getByText(/event table is incomplete and needs your verification/)).toBeTruthy();
    await screen.findByRole('heading', { name: /Step 2:/ });
    expect(screen.getAllByText(/Low confidence|Medium confidence/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/High confidence/)).toBeNull();
    // Step 3 (640 °C) has no event with a cited range.
    expect(
      screen.getByText(/no event with a temperature range that overlaps this step/),
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0] as HTMLElement);
    expect(Object.values(latest.events)).toHaveLength(1);
    expect(Object.values(latest.events)[0]?.kind).toBe('rule');

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Reject all suggestions' })[0] as HTMLElement,
    );
    expect(Object.values(latest.events)[0]?.kind).toBe('rejected');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear my choice' })[0] as HTMLElement);
    expect(Object.keys(latest.events)).toHaveLength(0);

    fireEvent.input(screen.getAllByLabelText('Or type your own')[0] as HTMLElement, {
      target: { value: 'my own idea' },
    });
    expect(Object.values(latest.events)[0]).toEqual({ kind: 'custom', text: 'my own idea' });
  });

  it('checks a step against theory from a ready example', async () => {
    render(<Harness initial={base} Step={AssignStep} />);
    await screen.findByRole('heading', { name: /Check a step against theory/ });
    fireEvent.change(screen.getByLabelText('Ready example'), { target: { value: '0' } });
    await waitFor(() => expect(screen.getByText(/Theoretical loss 30\.89 %/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Compare with'), {
      target: {
        value: screen.getAllByRole('option', { name: /Step 2 / })[0]?.getAttribute('value'),
      },
    });
    await waitFor(() => expect(screen.getByText(/Measured in step 2/)).toBeTruthy());
  });

  it('says what is wrong with a formula', async () => {
    render(
      <Harness
        initial={{ ...base, theory: { ...base.theory, precursor: 'Mg(OH', product: 'MgO' } }}
        Step={AssignStep}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('bracket');
  });
});

describe('calcination step', () => {
  it('shows a minimum from the last step, three temperatures and the warning', async () => {
    render(<Harness initial={base} Step={CalcinationStep} />);
    expect(screen.getByText(/starting point, not an optimal temperature/)).toBeTruthy();
    // Last step: 640 °C, σ 18 → endset 640 + 18·√(2π)/2 ≈ 662.6; plus 50 → about 713 °C.
    await waitFor(() => expect(screen.getByText(/minimum of/).textContent).toMatch(/71\d °C/));
    expect(
      screen.getAllByRole('listitem').filter((li) => /minimum/.test(li.textContent ?? '')),
    ).not.toHaveLength(0);
  });

  it('changes with the margin', async () => {
    let latest = base;
    render(<Harness initial={base} Step={CalcinationStep} onData={(d) => (latest = d)} />);
    const margin = screen.getAllByRole('spinbutton')[1] as HTMLInputElement;
    fireEvent.input(margin, { target: { value: '100' } });
    expect(latest.calcination.marginC).toBe(100);
    await waitFor(() => expect(screen.getByText(/minimum of/).textContent).toMatch(/76\d °C/));
  });
});

describe('results step and saved state', () => {
  it('lists the run, the steps and a methods text that says the data is synthetic', async () => {
    render(<Harness initial={base} Step={ResultsStep} />);
    await screen.findByRole('heading', { name: 'Mass loss steps' });
    expect(screen.getByText('Atmosphere')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(8);
    const methods = screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement;
    expect(methods.value).toContain('synthetic example');
    expect(screen.getByRole('button', { name: 'Download results (CSV)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download session (JSON)' })).toBeTruthy();
  });

  it('writes the settings into the methods text for a real run', async () => {
    const real: ThermalData = {
      ...base,
      file: base.file ? { ...base.file, synthetic: false, name: 'run.txt' } : null,
      info: { ...base.info, sample: 'Mg(OH)2 powder' },
      events: { '411': { kind: 'custom', text: 'my own event' } },
    };
    render(<Harness initial={real} Step={ResultsStep} />);
    const methods = (await screen.findByLabelText('Methods paragraph')) as HTMLTextAreaElement;
    expect(methods.value).toContain('nitrogen');
    expect(methods.value).toContain('10.0 K min⁻¹');
    expect(methods.value).toContain('Mg(OH)2 powder');
    expect(methods.value).toContain('411 °C: my own event');
    expect(methods.value).toContain('my own event');
    expect(methods.value).toContain('thermogravimetry alone does not identify');
  });

  it('round-trips through the session file and upgrades version 1', () => {
    const text = thermalSession.serialise({ step: 3, furthest: 3, data: base });
    const back = thermalSession.parse(text);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state.data.file?.table.columns[0]).toBeInstanceOf(Float64Array);
      expect(back.state.data.file?.table.columns[0]?.length).toBe(table.columns[0]?.length);
      expect(back.state.data.calcination).toEqual(base.calcination);
    }
    // A version 1 file has none of the sub-stage 11b keys.
    const { events, theory, calcination, ...v1 } = base;
    void [events, theory, calcination];
    const old = { step: 2, furthest: 2, data: v1 };
    const migrated = migrateThermalData(old, 1);
    expect(migrated?.data.events).toEqual({});
    expect(migrated?.data.calcination.marginC).toBe(50);
    expect(migrateThermalData(old, 0)).toBeUndefined();
  });
});
