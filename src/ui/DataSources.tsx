import type { ComponentChildren } from 'preact';

/**
 * The two ways to load data, side by side: a data file (the children, usually a FileDrop) and a
 * picture of a graph, which opens the tool's graph-image reader at `imageHref`.
 */
export function DataSources({
  imageHref,
  children,
}: {
  imageHref: string;
  children: ComponentChildren;
}) {
  return (
    <div class="data-sources">
      <section class="data-source" aria-labelledby="source-file">
        <h3 id="source-file" class="data-source-title">
          From a data file
        </h3>
        {children}
      </section>
      <section class="data-source" aria-labelledby="source-image">
        <h3 id="source-image" class="data-source-title">
          From a graph image
        </h3>
        <div class="drop-zone data-source-image">
          <p class="drop-zone-title">Only have a figure?</p>
          <p class="field-hint">
            Load a screenshot or picture of a graph, for example from a paper, and trace its curve.
            The values are approximate and stay marked as such.
          </p>
          <a class="btn btn-primary" href={imageHref}>
            Use a graph image
          </a>
        </div>
      </section>
    </div>
  );
}

/** One line under the compact "Add more files" bar, for adding a curve from a graph image. */
export function ImageSourceLink({ href }: { href: string }) {
  return (
    <p class="field-hint image-source-link">
      Or <a href={href}>add a curve from a graph image</a>.
    </p>
  );
}
