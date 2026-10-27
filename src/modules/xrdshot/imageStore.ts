import { idbDelete, idbGet, idbSet } from '../../ui/persist/idb';

/** The screenshot file is kept in IndexedDB beside the saved state, so state writes stay small. */
const KEY = 'xrd-screenshot-image';

interface Stored {
  id: string;
  blob: Blob;
}

export async function saveShot(id: string, blob: Blob): Promise<void> {
  await idbSet(KEY, { id, blob } satisfies Stored);
}

/** The stored file for this image id, or undefined when none (or another image) is stored. */
export async function loadShot(id: string): Promise<Blob | undefined> {
  const stored = await idbGet<Stored>(KEY);
  return stored?.id === id ? stored.blob : undefined;
}

export async function removeShot(): Promise<void> {
  await idbDelete(KEY);
}
