import groups from '../../../data/ftir/groups.json';

/** A named spectral region of the combined figure, cm⁻¹. */
export interface SpectralRegion {
  label: string;
  /** Longer name for the key and help text. */
  name: string;
  fromCm: number;
  toCm: number;
}

/**
 * The regions are not typed in from memory: each is the envelope (lowest "from" to highest "to")
 * of rows of the group table data/ftir/groups.json (Pasieczna-Patkowska et al., Molecules 30
 * (2025) 684, Tables 3 and 2), so they follow that table and change with it. Which rows make up
 * which region is my own grouping by the kind of vibration each row names.
 */
const DEFINITIONS: { label: string; name: string; rows: string[] | 'metal-oxides' }[] = [
  { label: 'O–H, N–H str.', name: 'O–H and N–H stretching', rows: range(1, 8) },
  { label: 'C–H str.', name: 'C–H stretching', rows: range(9, 14) },
  { label: 'X≡Y, X=C=Y', name: 'triple and cumulated double bond stretching', rows: range(15, 17) },
  {
    label: 'C=O, C=C str.',
    name: 'double bond (C=O, C=C) stretching',
    rows: [...range(18, 25), 'fg-28', 'fg-29'],
  },
  {
    label: 'Fingerprint',
    name: 'bending and single-bond stretching (fingerprint)',
    rows: range(32, 65),
  },
  { label: 'M–O', name: 'metal–oxygen (metal oxide bands below 900 cm⁻¹)', rows: 'metal-oxides' },
];

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `fg-${from + i}`);
}

/** Highest metal oxide band counted as a metal–oxygen vibration, cm⁻¹ (the others are anion bands, per the table's footnote, or lie above it). */
const METAL_OXYGEN_MAX_CM = 900;

/** The regions, from the group table. */
export function spectralRegions(): SpectralRegion[] {
  return DEFINITIONS.map((d) => {
    let lo = Infinity;
    let hi = -Infinity;
    if (d.rows === 'metal-oxides') {
      for (const oxide of groups.metalOxides.filter((m) => m.source === 'pasieczna-2025'))
        for (const band of oxide.bands)
          if (band.cm <= METAL_OXYGEN_MAX_CM) {
            lo = Math.min(lo, band.cm);
            hi = Math.max(hi, band.cm);
          }
    } else {
      const ids = d.rows;
      for (const row of groups.functionalGroups) {
        if (row.source !== 'pasieczna-2025') continue;
        // Row ids start with "fg-<number>-"; match the number exactly.
        if (!ids.some((id) => row.id.startsWith(`${id}-`))) continue;
        for (const r of row.ranges) {
          lo = Math.min(lo, r.from);
          hi = Math.max(hi, r.to);
        }
      }
    }
    return { label: d.label, name: d.name, fromCm: lo, toCm: hi };
  });
}

const molecules = groups.sources['pasieczna-2025'];
export const REGION_SOURCE = `${molecules.citation}, doi:${molecules.doi}`;
