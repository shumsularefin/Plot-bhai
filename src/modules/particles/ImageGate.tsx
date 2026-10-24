import type { ComponentChildren } from 'preact';
import type { DecodedImage } from './decode';
import type { ParticleData } from './data';
import { useImage } from './useImage';

/** Shows what is needed before a step can use the image: a loading note, a problem, or the step itself. */
export function ImageGate({
  data,
  children,
}: {
  data: ParticleData;
  children: (image: DecodedImage) => ComponentChildren;
}) {
  const state = useImage(data.image);
  if (state.status === 'none') return <p>No image is loaded. Go back to step 1 to add one.</p>;
  if (state.status === 'loading') return <p class="loading">Opening the image…</p>;
  if (state.status === 'error') {
    return (
      <p class="message is-error" role="alert">
        <strong>Problem:</strong> {state.error}
      </p>
    );
  }
  return <>{children(state.image)}</>;
}
