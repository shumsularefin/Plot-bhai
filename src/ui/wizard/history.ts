/*
 * Undo and redo of a wizard's data. The data are immutable objects, so the history keeps
 * references to earlier versions, not copies. Changes that follow each other quickly (a slider
 * drag, typing in a box) become one undo step.
 */

export interface History<D> {
  /** Earlier versions, oldest first. */
  past: readonly D[];
  /** Versions undone, the next one to redo last. */
  future: readonly D[];
  /** Time of the last recorded change, ms. */
  lastAt: number;
}

/** Most versions kept. */
export const HISTORY_LIMIT = 100;

/** Changes closer together than this (ms) are one undo step. */
export const MERGE_MS = 600;

export const emptyHistory = <D>(): History<D> => ({ past: [], future: [], lastAt: -Infinity });

/** The history after the data changed from `previous`, at time `now` (ms). */
export function record<D>(history: History<D>, previous: D, now: number): History<D> {
  const merge = history.past.length > 0 && now - history.lastAt < MERGE_MS;
  return {
    past: merge ? history.past : [...history.past, previous].slice(-HISTORY_LIMIT),
    future: [],
    lastAt: now,
  };
}

/** One step back from `current`: the restored data and the new history, or null at the start. */
export function undo<D>(history: History<D>, current: D): { data: D; history: History<D> } | null {
  const data = history.past[history.past.length - 1];
  if (data === undefined) return null;
  return {
    data,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastAt: -Infinity,
    },
  };
}

/** One step forward again after an undo, or null when nothing was undone. */
export function redo<D>(history: History<D>, current: D): { data: D; history: History<D> } | null {
  const data = history.future[history.future.length - 1];
  if (data === undefined) return null;
  return {
    data,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      lastAt: -Infinity,
    },
  };
}

/** Undo or redo asked for by a key press, or null. Ctrl or Cmd + Z, Ctrl + Y, Ctrl/Cmd + Shift + Z. */
export function historyKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** Fields that have their own text undo, which the shortcut must leave alone. */
export function editsText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(
      target.type,
    );
  return false;
}
