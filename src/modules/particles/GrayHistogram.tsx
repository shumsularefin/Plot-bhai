interface GrayHistogramProps {
  /** Pixel counts of grey levels 0 to 255. */
  hist: Int32Array;
  /** Vertical lines at grey levels, for example the threshold or the display range. */
  markers?: readonly { level: number; label: string }[];
  /** Grey levels shaded as the part marked as particles (from `from` up to 255). */
  shadeFrom?: number | null;
  /** What the histogram shows, read by screen readers. */
  label: string;
}

/**
 * Histogram of grey levels, as in ImageJ's Threshold and Brightness/Contrast windows: bar height
 * on a square-root scale so that small groups of pixels stay visible, a black-to-white strip
 * underneath, and lines for the levels that matter. It is a guide on screen, not a figure.
 */
export function GrayHistogram({ hist, markers = [], shadeFrom = null, label }: GrayHistogramProps) {
  let top = 0;
  for (let v = 0; v < 256; v++) top = Math.max(top, Math.sqrt(hist[v] as number));
  let d = 'M0 100';
  for (let v = 0; v < 256; v++) {
    const h = top > 0 ? (Math.sqrt(hist[v] as number) / top) * 100 : 0;
    d += `V${(100 - h).toFixed(2)}H${v + 1}`;
  }
  d += 'V100Z';
  return (
    <figure class="gray-histogram">
      <svg viewBox="0 0 256 100" preserveAspectRatio="none" role="img" aria-label={label}>
        {shadeFrom !== null && (
          <rect
            x={shadeFrom + 1}
            y={0}
            width={Math.max(0, 255 - shadeFrom)}
            height={100}
            class="gray-histogram-shade"
          />
        )}
        <path d={d} class="gray-histogram-bars" />
        {markers.map((m) => (
          <line
            key={m.label}
            x1={m.level + 0.5}
            x2={m.level + 0.5}
            y1={0}
            y2={100}
            class="gray-histogram-marker"
            vector-effect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div class="gray-histogram-strip" aria-hidden="true" />
      <figcaption class="field-hint">
        Grey level 0 (black) to 255 (white); bar height on a square-root scale.
        {markers.length > 0 && ` Lines: ${markers.map((m) => `${m.label} ${m.level}`).join(', ')}.`}
        {shadeFrom !== null && ' Shaded: marked as particles.'}
      </figcaption>
    </figure>
  );
}
