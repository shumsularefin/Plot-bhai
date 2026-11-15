/*
 * Optical constants from a UV-Vis spectrum. Wavelengths in nm, α in cm⁻¹, energies in eV,
 * transmittance T and reflectance R as fractions (0 to 1).
 */

/**
 * Absorption coefficient of a film from its transmittance T and reflectance R, with incoherent
 * multiple reflections inside the film (A. R. Zanatta, Sci. Rep. 9 (2019) 11225, Eq. 6, "if
 * multiple internal reflections are considered (i.e., αd is small)", read 2026-11-14):
 *   α = (1/d) · ln[ (1 − R)²/(2T) + √( (1 − R)⁴/(4T²) + R² ) ],
 * d the thickness in cm. It is the solution for x = exp(−αd) of the slab transmittance
 * T = (1 − R)²·x / (1 − R²·x²), the sum of the beams reflected back and forth inside a uniform,
 * polished slab with the same reflectance R at both faces. When αd is large, R²x² ≪ 1 and it becomes
 * Zanatta's Eq. 5, α = (1/d) ln[(1 − R)²/T]; with R = 0, the Beer–Lambert α = (1/d) ln(1/T).
 * The same equation is Eq. 27 of A. Kasikov and L. Aarik, "Calculating the absorption edge of thin
 * films", Bulg. J. Phys. 51 (2024) 311–338, doi:10.55318/bgjp.2024.51.4.311 (read 2026-11-14), for
 * "a slab of absorbing material" where "the effect of the substrate is neglected"; they find that
 * such approximations differ markedly for films thinner than about 1 µm. A substrate is not modelled
 * here: R and T are taken as measured. NaN where T ≤ 0, R < 0, R ≥ 1 or d ≤ 0.
 */
export function alphaWithReflection(t: number, r: number, thicknessCm: number): number {
  if (!(t > 0) || !(r >= 0) || !(r < 1) || !(thicknessCm > 0)) return NaN;
  const a = (1 - r) ** 2 / (2 * t);
  return Math.log(a + Math.sqrt(a * a + r * r)) / thicknessCm;
}

/** The slab transmittance of `alphaWithReflection`: T = (1 − R)² x / (1 − R² x²), x = exp(−αd). */
export function slabTransmittance(alphaPerCm: number, r: number, thicknessCm: number): number {
  const x = Math.exp(-alphaPerCm * thicknessCm);
  return ((1 - r) ** 2 * x) / (1 - r * r * x * x);
}

/**
 * Extinction coefficient k = α·λ / (4π), unitless, from the absorption coefficient α (cm⁻¹) and
 * the wavelength λ (nm, converted to cm), from α = 4πk/λ (Kasikov and Aarik 2024, Eq. 1, cited
 * above). Needs α in absolute units, so a film thickness or a path length.
 */
export function extinctionCoefficient(alphaPerCm: number, wavelengthNm: number): number {
  return (alphaPerCm * wavelengthNm * 1e-7) / (4 * Math.PI);
}

/** Empirical relations between the refractive index n and the band gap Eg. */
export type IndexRelation = 'moss' | 'ravindra' | 'herve-vandamme';

export interface IndexRelationInfo {
  label: string;
  equation: string;
  source: string;
  /** Range of Eg (eV) where the relation is stated to hold, or the limit beyond which it fails. */
  validity: string;
  /** Eg range (eV) used for the on-screen warning. */
  range: [number, number];
}

/**
 * Relations as written in S. K. Tripathy, "Refractive indices of semiconductors from energy gaps",
 * Opt. Mater. 46 (2015) 240–246 (arXiv:1508.03511, HTML version read 2026-11-14), Eqs. 1–3, with
 * the ranges that paper states. The original papers (Moss 1950; Ravindra, Auluck and Srivastava
 * 1979; Hervé and Vandamme 1994) were not opened. Rough empirical estimates for semiconductors at
 * long wavelength, flagged for your verification; B = 3.47 eV is the value printed by Tripathy.
 */
export const INDEX_RELATIONS: Record<IndexRelation, IndexRelationInfo> = {
  moss: {
    label: 'Moss',
    equation: 'n⁴ · Eg = 95 eV',
    source: 'T. S. Moss (1950), as given by Tripathy, Opt. Mater. 46 (2015) 240, Eq. 1',
    validity: 'stated as reliable for 0.17 eV < Eg < 3.68 eV',
    range: [0.17, 3.68],
  },
  ravindra: {
    label: 'Ravindra',
    equation: 'n = 4.084 − 0.62 · Eg',
    source:
      'N. M. Ravindra, S. Auluck and V. K. Srivastava (1979), as given by Tripathy, Opt. Mater. 46 (2015) 240, Eq. 2',
    validity: 'fails at very low and very high Eg, and gives n < 0 above 6.587 eV',
    range: [0, 6.587],
  },
  'herve-vandamme': {
    label: 'Hervé–Vandamme',
    equation: 'n² = 1 + (A / (Eg + B))², A = 13.6 eV, B = 3.47 eV',
    source:
      'P. J. L. Hervé and L. K. J. Vandamme (1994), as given by Tripathy, Opt. Mater. 46 (2015) 240, Eq. 3',
    validity: 'fails for Eg < 1.4 eV',
    range: [1.4, Infinity],
  },
};

/** Refractive index n from Eg (eV) by one relation; NaN where it gives no real positive value. */
export function indexFromGap(relation: IndexRelation, egEv: number): number {
  if (!(egEv > 0)) return NaN;
  switch (relation) {
    case 'moss':
      return (95 / egEv) ** 0.25;
    case 'ravindra': {
      const n = 4.084 - 0.62 * egEv;
      return n > 0 ? n : NaN;
    }
    case 'herve-vandamme':
      return Math.sqrt(1 + (13.6 / (egEv + 3.47)) ** 2);
  }
}

/** True when Eg lies in the range where the relation is stated to hold. */
export function inIndexRange(relation: IndexRelation, egEv: number): boolean {
  const [lo, hi] = INDEX_RELATIONS[relation].range;
  return egEv > lo && egEv < hi;
}
