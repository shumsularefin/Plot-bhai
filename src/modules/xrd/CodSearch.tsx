import { useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { hillFormula, parseFormula } from '../../core/xrd/reference/search';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { HelpTip } from '../../ui/HelpTip';
import { readCifText } from './cifClient';
import {
  COD_API,
  fetchCodCif,
  searchCod,
  type CodEntry,
  type CodSearch as Search,
  type CodSearchResult,
} from './codLookup';
import { PeriodicTable } from './PeriodicTable';

const MAX_ELEMENTS = 8;
/** Results shown at first; more on request. */
const FIRST = 30;

interface CodSearchProps {
  onLoaded: (phases: ReferencePhase[]) => void;
  /** COD IDs already among the candidates. */
  loadedIds: ReadonlySet<number>;
  /** Address of the lookup service (tests pass their own). */
  base?: string;
}

const cellText = (cell: CodEntry['cell']) => {
  const v = (x: number | null, d: number) => (x === null ? '–' : formatNumber(x, d));
  return `a ${v(cell.a, 4)}, b ${v(cell.b, 4)}, c ${v(cell.c, 4)} Å; α ${v(cell.alpha, 3)}, β ${v(cell.beta, 3)}, γ ${v(cell.gamma, 3)}°`;
};

/**
 * Search the Crystallography Open Database online by elements (from a periodic table) or by
 * formula, through the lookup service, and add any entry: its CIF is downloaded and its pattern
 * calculated in the browser, exactly as for a CIF file the user loads.
 */
export function CodSearch({ onLoaded, loadedIds, base = COD_API }: CodSearchProps) {
  const [elements, setElements] = useState<string[]>([]);
  const [only, setOnly] = useState(true);
  const [formula, setFormula] = useState('');
  const [result, setResult] = useState<CodSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(FIRST);
  const [adding, setAdding] = useState<Record<number, string>>({});

  if (!base) return null;

  const counts = formula.trim() ? parseFormula(formula) : null;
  const formulaBad = formula.trim() !== '' && counts === null;
  const run = async (search: Search) => {
    setSearching(true);
    setShown(FIRST);
    setFilter('');
    setResult(await searchCod(search, base));
    setSearching(false);
  };
  const toggle = (symbol: string) =>
    setElements(
      elements.includes(symbol) ? elements.filter((e) => e !== symbol) : [...elements, symbol],
    );

  const add = async (entry: CodEntry) => {
    setAdding({ ...adding, [entry.id]: 'Downloading…' });
    const cif = await fetchCodCif(entry.id, base);
    if (!cif.ok) {
      setAdding((a) => ({ ...a, [entry.id]: cif.error }));
      return;
    }
    setAdding((a) => ({ ...a, [entry.id]: 'Calculating the pattern…' }));
    const read = await readCifText(cif.text, `COD ${entry.id}.cif`, `cod-${entry.id}`);
    if (!read.ok) {
      setAdding((a) => ({ ...a, [entry.id]: read.error }));
      return;
    }
    const origin = read.phase.origin;
    onLoaded([
      {
        ...read.phase,
        ...(origin?.kind === 'cif' && { origin: { ...origin, notes: read.notes } }),
      },
    ]);
    setAdding((a) =>
      Object.fromEntries(Object.entries(a).filter(([id]) => id !== String(entry.id))),
    );
  };

  const results = result?.ok && 'results' in result ? result.results : [];
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? results.filter((r) =>
        [r.formula, r.name, r.mineral, r.spaceGroup, String(r.id), String(r.year ?? '')]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : results;

  return (
    <section class="material-section" aria-labelledby="cod-search-title">
      <h3 id="cod-search-title" class="export-title">
        Search COD online{' '}
        <HelpTip term="the online COD search">
          <p>
            Searches the whole Crystallography Open Database through a small lookup service. Only
            the elements, formula and COD numbers you choose are sent; your diffraction data never
            leave this device. The pattern of an entry you add is calculated here from its CIF, like
            a file you load yourself, with the same checks.
          </p>
        </HelpTip>
      </h3>
      <p class="field-hint">
        Click the elements in your sample, or type a formula, then search. Add any result to your
        candidates.
      </p>
      <PeriodicTable selected={elements} onToggle={toggle} max={MAX_ELEMENTS} />
      <div class="cod-controls">
        <p class="cod-selected" aria-live="polite">
          {elements.length === 0 ? 'No elements chosen.' : `Chosen: ${elements.join(', ')}`}
          {elements.length > 0 && (
            <button type="button" class="btn btn-quiet" onClick={() => setElements([])}>
              Clear
            </button>
          )}
        </p>
        <fieldset class="cod-mode">
          <legend class="visually-hidden">Which structures</legend>
          <label class="check">
            <input type="radio" name="cod-only" checked={only} onChange={() => setOnly(true)} />
            Only these elements
          </label>
          <label class="check">
            <input type="radio" name="cod-only" checked={!only} onChange={() => setOnly(false)} />
            These and any others
          </label>
        </fieldset>
        <button
          type="button"
          class="btn btn-primary"
          disabled={elements.length === 0 || searching}
          onClick={() => void run({ kind: 'elements', elements, only })}
        >
          Search by elements
        </button>
      </div>
      <div class="cod-controls">
        <label class="inline-field">
          Or an exact formula
          <input
            value={formula}
            placeholder="for example BiVO4"
            autocomplete="off"
            spellcheck={false}
            aria-invalid={formulaBad}
            onInput={(e) => setFormula(e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="btn"
          disabled={counts === null || searching}
          onClick={() => counts && void run({ kind: 'formula', hill: hillFormula(counts) })}
        >
          Search by formula
        </button>
      </div>
      {formulaBad && (
        <p class="field-hint">Not a formula: use element symbols, for example Fe2O3.</p>
      )}

      <div role="status">
        {searching && <p class="field-hint">Searching COD…</p>}
        {!searching && result && !result.ok && <p class="message is-warning">{result.error}</p>}
        {!searching && result?.ok && 'tooMany' in result && (
          <p class="message is-info">
            COD has {result.count.toLocaleString('en')} structures for this search, more than the{' '}
            {result.max} that can be listed. Choose “Only these elements”, add an element, or type a
            formula.
          </p>
        )}
        {!searching && result?.ok && 'results' in result && (
          <p class="field-hint">
            {result.count === 0
              ? 'COD has no structure for this search.'
              : `${result.count} structure${result.count === 1 ? '' : 's'} found in COD.`}
          </p>
        )}
      </div>

      {results.length > 0 && (
        <>
          {results.length > 10 && (
            <label class="inline-field cod-filter">
              Filter the results
              <input
                type="search"
                value={filter}
                placeholder="formula, name, space group or year"
                onInput={(e) => {
                  setFilter(e.currentTarget.value);
                  setShown(FIRST);
                }}
              />
            </label>
          )}
          <ul class="phase-results" aria-label="COD results">
            {filtered.slice(0, shown).map((entry) => {
              const added = loadedIds.has(entry.id);
              const status = adding[entry.id];
              const busy = status === 'Downloading…' || status === 'Calculating the pattern…';
              return (
                <li key={entry.id} class="phase-result">
                  <div class="phase-result-text">
                    <p class="phase-result-name">
                      <strong>{entry.mineral ?? entry.name ?? entry.formula}</strong>{' '}
                      <span class="phase-result-formula">{entry.formula}</span>
                    </p>
                    <p class="phase-result-meta">
                      {entry.spaceGroup ?? '–'}
                      {entry.spaceGroupNumber !== null && ` (No. ${entry.spaceGroupNumber})`} ·{' '}
                      {cellText(entry.cell)}
                    </p>
                    <p class="phase-result-meta">
                      <a
                        href={`https://www.crystallography.net/cod/${entry.id}.html`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        COD {entry.id}
                      </a>
                      {entry.year !== null && ` · ${entry.year}`}
                      {entry.journal && ` · ${entry.journal}`}
                    </p>
                    {status && !busy && <p class="message is-warning">{status}</p>}
                  </div>
                  <div class="phase-result-action">
                    <button
                      type="button"
                      class={added ? 'btn' : 'btn btn-primary'}
                      disabled={added || busy}
                      aria-label={`${added ? 'Added' : 'Add'} COD ${entry.id}`}
                      onClick={() => void add(entry)}
                    >
                      {added ? 'Added ✓' : busy ? status : 'Add'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {filtered.length > shown && (
            <button type="button" class="btn btn-quiet" onClick={() => setShown(shown * 2)}>
              Show more ({filtered.length - shown} left)
            </button>
          )}
        </>
      )}
    </section>
  );
}
