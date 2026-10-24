import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessMapping } from '../src/core/thermal/import';
import { exampleTgaTable, syntheticMassPct } from '../src/core/thermal/synthetic';
import { CleanStep } from '../src/modules/thermal/CleanStep';
import {
  initialThermalData,
  type LoadedTable,
  type ThermalData,
} from '../src/modules/thermal/data';
import { StepsStep } from '../src/modules/thermal/StepsStep';
import { thermalSteps } from '../src/modules/thermal/steps';
import { UploadStep } from '../src/modules/thermal/UploadStep';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const table = exampleTgaTable();
const withExample: ThermalData = {
  ...initialThermalData,
  file: {
    name: 'Example TGA (synthetic)',
    table,
    mapping: guessMapping(table),
    synthetic: true,
  },
  info: { ...initialThermalData.info, heatingRate: 10, initialMassMg: 10 },
};

/** Holds the data in state like the wizard does. */
function Harness(props: {
  initial: ThermalData;
  Step: typeof UploadStep;
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

describe('thermal upload step', () => {
  it('loads the example run, shows the mapping and the run description', async () => {
    let latest = initialThermalData;
    render(<Harness initial={initialThermalData} Step={UploadStep} onData={(d) => (latest = d)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    await screen.findByRole('heading', { name: 'Describe the run' });
    expect(latest.file?.synthetic).toBe(true);
    expect(latest.info.heatingRate).toBe(10);
    expect((screen.getByLabelText('Temperature column') as HTMLSelectElement).value).toBe('0');
    expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('10');
    expect(screen.getByText(/Only the heating part is drawn/)).toBeTruthy();
  });

  it('refuses to continue without a run, and without a mass column', () => {
    const upload = thermalSteps[0];
    expect(upload?.validate?.(initialThermalData)).toContain('Load a run');
    expect(upload?.validate?.(withExample)).toBeNull();
    const noMass = {
      ...withExample,
      file: withExample.file && {
        ...withExample.file,
        mapping: { ...withExample.file.mapping, mass: null },
      },
    };
    expect(upload?.validate?.(noMass)).toBeTruthy();
  });

  it('offers the heating rate found from the time column', async () => {
    const data: ThermalData = { ...withExample, info: { ...withExample.info, heatingRate: null } };
    let latest = data;
    render(<Harness initial={data} Step={UploadStep} onData={(d) => (latest = d)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this value' }));
    expect(latest.info.heatingRate).toBe(10);
  });
});

describe('thermal clean step', () => {
  it('normalising at a temperature is undoable and reported', async () => {
    let latest = withExample;
    render(<Harness initial={withExample} Step={CleanStep} onData={(d) => (latest = d)} />);
    const section = screen.getByRole('region', { name: /Normalise to a start temperature/ });
    fireEvent.click(within(section).getByRole('switch'));
    expect(latest.clean.normaliseAtC).toBe(130);
    await screen.findByText(/Mass is set to 100 % at 130 °C/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(latest.clean.normaliseAtC).toBeNull();
  });
});

describe('thermal mass loss steps', () => {
  const stepRows = () =>
    screen.getAllByRole('row').filter((r) => within(r).queryByLabelText(/start \(°C\)/) !== null);

  it('finds the three steps of the example and updates live when a limit moves', async () => {
    render(<Harness initial={withExample} Step={StepsStep} />);
    await waitFor(() => expect(stepRows()).toHaveLength(3));
    const rows = stepRows();
    const lossOf = (row: HTMLElement) => Number(within(row).getAllByRole('cell')[5]?.textContent);
    expect(lossOf(rows[0] as HTMLElement)).toBeGreaterThan(8.5);
    expect(lossOf(rows[0] as HTMLElement)).toBeLessThan(9.1);
    expect(lossOf(rows[1] as HTMLElement)).toBeGreaterThan(31);

    // Narrow the first step to its upper half: its mass loss must drop.
    const start = within(rows[0] as HTMLElement).getByLabelText(/start \(°C\)/);
    fireEvent.change(start, { target: { value: '120' } });
    await waitFor(() => expect(lossOf(stepRows()[0] as HTMLElement)).toBeLessThan(5.5));
    expect(screen.getByText(/You edited the step limits by hand/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use the automatic limits again' }));
    await waitFor(() => expect(lossOf(stepRows()[0] as HTMLElement)).toBeGreaterThan(8.5));
  });

  it('shows T5, T10, T50 and the residue at a chosen temperature', async () => {
    render(<Harness initial={withExample} Step={StepsStep} />);
    await screen.findByText('T5 % (°C)');
    const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(within(row('T5 % (°C)')).getAllByRole('cell')[0]?.textContent).toMatch(/^\d/);
    // 9 + 32 + 11 = 52 % is lost in total, so 50 % loss is reached late in the third step.
    expect(Number(within(row('T50 % (°C)')).getAllByRole('cell')[0]?.textContent)).toBeGreaterThan(
      600,
    );
    // 100 - 9 - 32 = 59 % remains at 600 °C (the third step has not started).
    expect(document.querySelector('.residue-result')?.textContent).toMatch(/Mass at 600 °C: 5[89]/);
  });

  it('states that TGA cannot identify the lost substance', async () => {
    render(<Harness initial={withExample} Step={StepsStep} />);
    expect(await screen.findByText(/TGA alone cannot tell which substance is lost/)).toBeTruthy();
  });

  it('adds and removes a step', async () => {
    render(<Harness initial={withExample} Step={StepsStep} />);
    await waitFor(() => expect(stepRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
    await waitFor(() => expect(stepRows()).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 4' }));
    await waitFor(() => expect(stepRows()).toHaveLength(3));
  });

  it('reports overlapping steps as one region and splits them on request', async () => {
    const overlapping = [
      { loss: 25, peak: 300, sigma: 20 },
      { loss: 15, peak: 360, sigma: 20 },
    ];
    const T = Float64Array.from({ length: 1541 }, (_, i) => 30 + 0.5 * i);
    const closeTable = {
      ...table,
      columns: [
        T,
        T.map((t) => (t - 30) / 10),
        T.map((t) => syntheticMassPct(t, overlapping) / 10),
      ],
    };
    const data: ThermalData = {
      ...withExample,
      file: { ...(withExample.file as LoadedTable), table: closeTable },
      steps: { ...withExample.steps, detect: { prominencePercent: 3, minSeparationC: 20 } },
    };
    render(<Harness initial={data} Step={StepsStep} />);
    await screen.findByText(/Overlap:/);
    fireEvent.click(screen.getByRole('button', { name: /Split into Gaussian components/ }));
    const table2 = await screen.findByRole('table', { name: 'Gaussian components' });
    const losses = within(table2)
      .getAllByRole('row')
      .slice(1)
      .map((r) => Number(within(r).getAllByRole('cell')[2]?.textContent));
    expect(losses[0]).toBeGreaterThan(23.5);
    expect(losses[0]).toBeLessThan(26.5);
    expect(losses[1]).toBeGreaterThan(14);
    expect(losses[1]).toBeLessThan(16);
    expect(screen.getByText(/Approximation/)).toBeTruthy();
  });
});
