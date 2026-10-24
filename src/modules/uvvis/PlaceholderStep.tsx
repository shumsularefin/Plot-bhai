/** A step that is wired into the wizard but built in a later sub-stage. */
export function PlaceholderStep({ what }: { what: string }) {
  return (
    <p class="message">
      <strong>Coming soon:</strong> {what} This step is not built yet; you can carry on to the next
      one. Your cleaned spectra from step 2 are kept.
    </p>
  );
}
