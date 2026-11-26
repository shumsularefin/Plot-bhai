import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
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
  {
    id: 'two',
    title: 'Second step',
    summary: 'What the second step does',
    render: () => <p>Second content</p>,
  },
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
  it('lists every step as a tab, and names the open one with its place', async () => {
    const store = await renderWizard('sidebar');
    act(() => store.set((s) => ({ ...s, step: 1, furthest: 1 })));
    const tabs = screen.getByRole('navigation', { name: 'Test tool steps' });
    expect(tabs.querySelectorAll('button')).toHaveLength(3);
    expect(tabs.querySelector('[aria-current="step"]')?.textContent).toContain('Second step');
    // Under the open step's heading, and as the tab's hover hint.
    expect(screen.getByText('What the second step does')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Step 2: Second step' }).getAttribute('title'),
    ).toContain('What the second step does');
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.getByText('Saved on this device')).toBeTruthy();
  });

  it('blocks Next with a plain-language message until the step is valid', async () => {
    await renderWizard('validation');
    expect(heading().textContent).toBe('First step');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a name to continue.');
    expect(heading().textContent).toBe('First step');

    // The message goes as soon as the problem is fixed, before Next is pressed again.
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Sample A' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
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
    fireEvent.click(screen.getAllByRole('button', { name: /First step/ })[0] as HTMLElement);
    expect(heading().textContent).toBe('First step');
    // Reached steps stay clickable after going back.
    expect(screen.getAllByRole('button', { name: /Third step/ }).length).toBeGreaterThan(0);
  });

  it('tabs: reached steps can be opened, later ones cannot', async () => {
    const store = await renderWizard('compact');
    act(() => store.set((s) => ({ ...s, step: 1, furthest: 1 })));
    expect(screen.getByRole('button', { name: 'Step 3: Third step' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Step 1: First step' }));
    expect(heading().textContent).toBe('First step');
    fireEvent.click(screen.getByRole('button', { name: 'Step 2: Second step' }));
    expect(heading().textContent).toBe('Second step');
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
    // Start over lives in the Settings menu.
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(heading().textContent).toBe('First step');
    expect(store.get()).toEqual(initialWizardState({ name: '' }));
  });
});
