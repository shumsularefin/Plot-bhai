import { describe, expect, it } from 'vitest';
import { createPersistedStore } from '../src/ui/persist/persistedStore';

describe('createPersistedStore', () => {
  it('starts from the initial value when nothing is saved', async () => {
    const store = createPersistedStore({ key: 'empty', version: 1, initial: { n: 0 } });
    expect(store.status()).toBe('loading');
    await store.ready;
    expect(store.status()).toBe('ready');
    expect(store.get()).toEqual({ n: 0 });
  });

  it('restores saved state in a new store with the same key (a page refresh)', async () => {
    const first = createPersistedStore({ key: 'refresh', version: 1, initial: { n: 0 } });
    await first.ready;
    first.set({ n: 1 });
    first.set((previous) => ({ n: previous.n + 1 }));
    await first.flush();

    const second = createPersistedStore({ key: 'refresh', version: 1, initial: { n: 0 } });
    await second.ready;
    expect(second.get()).toEqual({ n: 2 });
  });

  it('discards saved state written with a different version', async () => {
    const old = createPersistedStore({ key: 'versioned', version: 1, initial: { n: 0 } });
    await old.ready;
    old.set({ n: 5 });
    await old.flush();

    const upgraded = createPersistedStore({ key: 'versioned', version: 2, initial: { n: 0 } });
    await upgraded.ready;
    expect(upgraded.get()).toEqual({ n: 0 });
  });

  it('keeps a change made while loading instead of the saved copy', async () => {
    const first = createPersistedStore({ key: 'race', version: 1, initial: { n: 0 } });
    await first.ready;
    first.set({ n: 1 });
    await first.flush();

    const second = createPersistedStore({ key: 'race', version: 1, initial: { n: 0 } });
    second.set({ n: 9 });
    await second.ready;
    await second.flush();
    expect(second.get()).toEqual({ n: 9 });

    const third = createPersistedStore({ key: 'race', version: 1, initial: { n: 0 } });
    await third.ready;
    expect(third.get()).toEqual({ n: 9 });
  });

  it('reset returns to the initial value and removes the saved copy', async () => {
    const store = createPersistedStore({ key: 'reset', version: 1, initial: { n: 0 } });
    await store.ready;
    store.set({ n: 3 });
    await store.flush();
    store.reset();
    expect(store.get()).toEqual({ n: 0 });

    // idbDelete runs in the background; a later read must not see the old value.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const reloaded = createPersistedStore({ key: 'reset', version: 1, initial: { n: 0 } });
    await reloaded.ready;
    expect(reloaded.get()).toEqual({ n: 0 });
  });

  it('notifies subscribers on change', async () => {
    const store = createPersistedStore({ key: 'notify', version: 1, initial: 0 });
    await store.ready;
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.set(1);
    unsubscribe();
    store.set(2);
    expect(calls).toBe(1);
  });
});
