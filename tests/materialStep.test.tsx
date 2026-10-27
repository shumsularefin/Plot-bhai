import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import { MaterialStep } from '../src/modules/xrd/MaterialStep';
import { DEFAULT_MATERIAL, initialXrdData, type XrdData } from '../src/modules/xrd/data';

// No network in these tests.
vi.mock('../src/modules/xrd/codLookup', () => ({
  COD_API: '',
  searchCod: vi.fn(),
  fetchCodCif: vi.fn(),
}));

const text = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const factors = (
  JSON.parse(text('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;
const read = phaseFromCif(
  text('scripts/cif-cache/9013437.cif'),
  'COD 9013437.cif',
  factors,
  'cod-9013437',
);
if (!read.ok) throw new Error(read.error);
const clinobisvanite = read.phase;

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

describe('MaterialStep', () => {
  it('has one search with the periodic table under it, then CIF loading and the candidates', () => {
    setup();
    expect(screen.getByLabelText('Formula, elements or COD ID')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Periodic table' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose CIF files' })).toBeTruthy();
    expect(screen.getByText(/natural polymers that COD does not hold/)).toBeTruthy();
    expect(screen.getByText(/None yet/)).toBeTruthy();
  });

  it('lists a phase from a CIF as a candidate, with a JCPDS field marked as not verified', () => {
    const store = setup({
      material: {
        ...DEFAULT_MATERIAL,
        candidates: [clinobisvanite.id],
        userPhases: [clinobisvanite],
      },
    });
    const list = screen.getByRole('list', { name: 'Candidate phases' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('link', { name: /COD 9013437/ })).toBeTruthy();
    const jcpds = within(list).getByLabelText(
      /JCPDS\/ICDD card number \(typed by you, not verified\)/,
    );
    fireEvent.input(jcpds, { target: { value: '14-0688' } });
    expect(store.get().material.jcpds).toEqual({ [clinobisvanite.id]: '14-0688' });
    fireEvent.click(within(list).getByRole('button', { name: /^Remove / }));
    expect(store.get().material.candidates).toEqual([]);
  });

  it('asks to add phases of the former built-in library again, and can drop them', () => {
    const store = setup({
      material: { ...DEFAULT_MATERIAL, candidates: ['anatase', 'rutile'], phaseIds: ['anatase'] },
    });
    expect(
      screen.getByText(/2 phases \(anatase, rutile\) came from the former built-in library/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove them from the list' }));
    expect(store.get().material.candidates).toEqual([]);
    expect(store.get().material.phaseIds).toEqual([]);
  });
});
