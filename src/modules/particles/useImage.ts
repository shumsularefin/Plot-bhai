import { useEffect, useState } from 'preact/hooks';
import type { ImageInfo } from './data';
import { decodeImage, type DecodedImage } from './decode';
import { loadStoredImage } from './imageStore';

type State =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; image: DecodedImage }
  | { status: 'error'; error: string };

/** The decoded copy of the current image. Only the latest one is kept. */
let cache: { id: string; image: DecodedImage } | undefined;

/** Puts a freshly decoded image in the cache, so the first screen after loading needs no second decode. */
export function cacheImage(id: string, image: DecodedImage): void {
  if (cache?.image.source instanceof ImageBitmap) cache.image.source.close();
  cache = { id, image };
}

export function clearImageCache(): void {
  cache = undefined;
}

/** Loads the image of the saved state: from the cache, or from the file stored in IndexedDB. */
export function useImage(info: ImageInfo | null): State {
  const [state, setState] = useState<State>(() =>
    info && cache?.id === info.id
      ? { status: 'ready', image: cache.image }
      : { status: info ? 'loading' : 'none' },
  );
  const id = info?.id;
  useEffect(() => {
    if (!info) {
      setState({ status: 'none' });
      return;
    }
    if (cache?.id === info.id) {
      setState({ status: 'ready', image: cache.image });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void (async () => {
      const blob = await loadStoredImage(info.id);
      if (!blob) {
        if (active) {
          setState({
            status: 'error',
            error: 'The image file is no longer stored in this browser. Load it again in step 1.',
          });
        }
        return;
      }
      const result = await decodeImage(info.name, new Uint8Array(await blob.arrayBuffer()), blob);
      if (!active) return;
      if (!result.ok) {
        setState({ status: 'error', error: result.error });
        return;
      }
      cacheImage(info.id, result.image);
      setState({ status: 'ready', image: result.image });
    })();
    return () => {
      active = false;
    };
    // The image is identified by its id; the rest of the info does not change the file.
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
