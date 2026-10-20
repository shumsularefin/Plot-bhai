import { useEffect, useState } from 'preact/hooks';
import { idbDelete, idbGet, idbSet } from './idb';

/** Shape written to IndexedDB. The version lets a later stage discard incompatible data. */
interface Envelope<T> {
  version: number;
  value: T;
}

export type StoreStatus = 'loading' | 'ready' | 'unavailable';

export interface PersistedStore<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  /** Replaces the state with the initial value and removes the saved copy. */
  reset(): void;
  subscribe(listener: () => void): () => void;
  status(): StoreStatus;
  /** Resolves once the saved state (if any) has been read. */
  ready: Promise<void>;
  /** Writes any pending change immediately. */
  flush(): Promise<void>;
}

export interface PersistedStoreOptions<T> {
  key: string;
  version: number;
  initial: T;
  /** Delay before writing after a change, so fast typing causes one write. */
  debounceMs?: number;
}

/**
 * In-memory state that is mirrored to IndexedDB, so a page refresh does not lose work.
 * If IndexedDB is unavailable the store keeps working in memory and reports "unavailable".
 */
export function createPersistedStore<T>(options: PersistedStoreOptions<T>): PersistedStore<T> {
  const { key, version, initial, debounceMs = 250 } = options;
  let state = initial;
  let status: StoreStatus = 'loading';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingWrite = false;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());

  const write = async () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pendingWrite || status === 'unavailable') return;
    pendingWrite = false;
    try {
      await idbSet(key, { version, value: state } satisfies Envelope<T>);
    } catch {
      status = 'unavailable';
      notify();
    }
  };

  const ready = idbGet<Envelope<T>>(key)
    .then((saved) => {
      // A change made while loading wins over the saved copy.
      if (saved?.version === version && !pendingWrite) state = saved.value;
      status = 'ready';
    })
    .catch(() => {
      status = 'unavailable';
    })
    .then(() => {
      notify();
      if (pendingWrite) void write();
    });

  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (previous: T) => T)(state) : next;
      pendingWrite = true;
      notify();
      if (status === 'loading') return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void write(), debounceMs);
    },
    reset() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingWrite = false;
      state = initial;
      notify();
      if (status !== 'unavailable') idbDelete(key).catch(() => undefined);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: () => status,
    ready,
    flush: write,
  };
}

/** Subscribes a component to a store. Also flushes pending writes when the page is hidden. */
export function useStore<T>(store: PersistedStore<T>): { state: T; status: StoreStatus } {
  const [, rerender] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => rerender((n) => n + 1));
    const onHide = () => void store.flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    // The store may have changed between first render and subscribing.
    rerender((n) => n + 1);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [store]);
  return { state: store.get(), status: store.status() };
}
