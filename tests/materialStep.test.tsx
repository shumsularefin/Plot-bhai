import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { MaterialStep } from '../src/modules/xrd/MaterialStep';
import { initialXrdData, type XrdData } from '../src/modules/xrd/data';

/** Renders the step with a small stand-in for the wizard's data store. */
function setup() {
  let data: XrdData = { ...initialXrdData };
  const view = render(<MaterialStep data={data} update={() => {}} />);
  const update = (patch: Partial<XrdData>) => {
    data = { ...data, ...patch };
    view.rerender(<MaterialStep data={data} update={update} />);
  };
  view.rerender(<MaterialStep data={data} update={update} />);
  return { get: () => data };
}

describe('MaterialStep', () => {
  it('finds a material by name, lists its phases and keeps the choice', async () => {
    const store = setup();
    const search = await screen.findByLabelText(/Material \(name/);
    fireEvent.input(search, { target: { value: 'titania' } });
    fireEvent.click(await screen.findByRole('button', { name: /Titanium dioxide/ }));
    expect(store.get().material.familyId).toBe('tio2');

    // Every phase is listed with its COD entry; ticking one stores it.
    const anatase = await screen.findByRole('checkbox', { name: /Anatase/ });
    fireEvent.click(anatase);
    expect(store.get().material.phaseIds).toEqual(['anatase']);
    expect(screen.getAllByRole('link', { name: /COD \d+/ }).length).toBe(3);

    // The JCPDS field appears for a ticked phase and is labelled as not verified.
    const jcpds = screen.getByLabelText(/JCPDS\/ICDD card number \(typed by you, not verified\)/);
    fireEvent.input(jcpds, { target: { value: '21-1272' } });
    expect(store.get().material.jcpds).toEqual({ anatase: '21-1272' });

    // Choosing another material clears the phase choice.
    fireEvent.input(search, { target: { value: 'zinc oxide' } });
    fireEvent.click(await screen.findByRole('button', { name: /Zinc oxide/ }));
    expect(store.get().material.phaseIds).toEqual([]);
  });

  it('says so when nothing matches', async () => {
    setup();
    fireEvent.input(await screen.findByLabelText(/Material \(name/), {
      target: { value: 'unobtainium' },
    });
    expect(await screen.findByText(/No material matches/)).toBeTruthy();
  });
});
