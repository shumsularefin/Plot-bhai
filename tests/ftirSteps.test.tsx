import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssignStep } from '../src/modules/ftir/AssignStep';
import { CleanStep } from '../src/modules/ftir/CleanStep';
import { exampleSpectra, initialFtirData, type FtirData } from '../src/modules/ftir/data';
import { PeaksStep } from '../src/modules/ftir/PeaksStep';
import { ResultsStep } from '../src/modules/ftir/ResultsStep';
import { UploadStep } from '../src/modules/ftir/UploadStep';
import { methodsText } from '../src/modules/ftir/methodsText';
import { ftirSession } from '../src/modules/ftir/session';
import { EXAMPLE_BANDS } from '../src/core/ftir/synthetic';

// jsdom has no layout engine; the plot only needs the observer to exist.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type Step =
  typeof UploadStep | typeof CleanStep | typeof PeaksStep | typeof AssignStep | typeof ResultsStep;

/** Renders a step with a small stand-in for the wizard's data store. */
function setup(Step: Step, start: Partial<FtirData> = {}) {
  let data: FtirData = { ...initialFtirData, ...start };
  const view = render(<Step data={data} update={() => {}} />);
  const update = (patch: Partial<FtirData>) => {
    data = { ...data, ...patch };
    view.rerender(<Step data={data} update={update} />);
  };
  view.rerender(<Step data={data} update={update} />);
  return { get: () => data, view };
}

describe('FTIR upload step', () => {
  it('loads the synthetic examples and labels them as not real', () => {
    const store = setup(UploadStep);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    expect(store.get().spectra).toHaveLength(2);
    expect(screen.getAllByText('Synthetic, not real data')).toHaveLength(2);
  });

  it('lets the user change the data type, and explains an unreadable paste', async () => {
    const store = setup(UploadStep);
    fireEvent.click(screen.getByRole('button', { name: 'Try with example data' }));
    fireEvent.change(screen.getAllByLabelText(/What are the values/)[0] as HTMLSelectElement, {
      target: { value: 'transmittance' },
    });
    expect(store.get().spectra[0]?.kind).toBe('transmittance');
    expect(store.get().spectra[0]?.kindOrigin).toBe('user');
    fireEvent.click(screen.getByText('Paste data instead'));
    fireEvent.input(screen.getByLabelText(/Two columns/), { target: { value: 'not numbers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load pasted data' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No rows of numbers');
  });
});

describe('FTIR clean step', () => {
  it('switches the baseline on, reports it, undoes and resets', () => {
    const spectra = exampleSpectra();
    const sample = spectra[0];
    if (!sample) throw new Error('missing');
    const store = setup(CleanStep, { spectra });
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Baseline correction' }));
    expect(store.get().processing[sample.id]?.baseline.enabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Asymmetric least squares (automatic)'));
    expect(store.get().processing[sample.id]?.baseline.method).toBe('als');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.get().processing[sample.id]?.baseline.method).toBe('arpls');
    fireEvent.click(screen.getByRole('button', { name: 'Reset all steps' }));
    expect(store.get().processing[sample.id]?.baseline.enabled).toBe(false);
  });

  it('says why a normalised spectrum stays in absorbance when transmittance is chosen', () => {
    const spectra = exampleSpectra();
    setup(CleanStep, { spectra, view: { quantity: 'transmittance' } });
    expect(screen.queryByText(/cannot be turned back into transmittance/)).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Normalisation' }));
    expect(screen.getByText(/cannot be turned back into transmittance/)).toBeTruthy();
  });
});

describe('FTIR peaks and assignment steps', () => {
  it('finds the example bands and moves with the prominence slider', () => {
    const spectra = exampleSpectra();
    const store = setup(PeaksStep, { spectra });
    const heading = screen.getByRole('heading', { name: /Peak table \((\d+)\)/ });
    const count = Number(/\((\d+)\)/.exec(heading.textContent ?? '')?.[1]);
    expect(count).toBeGreaterThanOrEqual(EXAMPLE_BANDS.length - 1);
    fireEvent.input(screen.getByRole('slider'), { target: { value: '45' } });
    expect(store.get().peaks[spectra[0]?.id ?? '']?.prominencePercent).toBe(45);
    const after = Number(
      /\((\d+)\)/.exec(screen.getByRole('heading', { name: /Peak table/ }).textContent ?? '')?.[1],
    );
    expect(after).toBeLessThan(count);
  });

  it('accepts, edits and removes an assignment, and keeps it out of the table until accepted', () => {
    const spectra = exampleSpectra();
    const sample = spectra[0];
    if (!sample) throw new Error('missing');
    const store = setup(AssignStep, {
      spectra,
      peaks: { [sample.id]: { prominencePercent: 20, fromCm: null, toCm: null } },
    });
    expect(store.get().assignments).toEqual({});
    expect(screen.getByText(/Typical ranges, confirm against your literature/)).toBeTruthy();
    const accept = screen
      .getAllByRole('button', { name: /^Accept/ })
      .find((b) => !b.textContent?.includes('every peak')) as HTMLButtonElement;
    fireEvent.click(accept);
    const stored = store.get().assignments[sample.id];
    expect(stored).toHaveLength(1);
    const label = stored?.[0]?.label ?? '';
    expect(label.length).toBeGreaterThan(0);
    // Edit it by hand.
    const box = screen
      .getAllByLabelText('Your assignment')
      .find((el) => (el as HTMLInputElement).value === label) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'my own note' } });
    expect(store.get().assignments[sample.id]?.[0]?.label).toBe('my own note');
    fireEvent.change(box, { target: { value: '' } });
    expect(store.get().assignments[sample.id]).toEqual([]);
    // Accept the best suggestion for all.
    fireEvent.click(
      screen.getByRole('button', { name: /Accept the best suggestion for every peak/ }),
    );
    expect((store.get().assignments[sample.id] ?? []).length).toBeGreaterThan(0);
  });
});

