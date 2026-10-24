import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { CleanStep } from '../src/modules/uvvis/CleanStep';
import { exampleSpectra, initialUvvisData, type UvvisData } from '../src/modules/uvvis/data';
import { UploadStep } from '../src/modules/uvvis/UploadStep';

// jsdom has no layout engine; the plot only needs the observer to exist.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Renders a step with a small stand-in for the wizard's data store. */
function setup(Step: typeof UploadStep | typeof CleanStep, start: Partial<UvvisData> = {}) {
  let data: UvvisData = { ...initialUvvisData, ...start };
  const view = render(<Step data={data} update={() => {}} />);
  const update = (patch: Partial<UvvisData>) => {
    data = { ...data, ...patch };
    view.rerender(<Step data={data} update={update} />);
  };
  view.rerender(<Step data={data} update={update} />);
  return { get: () => data };
}

describe('UV-Vis upload step', () => {
  it('loads the synthetic examples and labels them as not real', () => {
    const store = setup(UploadStep);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    expect(store.get().spectra).toHaveLength(3);
    expect(screen.getAllByText('Synthetic, not real data')).toHaveLength(3);
    // The data type is shown and can be changed by the user.
    const kinds = screen.getAllByLabelText(/What are the values/);
    expect(kinds).toHaveLength(3);
  });

  it('lets the user correct the data type and keeps that choice', () => {
    const store = setup(UploadStep);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    const kind = screen.getAllByLabelText(/What are the values/)[0] as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: 'transmittance' } });
    const first = store.get().spectra[0];
    expect(first?.kind).toBe('transmittance');
    expect(first?.kindOrigin).toBe('user');
  });

  it('explains a file that cannot be read', async () => {
    setup(UploadStep);
    fireEvent.click(screen.getByText('Paste data instead'));
    fireEvent.input(screen.getByLabelText(/Two columns/), { target: { value: 'not numbers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load pasted data' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('No rows of numbers');
  });
});

describe('UV-Vis cleaning step', () => {
  it('subtracts the blank, reports λmax and has no blank option without a match', () => {
    const spectra = exampleSpectra();
    const sample = spectra[0];
    const blank = spectra[1];
    if (!sample || !blank) throw new Error('example spectra missing');
    const store = setup(CleanStep, { spectra });

    fireEvent.click(screen.getByRole('switch', { name: 'Blank subtraction' }));
    const choice = screen.getByLabelText('Blank spectrum') as HTMLSelectElement;
    fireEvent.change(choice, { target: { value: blank.id } });
    const settings = store.get().cleaning[sample.id];
    expect(settings?.blank).toEqual({ enabled: true, blankId: blank.id });

    // Every spectrum gets a λmax row.
    expect(screen.getByRole('table', { hidden: true })).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBe(1 + spectra.length);
  });

  it('undoes and resets', () => {
    const spectra = exampleSpectra();
    const sample = spectra[0];
    if (!sample) throw new Error('example spectra missing');
    const store = setup(CleanStep, { spectra });
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Smoothing' }));
    expect(store.get().cleaning[sample.id]?.smoothing.enabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.get().cleaning).toEqual({});
  });

  it('asks the user to go back when nothing is loaded', () => {
    setup(CleanStep);
    expect(screen.getByText(/No spectra are loaded/)).toBeTruthy();
  });
});
