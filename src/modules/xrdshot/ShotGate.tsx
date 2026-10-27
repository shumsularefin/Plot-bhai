import type { ComponentChildren } from 'preact';
import type { ShotData } from './data';
import { useShotImage, type ShotImage } from './prepare';

/** Renders its children with the working image once it is ready, or says why it is not. */
export function ShotGate({
  data,
  children,
}: {
  data: ShotData;
  children: (image: ShotImage) => ComponentChildren;
}) {
  const state = useShotImage(data.image, data.rotation);
  if (state.status === 'none') return <p>No image is loaded. Go back to step 1 to add one.</p>;
  if (state.status === 'loading') return <p class="loading">Opening the image…</p>;
  if (state.status === 'error')
    return (
      <p class="message is-error" role="alert">
        <strong>Problem:</strong> {state.error}
      </p>
    );
  return <>{children(state.image)}</>;
}