describe('FTIR results step', () => {
  it('lists peaks with only the assignments the user accepted, and writes honest methods text', () => {
    const spectra = exampleSpectra();
    const sample = spectra[0];
    if (!sample) throw new Error('missing');
    const data: FtirData = { ...initialFtirData, spectra };
    setup(ResultsStep, data);
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(5);
    expect(screen.getAllByText('–').length).toBeGreaterThan(0);
    const text = methodsText(data);
    expect(text).toContain('generated example data, not measurements');
    expect(text).toContain('A = 2 − log10(%T)');
    expect(text).not.toContain('assigned');
    expect(text).toContain('not baseline-corrected');
    const oneOfTwo = methodsText({
      ...data,
      processing: {
        [sample.id]: {
          baseline: { enabled: true, method: 'polynomial', degree: 4, logLambda: 5, p: 0.01 },
          smoothing: { enabled: false, window: 11, order: 3 },
          normalise: { enabled: false, method: 'max' },
        },
      },
    });
    expect(oneOfTwo).toContain(
      'iterative polynomial baseline correction (degree 4) (1 of 2 spectra)',
    );
    const withAssignment = methodsText({
      ...data,
      assignments: { [sample.id]: [{ wavenumber: 2920, label: 'x' }] },
    });
    expect(withAssignment).toContain('not proof of the groups present');
    expect(withAssignment).toContain('10.3390/molecules30030684');
  });

  it('round-trips a session file', () => {
    const data: FtirData = { ...initialFtirData, spectra: exampleSpectra(), toleranceCm: 22 };
    const text = ftirSession.serialise({ step: 4, furthest: 4, data });
    const parsed = ftirSession.parse(text);
    expect(parsed.ok && parsed.state.data.toleranceCm).toBe(22);
    expect(parsed.ok && parsed.state.data.spectra[0]?.wavenumber).toBeInstanceOf(Float64Array);
    expect(ftirSession.parse('{"app":"xrd-toolkit","kind":"uvvis-session"}')).toMatchObject({
      ok: false,
      reason: 'This is not a FTIR session file.',
    });
    const damaged = text.replace('"values":{"$f64":[', '"values":{"$f64":[1,');
    expect(ftirSession.parse(damaged)).toMatchObject({ ok: false });
  });
});
