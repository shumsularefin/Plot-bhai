/*
 * The phase search with the lookup service stubbed: the search box and the periodic table edit
 * the same query, COD is asked once typing stops, results are listed under the table, too-large
 * searches explain what to do, and adding an entry downloads its CIF and calculates the phase (the
 * real CIF reader, run without a worker here).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import { hillFormula, parseFormula } from '../src/core/xrd/reference/search';
import type { ReferencePhase } from '../src/core/xrd/reference/types';
import { PhaseSearch } from '../src/modules/xrd/PhaseSearch';

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

const box = () => screen.getByLabelText('Formula, elements or COD ID') as HTMLInputElement;
const element = (symbol: string) => screen.getByRole('button', { name: new RegExp(`^${symbol},`) });
const show = (loaded: ReferencePhase[] = [], base = BASE) =>
  render(
    <PhaseSearch
      onLoaded={(p) => loaded.push(...p)}
      loadedIds={new Set()}
      renderLibraryPhase={() => null}
      base={base}
    />,
  );
const slow = { timeout: 3000 };

afterEach(() => vi.unstubAllGlobals());

describe('phase search', () => {
  it('writes formulas in COD’s Hill order', () => {
    const hill = (f: string) => hillFormula(parseFormula(f) as Record<string, number>);
    expect(hill('BiVO4')).toBe('Bi O4 V');
    expect(hill('Fe2O3')).toBe('Fe2 O3');
    expect(hill('C2H5OH')).toBe('C2 H6 O');
    expect(hill('NaCl')).toBe('Cl Na');
  });

  it('turns table clicks into the search text, asks COD and adds an entry as a calculated phase', async () => {
    const asked = stubFetch({ count: 1, results: [entry] });
    const loaded: ReferencePhase[] = [];
    show(loaded);
    for (const el of ['Bi', 'V', 'O']) fireEvent.click(element(el));
    expect(box().value).toBe('Bi-V-O');
    expect(element('V').getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Crystallography Open Database (1)', {}, slow)).toBeTruthy();
    // Asked once, after the clicks stopped.
    expect(asked).toEqual([`${BASE}/search?elements=Bi%2CO%2CV&only=1`]);
    expect(screen.getByText('Clinobisvanite')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add COD 9013437' }));
    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(asked[1]).toBe(`${BASE}/cif/9013437`);
    expect(loaded[0]?.codId).toBe(9013437);
    expect(loaded[0]?.peaks.length).toBeGreaterThan(10);
  });

  it('switches between exactly these elements and these with others', async () => {
    const asked = stubFetch({ count: 24133, tooMany: true, max: 300 });
    show();
    fireEvent.input(box(), { target: { value: 'Bi V' } });
    expect(screen.getByText(/contain Bi and V, with or without other elements/)).toBeTruthy();
    expect(await screen.findByText(/24,133 structures/, {}, slow)).toBeTruthy();
    expect(asked[0]).toBe(`${BASE}/search?elements=Bi%2CV`);
    fireEvent.click(screen.getByRole('radio', { name: 'Only these elements' }));
    expect(box().value).toBe('Bi-V');
    fireEvent.click(element('O'));
    expect(box().value).toBe('Bi-V-O');
  });

  it('searches a typed formula, and says when the service cannot be reached', async () => {
    const asked = stubFetch({ count: 0, results: [] });
    show();
    fireEvent.input(box(), { target: { value: 'BiVO4' } });
    await screen.findByText(/COD has no structure for this search/, {}, slow);
    expect(asked[0]).toBe(`${BASE}/search?formula=Bi+O4+V`);

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    fireEvent.input(box(), { target: { value: 'Fe2O3' } });
    expect(await screen.findByText(/could not be reached/, {}, slow)).toBeTruthy();
  });

  it('offers a typed COD number directly', () => {
    stubFetch({ count: 0, results: [] });
    show();
    fireEvent.input(box(), { target: { value: '9013437' } });
    expect(screen.getByRole('button', { name: 'Add COD 9013437' })).toBeTruthy();
  });

  it('shows the details of the element pointed at', () => {
    show([], '');
    fireEvent.mouseEnter(element('Fe'));
    expect(screen.getByText('Iron')).toBeTruthy();
    expect(screen.getByText(/transition metal · period 4, group 8 · d-block/)).toBeTruthy();
    expect(screen.getByText(/Standard atomic weight 55\.845 g\/mol/)).toBeTruthy();
    fireEvent.mouseEnter(element('Tc'));
    expect(screen.getByText(/No standard atomic weight/)).toBeTruthy();
  });

  it('works without the lookup service and says so', () => {
    const asked = stubFetch({ count: 0, results: [] });
    show([], '');
    fireEvent.input(box(), { target: { value: 'BiVO4' } });
    expect(asked).toEqual([]);
  });
});
