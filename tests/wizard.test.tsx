import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createPersistedStore } from '../src/ui/persist/persistedStore';
import { initialWizardState, type WizardStep } from '../src/ui/wizard/types';
import { Wizard } from '../src/ui/wizard/Wizard';

interface Data {
  name: string;
}

const steps: WizardStep<Data>[] = [
  {
    id: 'one',
    title: 'First step',
    render: ({ data, update }) => (
      <label>
        Name
        <input value={data.name} onInput={(e) => update({ name: e.currentTarget.value })} />
      </label>
    ),
    validate: (data) => (data.name === '' ? 'Enter a name to continue.' : null),
  },
  { id: 'two', title: 'Second step', render: () => <p>Second content</p> },
  { id: 'three', title: 'Third step', render: () => <p>Third content</p> },
];

function makeStore(key: string) {
  return createPersistedStore({ key, version: 1, initial: initialWizardState<Data>({ name: '' }) });
}

async function renderWizard(key: string) {
  const store = makeStore(key);
  render(<Wizard title="Test tool" steps={steps} store={store} />);
  await act(() => store.ready);
  return store;
}

const heading = () => screen.getByRole('heading', { level: 2 });

describe('Wizard', () => {
  it('blocks Next with a plain-language message until the step is valid', async () => {
    await renderWizard('validation');
    expect(heading().textContent).toBe('First step');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a name to continue.');
    expect(heading().textContent).toBe('First step');

    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Sample A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(heading().textContent).toBe('Second step');
  });

  it('moves Back and Next and disables Next on the last step', async () => {
    const store = await renderWizard('navigation');
    act(() => store.set((s) => ({ ...s, data: { name: 'x' } })));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(heading().textContent).toBe('Third step');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(heading().textContent).toBe('Second step');
  });

  it('lets the user jump back to a reached step from the stepper', async () => {
    const store = await renderWizard('stepper');
    act(() => store.set((s) => ({ ...s, step: 2, furthest: 2 })));
    fireEvent.click(screen.getByRole('button', { name: /First step/ }));
    expect(heading().textContent).toBe('First step');
    // Reached steps stay clickable after going back.
    expect(screen.getByRole('button', { name: /Third step/ })).toBeTruthy();
  });

  it('restores the step and data after a refresh', async () => {
    const store = await renderWizard('refresh');
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Kept' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await store.flush();
    screen.getByRole('heading', { name: 'Second step' });

    // Simulate a refresh: unmount and build a new store with the same key.
    document.body.innerHTML = '';
    await renderWizard('refresh');
    expect(heading().textContent).toBe('Second step');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Kept');
  });

  it('start over clears everything after confirmation', async () => {
    const store = await renderWizard('reset');
    act(() => store.set({ step: 1, furthest: 1, data: { name: 'x' } }));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(heading().textContent).toBe('First step');
    expect(store.get()).toEqual(initialWizardState({ name: '' }));
  });
});
