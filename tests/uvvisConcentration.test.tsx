import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyse, samplesProblem } from '../src/modules/uvvis/concentration/analysis';
import {
  initialConcentrationData,
  type ConcentrationData,
} from '../src/modules/uvvis/concentration/data';
import { EXAMPLE_DYE, exampleSamples } from '../src/modules/uvvis/concentration/example';
import { methodsText } from '../src/modules/uvvis/concentration/methodsText';
import { ResultsStep } from '../src/modules/uvvis/concentration/ResultsStep';
import { SamplesStep } from '../src/modules/uvvis/concentration/SamplesStep';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function Harness(props: {
  initial: ConcentrationData;
  Step: typeof SamplesStep;
  onData?: (d: ConcentrationData) => void;
}) {
  const [data, setData] = useState(props.initial);
  props.onData?.(data);
  return <props.Step data={data} update={(patch) => setData((p) => ({ ...p, ...patch }))} />;
}

describe('concentration and kinetics', () => {
  const data: ConcentrationData = { ...initialConcentrationData, samples: exampleSamples() };

  it('recovers the made-up dye: band maximum, absorptivity and rate constant', () => {
    expect(samplesProblem(data.samples)).toBeNull();
    const out = analyse(data);
    // On a band 35 nm wide, noise moves the highest point by a few nm.
    expect(Math.abs((out.wavelengthNm as number) - EXAMPLE_DYE.peakNm)).toBeLessThanOrEqual(3);
    // Noise of 0.002 in absorbance: a few tenths of a percent on the slope.
    expect(out.calibration?.absorptivity).toBeCloseTo(EXAMPLE_DYE.absorptivity, 2);
    expect(out.calibration?.fit.rSquared).toBeGreaterThan(0.999);
    expect(out.kinetics?.referenceTimeMin).toBe(0);
    expect(out.kinetics?.kPerMin).toBeCloseTo(EXAMPLE_DYE.kPerMin, 3);
    expect(methodsText(data, out)).toContain('synthetic example');
  });

  it('asks for the missing time of a typed sample', () => {
    const typed: ConcentrationData['samples'][number] = {
      id: 'x',
      role: 'timed',
      name: 'Sample 1',
      spectrum: null,
      typedAbsorbance: 0.5,
      value: null,
    };
    expect(samplesProblem([typed])).toContain('time of "Sample 1"');
    expect(samplesProblem([{ ...typed, value: 0 }])).toContain('at least two');
  });

  it('loads the example from step 1 and shows k on the results step', async () => {
    let latest = initialConcentrationData;
    render(
      <Harness
        initial={initialConcentrationData}
        Step={SamplesStep}
        onData={(d) => (latest = d)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    expect(latest.samples.length).toBe(13);
    render(<Harness initial={latest} Step={ResultsStep} />);
    expect((await screen.findAllByText(/k = 0\.0/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Download kinetics (CSV)' })).toBeTruthy();
    const methods = screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement;
    expect(methods.value).toContain('pseudo-first-order');
  });
});
