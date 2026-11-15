/** One peak of one sample, as input to the comparison across samples. */
export interface SamplePeak {
  sample: string;
  /** Position, cm⁻¹. */
  wavenumber: number;
}

/** One band of the comparison: at most one peak per sample. */
export interface BandGroup<P extends SamplePeak> {
  /** Mean position of the peaks in the band, cm⁻¹. */
  wavenumber: number;
  /** The peak of each sample in the band, by sample. */
  peaks: Map<string, P>;
}

/**
 * Default tolerance for grouping peaks of different samples into one band, cm⁻¹. My own choice:
 * 2.5 times the 4 cm⁻¹ resolution most mid-IR spectra are measured at, wide enough for the few
 * cm⁻¹ shifts that doping, hydration or particle size cause and narrow enough to keep separate
 * bands 10 cm⁻¹ or more apart (for example the CH₂ and CH₃ stretches). Adjustable on screen.
 */
export const DEFAULT_GROUP_TOLERANCE_CM = 10;

/**
 * Groups the peaks of several samples into bands. All peaks are sorted by wavenumber (ties by
 * sample name, so the input order never matters) and taken from low to high wavenumber; a peak
 * joins the current band when it lies within `toleranceCm` of the band's lowest peak and its
 * sample has no peak in the band yet, and otherwise starts a new band. Every band therefore spans
 * at most the tolerance and holds at most one peak per sample. The result depends only on the set
 * of peaks, not on the order of the samples (tests/ftir-compare.test.ts). Bands are returned in
 * order of increasing wavenumber.
 */
export function groupBands<P extends SamplePeak>(
  peaks: readonly P[],
  toleranceCm: number,
): BandGroup<P>[] {
  const sorted = [...peaks].sort(
    (a, b) =>
      a.wavenumber - b.wavenumber || (a.sample < b.sample ? -1 : a.sample > b.sample ? 1 : 0),
  );
  const groups: { first: number; peaks: Map<string, P> }[] = [];
  for (const peak of sorted) {
    const current = groups[groups.length - 1];
    if (
      current &&
      peak.wavenumber - current.first <= toleranceCm &&
      !current.peaks.has(peak.sample)
    ) {
      current.peaks.set(peak.sample, peak);
    } else {
      groups.push({ first: peak.wavenumber, peaks: new Map([[peak.sample, peak]]) });
    }
  }
  return groups.map((g) => {
    let sum = 0;
    for (const p of g.peaks.values()) sum += p.wavenumber;
    return { wavenumber: sum / g.peaks.size, peaks: g.peaks };
  });
}

/** Shift of a sample's peak from the reference sample's peak in the same band, cm⁻¹; null when either is absent. */
export function bandShift<P extends SamplePeak>(
  band: BandGroup<P>,
  sample: string,
  reference: string,
): number | null {
  const p = band.peaks.get(sample);
  const r = band.peaks.get(reference);
  return p && r ? p.wavenumber - r.wavenumber : null;
}
