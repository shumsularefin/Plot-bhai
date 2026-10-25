import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { guessMapping } from '../src/core/thermal/import';
import { exampleDscTable, exampleStaTable } from '../src/core/thermal/synthetic';
import { displayExoUp } from '../src/core/thermal/dscClean';
import { DscCleanStep } from '../src/modules/thermal/dsc/CleanStep';
import { DscCombinedStep } from '../src/modules/thermal/dsc/CombinedStep';
import {
  DSC_STATE_VERSION,
  initialDscData,
  migrateDscData,
  type DscData,
} from '../src/modules/thermal/dsc/data';
import { dscSession } from '../src/modules/thermal/dsc/session';
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
    expect(dscSteps.map((s) => s.id)).toEqual([
      'upload',
      'clean',
      'events',
      'glass',
      'combined',
      'results',
    ]);
  });
});

const sta = exampleStaTable();
const staLoaded: DscData = {
  ...initialDscData,
  file: {
    name: 'Example TGA-DSC (synthetic)',
    table: sta,
    mapping: guessMapping(sta),
    synthetic: true,
  },
  setup: { unit: 'mW', fileExoUp: true, displayExoUp: null },
  info: { ...initialDscData.info, heatingRate: 10, initialMassMg: 10 },
};

describe('combined TGA-DSC', () => {
  it('loads the combined example from the upload step', async () => {
    let latest = initialDscData;
    render(<Harness initial={initialDscData} Step={DscUploadStep} onData={(d) => (latest = d)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try with combined TGA-DSC example' }));
    await screen.findByRole('heading', { name: 'Describe the run' });
    expect(latest.file?.mapping.mass).not.toBeNull();
    expect(latest.info.initialMassMg).toBe(10);
    expect(dscUploadProblem(latest)).toBeNull();
  });

  it('reads each event against the mass and states the exo convention', () => {
    const { container } = render(<Harness initial={staLoaded} Step={DscCombinedStep} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Mass loss with an endotherm suggests dehydration');
    expect(text).toContain('No mass change with an exotherm suggests crystallisation');
    expect(text).toContain('Heat flow: exo up');
    expect(text).toContain('Table not verified yet');
    expect(text).toMatch(/The mass does not change .* while heat is released/);
    expect(text).toMatch(/Mass is lost .* while heat is absorbed/);
    expect(text).toMatch(/Check by XRD of samples calcined below and above 520/);
  });

  it('records an accepted re-ranked suggestion', () => {
    let latest = staLoaded;
    render(<Harness initial={staLoaded} Step={DscCombinedStep} onData={(d) => (latest = d)} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Accept this/ })[0] as HTMLElement);
    expect(Object.values(latest.assignments)[0]?.status).toBe('accepted');
  });

  it('explains what is missing when there is no mass curve or the ramp is cooling', () => {
    render(<Harness initial={loaded} Step={DscCombinedStep} />);
    expect(screen.getByText(/There is no mass curve/)).toBeTruthy();
  });

  it('puts the combined table, calcination marks and methods text in the results', () => {
    const { container } = render(<Harness initial={staLoaded} Step={DscResultsStep} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Combined TGA-DSC (guidance)');
    expect(text).toContain('Calcination: exotherms above the last mass loss step');
    const methods = (screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement).value;
    expect(methods).toMatch(/Exothermic peaks point up in the file and are drawn up/);
    expect(methods).toMatch(/mass loss with an endotherm suggests dehydration/);
    expect(methods).toMatch(/confirmed experimentally/);
    expect(methods).toMatch(/scan rate: 10 K\/min/);
  });
});

describe('DSC session', () => {
  it('moves a version 1 save to the current shape with the combined defaults', () => {
    const v1 = Object.fromEntries(
      Object.entries(loaded).filter(
        ([key]) => !['tgaFile', 'stepAssignments', 'massThresholdPct'].includes(key),
      ),
    );
    const migrated = migrateDscData({ stepIndex: 2, data: v1 }, 1);
    expect(migrated?.data.massThresholdPct).toBe(initialDscData.massThresholdPct);
    expect(migrated?.data.stepAssignments).toEqual({});
    expect(migrateDscData({ data: v1 }, 0)).toBeUndefined();
    expect(DSC_STATE_VERSION).toBe(2);
  });

  it('round-trips a combined session, with the second TGA file, and refuses a damaged one', () => {
    const data: DscData = {
      ...staLoaded,
      tgaFile: staLoaded.file,
      stepAssignments: { 1: { status: 'rejected', ruleId: null, label: '' } },
    };
    const parsed = dscSession.parse(dscSession.serialise({ step: 5, furthest: 5, data }));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.state.data.tgaFile?.table.columns[2]).toEqual(sta.columns[2]);
    expect(parsed.state.data.stepAssignments[1]?.status).toBe('rejected');
    expect(dscSession.parse('{"app":"xrd-toolkit","kind":"thermal-session"}')).toMatchObject({
      ok: false,
    });
    const damaged = dscSession.serialise({ step: 0, furthest: 0, data: initialDscData });
    expect(dscSession.parse(damaged)).toMatchObject({ ok: false });
  });
});
