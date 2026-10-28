import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { initialDscMethodsData, type DscMethodsData } from '../src/modules/thermal/dscMethods/data';
import { uploadProblem } from '../src/modules/thermal/dscMethods/analysis';
import { DscMethodsResultsStep } from '../src/modules/thermal/dscMethods/ResultsStep';
import { DscMethodsUploadStep } from '../src/modules/thermal/dscMethods/UploadStep';
import { dscMethodsText } from '../src/modules/thermal/dscMethods/methodsText';
import { analyse } from '../src/modules/thermal/dscMethods/analysis';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Picks a method and loads its example in the upload step; returns the saved data. */
function example(label: string): DscMethodsData {
  let data: DscMethodsData = initialDscMethodsData;
  const update = (patch: Partial<DscMethodsData>) => {
    data = { ...data, ...patch };
    view.rerender(<DscMethodsUploadStep data={data} update={update} />);
  };
  const view = render(<DscMethodsUploadStep data={data} update={update} />);
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
  view.unmount();
  return data;
}

function results(data: DscMethodsData) {
  render(<DscMethodsResultsStep data={data} update={() => {}} />);
  return screen.getByRole('note').textContent ?? '';
}

describe('DSC methods wizard', () => {
  it('asks for every file and the masses before going on', () => {
    expect(uploadProblem(initialDscMethodsData)).toContain('empty pan');
    const data = example('Heat capacity (sapphire method)');
    expect(uploadProblem(data)).toBeNull();
    expect(uploadProblem({ ...data, sapphireMassMg: null })).toContain('masses');
    expect(uploadProblem({ ...data, heatFlowUnit: 'W/g' })).toContain('mW');
  });

  it('gives the heat capacity of the synthetic sample', () => {
    const data = example('Heat capacity (sapphire method)');
    const text = results(data);
    // The example sample has cp = 1.2 + 0.001 (T − 20) J/(g·K): 1.230 at 50 °C, 1.430 at 250 °C.
    expect(text).toContain('from 1.230 J/(g·K) at 50 °C to 1.430 J/(g·K) at 250 °C');
    expect(screen.getByText(/typed in by hand/)).toBeTruthy();
    expect(dscMethodsText(data, analyse(data))).toContain('three-run sapphire (ratio) method');
  });

  it('gives the purity of the synthetic melting peak', () => {
    const data = example('Purity (van ’t Hoff)');
    const text = results(data);
    expect(text).toMatch(/Estimated purity 99\.5\d mol %/);
    expect(dscMethodsText(data, analyse(data))).toContain('No linearisation or thermal-lag');
  });

  it('gives the OIT of the synthetic isothermal run', () => {
    const data = example('Oxidation induction time (OIT)');
    expect(results(data)).toContain('OIT = 27.00 min (onset at 32.00 min)');
    expect(dscMethodsText(data, analyse(data))).toContain('gas switch at 5.00 min');
  });
});
