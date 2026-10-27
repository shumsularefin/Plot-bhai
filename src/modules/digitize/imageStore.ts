import { idbDelete, idbGet, idbSet } from '../../ui/persist/idb';

/*
 * The image file is kept in IndexedDB beside the saved state, so state writes stay small. Each
 * tool's reader has its own key, so their images do not replace each other.
 */

interface Stored {
  id: string;
  blob: Blob;
}

export async function saveShot(key: string, id: string, blob: Blob): Promise<void> {
  await idbSet(key, { id, blob } satisfies Stored);
}

/** The stored file for this image id, or undefined when none (or another image) is stored. */
export async function loadShot(key: string, id: string): Promise<Blob | undefined> {
  const stored = await idbGet<Stored>(key);
  return stored?.id === id ? stored.blob : undefined;
}

export async function removeShot(key: string): Promise<void> {
  await idbDelete(key);
}
