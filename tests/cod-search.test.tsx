/*
 * The online COD search panel with the lookup service stubbed: elements chosen in the periodic
 * table are sent, results are listed, too-large searches explain what to do, and adding an entry
 * downloads its CIF and calculates the phase (the real CIF reader, run without a worker here).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import { hillFormula, parseFormula } from '../src/core/xrd/reference/search';
import type { ReferencePhase } from '../src/core/xrd/reference/types';
import { CodSearch } from '../src/modules/xrd/CodSearch';

const text = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const factors = (
  JSON.parse(text('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;

vi.mock('../src/modules/xrd/cifClient', () => ({
  readCifText: async (cif: string, fileName: string, id: string) =>
    phaseFromCif(cif, fileName, factors, id),
}));

const BASE = 'https://lookup.test';
const entry = {
  id: 9013437,
  formula: 'Bi O4 V',
  name: 'Bismuth vanadate',
  mineral: 'Clinobisvanite',
  spaceGroup: 'I 1 1 2/b',
  spaceGroupNumber: 15,
  cell: { a: 5.1935, b: 5.0898, c: 11.6972, alpha: 90, beta: 90, gamma: 90.387 },
  year: 1979,
  journal: 'Materials Research Bulletin',
  doi: null,
};

function stubFetch(search: unknown) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    if (url.includes('/search?')) return new Response(JSON.stringify(search));
    return new Response(text('scripts/cif-cache/9013437.cif'));
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('online COD search', () => {
  it('writes formulas in COD’s Hill order', () => {
    const hill = (f: string) => hillFormula(parseFormula(f) as Record<string, number>);
    expect(hill('BiVO4')).toBe('Bi O4 V');
    expect(hill('Fe2O3')).toBe('Fe2 O3');
    expect(hill('C2H5OH')).toBe('C2 H6 O');
    expect(hill('NaCl')).toBe('Cl Na');
  });

  it('is hidden until the lookup service is configured', () => {
    const { container } = render(<CodSearch onLoaded={() => {}} loadedIds={new Set()} base="" />);
    expect(container.innerHTML).toBe('');
  });

  it('searches the chosen elements and adds an entry as a calculated phase', async () => {
    const asked = stubFetch({ count: 1, results: [entry] });
    const loaded: ReferencePhase[] = [];
    render(<CodSearch onLoaded={(p) => loaded.push(...p)} loadedIds={new Set()} base={BASE} />);
    for (const el of ['Bi', 'V', 'O']) fireEvent.click(screen.getByRole('button', { name: el }));
    expect(screen.getByText('Chosen: Bi, V, O')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search by elements' }));
    await screen.findByText('1 structure found in COD.');
    expect(asked[0]).toBe(`${BASE}/search?elements=Bi%2CV%2CO&only=1`);
    expect(screen.getByText('Clinobisvanite')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add COD 9013437' }));
    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(asked[1]).toBe(`${BASE}/cif/9013437`);
    expect(loaded[0]?.codId).toBe(9013437);
    expect(loaded[0]?.peaks.length).toBeGreaterThan(10);
  });

  it('explains how to narrow a search with too many results', async () => {
    stubFetch({ count: 24133, tooMany: true, max: 300 });
    render(<CodSearch onLoaded={() => {}} loadedIds={new Set()} base={BASE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fe' }));
    fireEvent.click(screen.getByRole('radio', { name: 'These and any others' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search by elements' }));
    expect(await screen.findByText(/24,133 structures/)).toBeTruthy();
  });

  it('searches an exact formula, and says when the service cannot be reached', async () => {
    const asked = stubFetch({ count: 0, results: [] });
    render(<CodSearch onLoaded={() => {}} loadedIds={new Set()} base={BASE} />);
    fireEvent.input(screen.getByLabelText('Or an exact formula'), {
      target: { value: 'BiVO4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search by formula' }));
    await screen.findByText('COD has no structure for this search.');
    expect(asked[0]).toBe(`${BASE}/search?formula=Bi+O4+V`);

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search by formula' }));
    expect(await screen.findByText(/could not be reached/)).toBeTruthy();
  });
});
