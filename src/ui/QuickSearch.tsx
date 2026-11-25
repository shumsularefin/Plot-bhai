import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { searchItems } from './catalog';

/**
 * Search the tools, the methods they offer and the documentation. A combobox: arrow keys move
 * through the results, Enter opens the highlighted one, Escape clears, "/" anywhere focuses it.
 */
export function QuickSearch() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = searchItems(query).slice(0, 8);
  const shown = open && query.trim() !== '';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (href: string) => {
    setQuery('');
    setOpen(false);
    input.current?.blur();
    window.location.hash = href.slice(1);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      const hit = results[active] ?? results[0];
      if (hit) {
        event.preventDefault();
        go(hit.href);
      }
    } else if (event.key === 'Escape') {
      setQuery('');
      setOpen(false);
    }
  };

  return (
    <div class="quick-search" role="search">
      <label class="visually-hidden" for={`${listId}-input`}>
        Search tools, methods and documentation
      </label>
      <svg class="quick-search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M13 13l4.5 4.5" />
      </svg>
      <input
        ref={input}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        list={undefined}
        autocomplete="off"
        spellcheck={false}
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Search tools, methods or documentation…"
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <kbd class="quick-search-key" aria-hidden="true">
        /
      </kbd>
      {shown && (
        <ul class="quick-search-results" id={listId} role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <li class="quick-search-empty" role="option" aria-selected={false} aria-disabled="true">
              Nothing matches “{query.trim()}”.
            </li>
          ) : (
            results.map((item, i) => (
              <li
                key={item.href}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                class={i === active ? 'is-active' : undefined}
                // mousedown, not click: the input's blur would close the list before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(item.href);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span class="quick-search-title">{item.title}</span>
                <span class="quick-search-detail">{item.detail}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
