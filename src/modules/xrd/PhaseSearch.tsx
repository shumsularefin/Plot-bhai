import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import {
  hillFormula,
  parseFormula,
  parseQuery,
  searchPhases,
  type PhaseQuery,
} from '../../core/xrd/reference/search';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { HelpTip } from '../../ui/HelpTip';
import { readCifText } from './cifClient';
import {
  COD_API,
  fetchCodCif,
  searchCod,
  type CodEntry,
  type CodSearch,
  type CodSearchResult,
} from './codLookup';
import { PeriodicTable } from './PeriodicTable';
import { libraryIndex } from './referenceLibrary';

const MAX_ELEMENTS = 8;
/** Results shown at first; more on request. */
const FIRST = 30;
/** Pause after typing or clicking before COD is asked, so it is asked once per search. */
const DEBOUNCE_MS = 500;

const libraryCount = libraryIndex.families.reduce((n, f) => n + f.phases.length, 0);

/** Elements a query names, to light up in the periodic table. */
function elementsOf(query: PhaseQuery): string[] {
  if (query.kind === 'chemicalSystem' || query.kind === 'elements') return query.elements;
  if (query.kind === 'formula') return Object.keys(parseFormula(query.formula) ?? {});
  return [];
}

/** The COD search a query asks for, or null when COD cannot answer it. */
function codSearchOf(query: PhaseQuery): CodSearch | null {
  switch (query.kind) {
    case 'formula': {
      const counts = parseFormula(query.formula);
      return counts ? { kind: 'formula', hill: hillFormula(counts) } : null;
    }
    case 'chemicalSystem':
      return { kind: 'elements', elements: query.elements, only: true };
    case 'elements':
      return { kind: 'elements', elements: query.elements, only: false };
    default:
      return null;
  }
}

function describe(query: PhaseQuery): string {
  switch (query.kind) {
    case 'all':
      return 'Type a formula or elements, or click elements in the table.';
    case 'codId':
      return `COD entry ${query.codId}.`;
    case 'chemicalSystem':
      return `Structures made of exactly ${query.elements.join(', ')}.`;
    case 'elements':
      return `Structures that contain ${query.elements.join(' and ')}, with or without other elements.`;
    case 'formula':
      return `Structures with the formula ${query.formula}.`;
    default:
      return 'Names and space groups are matched in the polymer library only. COD is searched by formula, elements or COD number.';
  }
}

const cellText = (cell: CodEntry['cell']) => {
  const v = (x: number | null, d: number) => (x === null ? '–' : formatNumber(x, d));
  return `a ${v(cell.a, 4)}, b ${v(cell.b, 4)}, c ${v(cell.c, 4)} Å; α ${v(cell.alpha, 3)}, β ${v(cell.beta, 3)}, γ ${v(cell.gamma, 3)}°`;
};

interface PhaseSearchProps {
  /** Phases calculated from COD entries the user added. */
  onLoaded: (phases: ReferencePhase[]) => void;
  /** COD IDs already among the candidates. */
  loadedIds: ReadonlySet<number>;
  /** A row for a polymer-library phase, with its add button. */
  renderLibraryPhase: (hit: ReturnType<typeof searchPhases>[number]) => ComponentChildren;
  /** Address of the lookup service (tests pass their own); empty turns the online search off. */
  base?: string;
}

/**
 * One search for phases, as in the Materials Project: a search box with a periodic table under
 * it, both editing the same query, and the results under the table. Formulas, element sets and
 * COD numbers are looked up in the Crystallography Open Database through the lookup service (only
 * those are sent); every query is also matched in the built-in natural-polymer library. An entry
 * added from COD has its CIF downloaded and its pattern calculated in the browser, exactly as for
 * a CIF file the user loads.
 */
