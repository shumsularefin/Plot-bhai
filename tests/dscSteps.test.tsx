import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessMapping } from '../src/core/thermal/import';
import { exampleDscTable } from '../src/core/thermal/synthetic';
import { displayExoUp } from '../src/core/thermal/dscClean';
import { DscCleanStep } from '../src/modules/thermal/dsc/CleanStep';
import { initialDscData, type DscData } from '../src/modules/thermal/dsc/data';
import { heatFlowLabel } from '../src/modules/thermal/dsc/DscPlot';
import { DscEventsStep } from '../src/modules/thermal/dsc/EventsStep';
import { DscGlassStep } from '../src/modules/thermal/dsc/GlassStep';
import { DscResultsStep } from '../src/modules/thermal/dsc/ResultsStep';
import { dscSteps } from '../src/modules/thermal/dsc/steps';
import { DscUploadStep, dscUploadProblem } from '../src/modules/thermal/dsc/UploadStep';
import type { StepContext } from '../src/ui/wizard/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const table = exampleDscTable();
const loaded: DscData = {
  ...initialDscData,
  file: { name: 'Example DSC (synthetic)', table, mapping: guessMapping(table), synthetic: true },
  setup: { unit: 'mW', fileExoUp: true, displayExoUp: null },
  info: { ...initialDscData.info, heatingRate: 10, initialMassMg: 5, category: 'polymer' },
};

function Harness(props: {
  initial: DscData;
  Step: (context: StepContext<DscData>) => preact.JSX.Element;
  onData?: (d: DscData) => void;
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

describe('DSC upload step', () => {
  it('loads the example, and refuses to go on until the exo direction is chosen', async () => {
    let latest = initialDscData;
    render(<Harness initial={initialDscData} Step={DscUploadStep} onData={(d) => (latest = d)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    await screen.findByRole('heading', { name: 'Describe the run' });
    expect(latest.setup.fileExoUp).toBe(true);
    expect(dscUploadProblem(latest)).toBeNull();
    const withoutChoice = { ...latest, setup: { ...latest.setup, fileExoUp: null } };
    expect(dscUploadProblem(withoutChoice)).toMatch(/up or down/);
    expect(dscUploadProblem(initialDscData)).toMatch(/Load a run/);
  });

  it('records the exo direction the user picks', async () => {
    let latest = loaded;
    render(
      <Harness
        initial={{ ...loaded, setup: { ...loaded.setup, fileExoUp: null } }}
        Step={DscUploadStep}
        onData={(d) => (latest = d)}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Exo down/));
    expect(latest.setup.fileExoUp).toBe(false);
  });
});

describe('DSC clean step', () => {
  it('lists the three ramps of the example and switches ramp', () => {
    let latest = loaded;
    render(<Harness initial={loaded} Step={DscCleanStep} onData={(d) => (latest = d)} />);
    const ramp = screen.getByLabelText('Ramp') as HTMLSelectElement;
    expect(Array.from(ramp.options).map((o) => o.textContent?.split(' (')[0])).toEqual([
      'Heating 1',
      'Cooling 1',
      'Heating 2',
    ]);
    fireEvent.change(ramp, { target: { value: '1' } });
    expect(latest.clean.segmentId).toBe(1);
  });

  it('draws exo up or down as chosen, and says so in the axis text', () => {
    let latest = loaded;
    render(<Harness initial={loaded} Step={DscCleanStep} onData={(d) => (latest = d)} />);
    expect(displayExoUp(latest.setup)).toBe(true);
    fireEvent.click(screen.getByLabelText('Exo down'));
    expect(displayExoUp(latest.setup)).toBe(false);
    expect(heatFlowLabel('W/g', true)).toBe('Heat flow (W/g), exo ↑');
    expect(heatFlowLabel('mW', false)).toBe('Heat flow (mW), exo ↓');
  });
});

describe('DSC events step', () => {
  it('finds the two events of heating 1, with guidance and the unverified-table warning', () => {
    render(<Harness initial={loaded} Step={DscEventsStep} />);
    expect(screen.getByRole('heading', { name: /Event 1: exothermic/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Event 2: endothermic/ })).toBeTruthy();
    expect(screen.getByText(/DSC alone cannot tell what happened/)).toBeTruthy();
    expect(screen.getByText(/Table not verified yet/)).toBeTruthy();
  });

  it('records an accepted suggestion', () => {
    let latest = loaded;
    render(<Harness initial={loaded} Step={DscEventsStep} onData={(d) => (latest = d)} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept this' })[0] as HTMLElement);
    expect(latest.assignments[1]?.status).toBe('accepted');
  });
});

describe('DSC glass transition and results', () => {
  it('gives Tg near 60 °C for the example', () => {
    render(<Harness initial={loaded} Step={DscGlassStep} />);
    const row = screen.getByText('Tg, midpoint (°C)').closest('tr') as HTMLElement;
    const tg = Number(row.querySelector('td')?.textContent);
    expect(Math.abs(tg - 60)).toBeLessThan(2);
  });

  it('asks for ΔH0 instead of using a built-in value', () => {
    render(<Harness initial={loaded} Step={DscGlassStep} />);
    expect(screen.getByText(/Enter ΔH0/)).toBeTruthy();
  });

  it('computes Xc once ΔH0 is entered', () => {
    let latest = loaded;
    render(
      <Harness
        initial={{
          ...loaded,
          crystallinity: { ...loaded.crystallinity, fullyCrystallineJPerG: 100 },
        }}
        Step={DscGlassStep}
        onData={(d) => (latest = d)}
      />,
    );
    expect(screen.getByText(/Xc ≈/)).toBeTruthy();
    expect(latest.crystallinity.fullyCrystallineJPerG).toBe(100);
  });

  it('repeats the sign convention in the results tables', () => {
    const { container } = render(<Harness initial={loaded} Step={DscResultsStep} />);
    expect(container.textContent).toContain('ΔH endothermic positive');
    expect(container.textContent).toContain('exo up');
  });
});

describe('DSC wizard steps', () => {
  it('has the planned order', () => {
    expect(dscSteps.map((s) => s.id)).toEqual(['upload', 'clean', 'events', 'glass', 'results']);
  });
});
