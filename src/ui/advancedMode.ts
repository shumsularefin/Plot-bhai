import { useEffect, useState } from 'preact/hooks';

/*
 * One browser-wide choice: show the advanced options of every tool, or keep the screens simple.
 * Simple is the default, so a new user sees only what every analysis needs. The settings inside
 * advanced sections still apply when they are hidden; only what is shown changes.
 */

const KEY = 'advanced-options-shown';
const listeners = new Set<(shown: boolean) => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let shown = read();

/** Marks the page so CSS can leave out long explanations in simple mode. */
function mark() {
  if (typeof document !== 'undefined')
    document.documentElement.classList.toggle('is-simple', !shown);
}
mark();

export function setAdvancedShown(next: boolean) {
  shown = next;
  try {
    if (next) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
  mark();
  for (const listener of listeners) listener(next);
}

/** Whether advanced options are shown; re-renders when the choice changes anywhere. */
export function useAdvancedShown(): boolean {
  const [value, setValue] = useState(shown);
  useEffect(() => {
    listeners.add(setValue);
    setValue(shown);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
