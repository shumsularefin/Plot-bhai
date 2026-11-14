/** The functional group table of data/ftir/groups.json (see scripts/build-ftir-groups.ts). */
export interface GroupTable {
  source: { citation: string; doi: string; licence: string; url: string; retrieved: string };
  verification: string;
  functionalGroups: {
    id: string;
    label: string;
    ranges: { from: number; to: number }[];
    approximate?: boolean;
  }[];
  metalOxides: { id: string; label: string; bands: { cm: number; note?: string }[] }[];
}

/** Gas-phase bands of air in the beam path (data/ftir/atmosphere.json). */
export interface AtmosphereTable {
  source: { citation: string; url: string; retrieved: string };
  verification: string;
  bands: { id: string; label: string; cm: number }[];
}

export interface Suggestion {
  id: string;
  /** The band assignment or oxide as printed in the source. */
  label: string;
  kind: 'group' | 'oxide' | 'atmosphere';
  /** Distance from the typical range (0 inside it) or from the nearest listed band, cm⁻¹. */
  distance: number;
  /** The listed range or band the peak was matched to, as printed, for example "1715–1745 cm⁻¹". */
  listed: string;
  /** How far the peak lies from `listed`, cm⁻¹ (0 inside a range or exactly on a band). */
  offset: number;
  /** Plain-language reason, shown next to the suggestion. */
  reason: string;
}

/**
 * A peak this close to a single listed band position (cm⁻¹) ranks as if exactly on it, like a
 * peak inside a listed range: 4 cm⁻¹ is a common spectrometer resolution, so a listed value
 * cannot be met more closely than that. My own choice.
 */
const POINT_MATCH_CM = 4;

/** Default distance from a listed range or band, cm⁻¹; my own choice, adjustable on screen. */
export const DEFAULT_TOLERANCE_CM = 15;

const cm = (v: number) => `${Number(v.toFixed(0))} cm⁻¹`;

/** The table states that a row's band is broad: "(broad)" or ", broad" in its label. */
export const statesBroad = (label: string): boolean => /\bbroad\b/i.test(label);

/** What is known of the peak's shape (src/core/ftir/peakShape.ts), for ranking. */
export interface PeakCharacter {
  broad: boolean;
  /** Full width at half height, cm⁻¹. */
  fwhm: number;
}

/**
 * Ranked suggestions for a peak at `wavenumber` (cm⁻¹), best first, at most `limit`.
 * A functional group matches when the peak is inside one of its typical ranges, or within
 * `tolerance` cm⁻¹ of one. A metal oxide matches when the peak is within `tolerance` of one of
 * its listed bands. Closer matches rank first. For equal distance, when the peak's `character`
 * is known, a row whose label states "broad" ranks above the others if the peak is broad and
 * below them if it is not (rows that state nothing about width are not moved, because the table
 * does not say); then a narrower range ranks first because it is more specific. These are
 * estimates: many groups overlap, and a peak position alone cannot prove which group is present.
 */
export function suggestAssignments(
  wavenumber: number,
  table: Pick<GroupTable, 'functionalGroups' | 'metalOxides'>,
  tolerance: number = DEFAULT_TOLERANCE_CM,
  limit = 6,
  atmosphere?: Pick<AtmosphereTable, 'bands'>,
  character?: PeakCharacter | null,
): Suggestion[] {
  const out: (Suggestion & { width: number; fit: number })[] = [];
  for (const group of table.functionalGroups) {
    let best: { distance: number; width: number; from: number; to: number } | null = null;
    for (const r of group.ranges) {
      const distance =
        wavenumber < r.from ? r.from - wavenumber : wavenumber > r.to ? wavenumber - r.to : 0;
      if (best === null || distance < best.distance) {
        best = { distance, width: r.to - r.from, from: r.from, to: r.to };
      }
    }
    if (!best || best.distance > tolerance) continue;
    const printed =
      best.from === best.to
        ? `${group.approximate ? '~' : ''}${cm(best.from)}`
        : `${best.from}–${best.to} cm⁻¹`;
    const broadRow = character ? statesBroad(group.label) : false;
    const fits = broadRow && character ? character.broad : null;
    const width = character ? `${Number(character.fwhm.toPrecision(3))} cm⁻¹` : '';
    out.push({
      id: group.id,
      label: group.label,
      kind: 'group',
      distance: best.distance,
      width: best.width,
      fit: fits === null ? 0 : fits ? -1 : 1,
      listed: printed,
      offset: best.distance,
      reason:
        (best.distance === 0
          ? `${cm(wavenumber)} is inside the typical range ${printed}.`
          : `${cm(wavenumber)} is ${cm(best.distance)} outside the typical ${best.from === best.to ? 'value' : 'range'} ${printed}.`) +
        (fits === null
          ? ''
          : fits
            ? ` The table describes this band as broad, and this peak is broad (${width} wide at half height), so it ranks higher.`
            : ` The table describes this band as broad, but this peak is not (${width} wide at half height), so it ranks lower.`),
    });
  }
  for (const oxide of table.metalOxides) {
    let nearest: { cm: number; distance: number } | null = null;
    for (const band of oxide.bands) {
      const distance = Math.abs(wavenumber - band.cm);
      if (nearest === null || distance < nearest.distance) nearest = { cm: band.cm, distance };
    }
    if (!nearest || nearest.distance > tolerance) continue;
    out.push({
      id: oxide.id,
      label: `${oxide.label} (metal–oxygen and lattice bands)`,
      kind: 'oxide',
      distance: nearest.distance <= POINT_MATCH_CM ? 0 : nearest.distance,
      width: 0,
      fit: 0,
      listed: cm(nearest.cm),
      offset: nearest.distance,
      reason: `${cm(wavenumber)} is ${nearest.distance === 0 ? 'at' : `${cm(nearest.distance)} from`} a band listed for ${oxide.label} at ${cm(nearest.cm)}.`,
    });
  }
  for (const band of atmosphere?.bands ?? []) {
    const distance = Math.abs(wavenumber - band.cm);
    if (distance > tolerance) continue;
    out.push({
      id: band.id,
      label: `${band.label}, not from the sample`,
      kind: 'atmosphere',
      distance: distance <= POINT_MATCH_CM ? 0 : distance,
      width: 0,
      fit: 0,
      listed: cm(band.cm),
      offset: distance,
      reason: `${cm(wavenumber)} is ${distance === 0 ? 'at' : `${cm(distance)} from`} the gas-phase band at ${cm(band.cm)}: air in the beam path that the background did not cancel. Compare with a fresh background spectrum before assigning it to the sample.`,
    });
  }
  out.sort((a, b) => a.distance - b.distance || a.fit - b.fit || a.width - b.width);
  return out.slice(0, limit).map(({ width: _width, fit: _fit, ...suggestion }) => {
    void _width;
    void _fit;
    return suggestion;
  });
}