export function PhaseSearch({
  onLoaded,
  loadedIds,
  renderLibraryPhase,
  base = COD_API,
}: PhaseSearchProps) {
  const [query, setQuery] = useState('');
  const [exact, setExact] = useState(true);
  const [result, setResult] = useState<CodSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(FIRST);
  const [adding, setAdding] = useState<Record<number, string>>({});
  const asked = useRef(0);
  // Pressing Search (or Enter) searches at once instead of after the typing pause.
  const [pressed, setPressed] = useState(0);
  const immediate = useRef(false);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const selected = elementsOf(parsed);
  const search = base ? codSearchOf(parsed) : null;
  const searchKey = search && JSON.stringify(search);
  const libraryHits = useMemo(
    () =>
      libraryCount > 0 && parsed.kind !== 'all' ? searchPhases(libraryIndex.families, query) : [],
    [parsed, query],
  );

  useEffect(() => {
    const ticket = ++asked.current;
    setFilter('');
    setShown(FIRST);
    if (!search) {
      setResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const delay = immediate.current ? 0 : DEBOUNCE_MS;
    immediate.current = false;
    const timer = setTimeout(() => {
      void searchCod(search, base).then((r) => {
        if (ticket !== asked.current) return; // an older search answered late
        setResult(r);
        setSearching(false);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [searchKey, pressed]); // eslint-disable-line react-hooks/exhaustive-deps -- search is derived from searchKey

  const writeElements = (elements: readonly string[], asExact: boolean) =>
    setQuery(elements.join(asExact ? '-' : ' '));
  const elementQuery = parsed.kind === 'chemicalSystem' || parsed.kind === 'elements';
  // A typed "Bi V" keeps meaning "contains"; otherwise the last choice of the radio buttons holds.
  const toggle = (symbol: string) =>
    writeElements(
      selected.includes(symbol) ? selected.filter((e) => e !== symbol) : [...selected, symbol],
      elementQuery && selected.length > 1 ? parsed.kind === 'chemicalSystem' : exact,
    );

  const add = async (id: number) => {
    setAdding((a) => ({ ...a, [id]: 'Downloading…' }));
    const cif = await fetchCodCif(id, base);
    if (!cif.ok) {
      setAdding((a) => ({ ...a, [id]: cif.error }));
      return;
    }
    setAdding((a) => ({ ...a, [id]: 'Calculating the pattern…' }));
    const read = await readCifText(cif.text, `COD ${id}.cif`, `cod-${id}`);
    if (!read.ok) {
      setAdding((a) => ({ ...a, [id]: read.error }));
      return;
    }
    const origin = read.phase.origin;
    onLoaded([
      {
        ...read.phase,
        ...(origin?.kind === 'cif' && { origin: { ...origin, notes: read.notes } }),
      },
    ]);
    setAdding((a) => Object.fromEntries(Object.entries(a).filter(([key]) => key !== String(id))));
  };
  const addButton = (id: number) => {
    const added = loadedIds.has(id);
    const status = adding[id];
    const busy = status === 'Downloading…' || status === 'Calculating the pattern…';
    return (
      <>
        <button
          type="button"
          class={added ? 'btn' : 'btn btn-primary'}
          disabled={added || busy}
          aria-label={`${added ? 'Added' : 'Add'} COD ${id}`}
          onClick={() => void add(id)}
        >
          {added ? 'Added ✓' : busy ? status : 'Add'}
        </button>
        {status && !busy && <p class="message is-warning">{status}</p>}
      </>
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
    <section class="material-section phase-search" aria-labelledby="search-title">
      <h3 id="search-title" class="export-title">
        Search for phases{' '}
        <HelpTip term="the phase search">
          <p>
            A formula (BiVO4, Fe2O3) finds structures with exactly that formula. Elements joined by
            hyphens (Bi-V-O) find structures made of exactly those elements; elements separated by
            spaces (Bi V O) find structures that contain them all, with or without others. A 7-digit
            number is a COD entry. Clicking elements in the table writes them into the search box.
          </p>
          <p>
            The Crystallography Open Database is searched online through a small lookup service:
            only the formula, element symbols or COD number are sent, never your data. The pattern
            of an entry you add is calculated here, in your browser, from its CIF.
          </p>
        </HelpTip>
      </h3>
      <PeriodicTable selected={selected} onToggle={toggle} max={MAX_ELEMENTS} />
      <form
        class="material-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          immediate.current = true;
          setPressed((n) => n + 1);
        }}
      >
        <label class="inline-field material-query">
          Formula, elements or COD ID
          <input
            type="search"
            value={query}
            placeholder="for example BiVO4, Bi-V-O, Bi V or 9013437"
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="btn btn-primary" disabled={!search && libraryCount === 0}>
          Search
        </button>
        {query && (
          <button type="button" class="btn btn-quiet" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </form>
      <p class="field-hint" role="status">
        {describe(parsed)}
      </p>
      {elementQuery && selected.length > 1 && (
        <fieldset class="cod-mode">
          <legend class="visually-hidden">Which structures</legend>
          <label class="check">
            <input
              type="radio"
              name="search-exact"
              checked={parsed.kind === 'chemicalSystem'}
              onChange={() => {
                setExact(true);
                writeElements(selected, true);
              }}
            />
            Only these elements
          </label>
          <label class="check">
            <input
              type="radio"
              name="search-exact"
              checked={parsed.kind === 'elements'}
              onChange={() => {
                setExact(false);
                writeElements(selected, false);
              }}
            />
            These and any others
          </label>
        </fieldset>
      )}

      <div class="phase-search-results" aria-label="Search results" role="region">
        {libraryHits.length > 0 && (
          <>
            <h4 class="phase-search-source">Natural polymer library ({libraryHits.length})</h4>
            <ul class="phase-results">{libraryHits.map(renderLibraryPhase)}</ul>
          </>
        )}

        {parsed.kind === 'codId' && base && (
          <ul class="phase-results" aria-label="COD entry">
            <li class="phase-result">
              <div class="phase-result-text">
                <p class="phase-result-name">
                  <strong>COD {parsed.codId}</strong>
                </p>
                <p class="phase-result-meta">
                  <a
                    href={`https://www.crystallography.net/cod/${parsed.codId}.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    See the entry on the COD website
                  </a>{' '}
                  (opens a new tab)
                </p>
              </div>
              <div class="phase-result-action">{addButton(parsed.codId)}</div>
            </li>
          </ul>
        )}

        {!base && search === null && parsed.kind !== 'all' && libraryHits.length === 0 && (
          <p class="message is-info">
            <strong>Not found.</strong> The online COD search is not available in this copy of the
            site; load the structure as a CIF file below.
          </p>
        )}

        <div role="status">
          {searching && <p class="field-hint">Searching COD…</p>}
          {!searching && result && !result.ok && <p class="message is-warning">{result.error}</p>}
          {!searching && result?.ok && 'tooMany' in result && (
            <p class="message is-info">
              COD has {result.count.toLocaleString('en')} structures for this search, more than the{' '}
              {result.max} that can be listed. Choose “Only these elements”, add an element, or type
              a formula.
            </p>
          )}
          {!searching && result?.ok && 'results' in result && (
            <h4 class="phase-search-source">
              {result.count === 0
                ? 'COD has no structure for this search. Load a CIF file below if you have one.'
                : `Crystallography Open Database (${result.count})`}
            </h4>
          )}
        </div>

        {results.length > 0 && !searching && (
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
              {filtered.slice(0, shown).map((entry) => (
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
                  </div>
                  <div class="phase-result-action">{addButton(entry.id)}</div>
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <button type="button" class="btn btn-quiet" onClick={() => setShown(shown * 2)}>
                Show more ({filtered.length - shown} left)
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
