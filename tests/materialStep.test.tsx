import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { MaterialStep } from '../src/modules/xrd/MaterialStep';
import { initialXrdData, type XrdData } from '../src/modules/xrd/data';

/** Renders the step with a small stand-in for the wizard's data store. */
function setup(start: Partial<XrdData> = {}) {
  let data: XrdData = { ...initialXrdData, ...start };
  const view = render(<MaterialStep data={data} update={() => {}} />);
  const update = (patch: Partial<XrdData>) => {
    data = { ...data, ...patch };
    view.rerender(<MaterialStep data={data} update={update} />);
  };
  view.rerender(<MaterialStep data={data} update={update} />);
  return { get: () => data };
}

const search = () => screen.getByLabelText(/Formula, elements, name, COD ID or space group/);

describe('MaterialStep', () => {
  it('finds phases by formula in any element order and adds them as candidates', () => {
    const store = setup();
    fireEvent.input(search(), { target: { value: 'VBiO4' } });
    const results = screen.getByRole('list', { name: 'Search results' });
    expect(within(results).getByText(/Dreyerite/)).toBeTruthy();
    expect(within(results).getByText(/Pucherite/)).toBeTruthy();
    // Each result shows its crystal system, space group with number and a COD link.
    expect(within(results).getAllByText(/tetragonal, I 41\/a m d :2 \(No\. 141\)/).length).toBe(1);
    expect(within(results).getAllByRole('link', { name: /COD \d{7}/ }).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Add Dreyerite/ }));
    expect(store.get().material.candidates).toEqual(['dreyerite']);
  });

  it('keeps candidates from different families, with a JCPDS field marked as not verified', () => {
    const store = setup();
    fireEvent.input(search(), { target: { value: 'anatase' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Anatase/ }));
    fireEvent.input(search(), { target: { value: 'ZnO' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Zincite/ }));
    expect(store.get().material.candidates).toEqual(['anatase', 'zno-wurtzite']);
    const list = screen.getByRole('list', { name: 'Candidate phases' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    const jcpds = within(list).getAllByLabelText(
      /JCPDS\/ICDD card number \(typed by you, not verified\)/,
    )[0] as HTMLInputElement;
    fireEvent.input(jcpds, { target: { value: '21-1272' } });
    expect(store.get().material.jcpds).toEqual({ anatase: '21-1272' });
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Anatase' }));
    expect(store.get().material.candidates).toEqual(['zno-wurtzite']);
  });

  it('searches a chemical system, a COD ID and a space group', () => {
    setup();
    fireEvent.input(search(), { target: { value: 'Bi-O' } });
    expect(screen.getByText(/Phases made of exactly Bi, O/)).toBeTruthy();
    expect(screen.getByText(/Bismite/)).toBeTruthy();
    expect(screen.queryByText(/Dreyerite/)).toBeNull();
    fireEvent.input(search(), { target: { value: '9011741' } });
    expect(screen.getByText(/Dreyerite/)).toBeTruthy();
    fireEvent.input(search(), { target: { value: 'Fm-3m' } });
    expect(screen.getByText(/Gold \(fcc\)/)).toBeTruthy();
  });

  it('points to COD and to loading a CIF when nothing in the library matches', () => {
    setup();
    fireEvent.input(search(), { target: { value: 'Cs2AgBiBr6' } });
    expect(screen.getByText(/Not in the library/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Search COD for/ }) as HTMLAnchorElement;
    expect(link.href).toBe(
      'https://www.crystallography.net/cod/result?formula=Ag%20Bi%20Br6%20Cs2',
    );
    expect(screen.getByRole('button', { name: 'Choose CIF files' })).toBeTruthy();
  });
});
