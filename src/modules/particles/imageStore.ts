import { idbDelete, idbGet, idbSet } from '../../ui/persist/idb';

/** The image file is kept in IndexedDB beside the saved state, once, so state writes stay small. */
const KEY = 'particles-image';

interface Stored {
  id: string;
  blob: Blob;
}

export async function saveImage(id: string, blob: Blob): Promise<void> {
  await idbSet(KEY, { id, blob } satisfies Stored);
}

/** The stored file for this image id, or undefined when none is stored (or another image is). */
export async function loadStoredImage(id: string): Promise<Blob | undefined> {
  const stored = await idbGet<Stored>(KEY);
  return stored?.id === id ? stored.blob : undefined;
}

export async function removeImage(): Promise<void> {
  await idbDelete(KEY);
}
