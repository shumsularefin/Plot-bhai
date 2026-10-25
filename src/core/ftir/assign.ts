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

/**
 * Ranked suggestions for a peak at `wavenumber` (cm⁻¹), best first, at most `limit`.
 * A functional group matches when the peak is inside one of its typical ranges, or within
 * `tolerance` cm⁻¹ of one. A metal oxide matches when the peak is within `tolerance` of one of
 * its listed bands. Closer matches rank first; for equal distance a narrower range ranks first
 * because it is more specific. These are estimates: many groups overlap, and a peak position
 * alone cannot prove which group is present.
 */
export function suggestAssignments(
  wavenumber: number,
  table: Pick<GroupTable, 'functionalGroups' | 'metalOxides'>,
  tolerance: number = DEFAULT_TOLERANCE_CM,
  limit = 6,
  atmosphere?: Pick<AtmosphereTable, 'bands'>,
): Suggestion[] {
  const out: (Suggestion & { width: number })[] = [];
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
    out.push({
      id: group.id,
      label: group.label,
      kind: 'group',
      distance: best.distance,
      width: best.width,
      reason:
        best.distance === 0
          ? `${cm(wavenumber)} is inside the typical range ${printed}.`
          : `${cm(wavenumber)} is ${cm(best.distance)} outside the typical ${best.from === best.to ? 'value' : 'range'} ${printed}.`,
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
      reason: `${cm(wavenumber)} is ${distance === 0 ? 'at' : `${cm(distance)} from`} the gas-phase band at ${cm(band.cm)}: air in the beam path that the background did not cancel. Compare with a fresh background spectrum before assigning it to the sample.`,
    });
  }
  out.sort((a, b) => a.distance - b.distance || a.width - b.width);
  return out.slice(0, limit).map(({ width: _width, ...suggestion }) => {
    void _width;
    return suggestion;
  });
}
