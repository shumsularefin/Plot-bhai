/*
 * Optical constants from a UV-Vis spectrum. Wavelengths in nm, α in cm⁻¹, energies in eV,
 * transmittance T and reflectance R as fractions (0 to 1).
 */

import { LIGHT_M_PER_S, VACUUM_PERMITTIVITY_F_PER_M } from './conversions';

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

/**
 * Optical conductivity (real part) from the absorption coefficient and the refractive index:
 *
 *   σ = ε₀ · c · n · α
 *
 * σ in S/m (Ω⁻¹ m⁻¹), ε₀ the vacuum permittivity (F/m), c the speed of light (m/s), n the real
 * refractive index (unitless) and α the absorption coefficient, given here in cm⁻¹ and converted
 * to m⁻¹ (× 100). Derived from M. Fox, Optical Properties of Solids (Oxford University Press),
 * chapter 7: eq. 7.15 (p. 183), ε_r(ω) = 1 + iσ(ω)/(ε₀ω), so Re σ = ε₀ ω ε₂; p. 194, κ = ε₂/(2n);
 * eq. 7.18 (p. 184, via eq. 1.19), α = 2ωκ/c. Eliminating ε₂ and κ gives σ = ε₀ c n α, and the
 * same chain gives κ = αλ/(4π) (extinctionCoefficient above), which the tests use as a check.
 * An estimate: n is assumed, not measured, unless it comes from a thin-film fit. Returns NaN for
 * n ≤ 0 or a non-finite α.
 */
export function opticalConductivity(alphaPerCm: number, n: number): number {
  if (!(n > 0) || !Number.isFinite(alphaPerCm)) return NaN;
  return VACUUM_PERMITTIVITY_F_PER_M * LIGHT_M_PER_S * n * alphaPerCm * 100;
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
 * Relations checked against the original papers (supplied by the owner, read 2026-11-15):
 *
 * - Moss: T. S. Moss, Proc. Phys. Soc. B 63 (1950) 167–176, abstract and §4 (p. 168): n⁴/λ ≈ 77,
 *   λ the long-wavelength photoconductive threshold in µm, "for the more highly refractive
 *   compounds"; the relation "becomes progressively worse as n decreases" (below about 2.25) and
 *   does not apply to elements. With E = hc/λ (hc = 1.23984 eV·µm) this is n⁴·E ≈ 95.5 eV; the
 *   rounded K = 95 eV is the form of Hervé and Vandamme 1994, eq. 1, kept here (0.12 % in n).
 * - Ravindra: N. M. Ravindra, S. Auluck and V. K. Srivastava, Phys. Status Solidi B 93 (1979)
 *   K155–K160, eq. 5 (p. K157): n = 4.084 − 0.62·E_G, stated as valid for a wide range of
 *   semiconductors independent of structure. Moss (as cited by Hervé and Vandamme 1994, p. 609)
 *   restricts it to gaps below about 4 eV, with unrealistic results at low and high Eg.
 * - Hervé–Vandamme: P. J. L. Hervé and L. K. J. Vandamme, Infrared Phys. Technol. 35 (1994)
 *   609–615, eq. 10 (p. 611): n² = 1 + [A/(Eg + B)]², A = 13.6 eV, B = 3.4 eV; n for visible light;
 *   it "cannot properly describe the behaviour of the IV-VI group" (PbS, PbSe, PbTe). Tripathy
 *   (Opt. Mater. 46 (2015) 240) prints B = 3.47 eV, which was used before 2026-11-15.
 *
 * The numeric warning ranges (0.17–3.68 eV for Moss, Eg < 1.4 eV for Hervé–Vandamme) are those of
 * Tripathy 2015; the originals state no numbers. Rough empirical estimates, not measurements.
 */
export const INDEX_RELATIONS: Record<IndexRelation, IndexRelationInfo> = {
  moss: {
    label: 'Moss',
    equation: 'n⁴ · Eg = 95 eV',
    source:
      'T. S. Moss, Proc. Phys. Soc. B 63 (1950) 167, p. 168 (n⁴/λ ≈ 77, λ in µm); K = 95 eV as in Hervé and Vandamme, Infrared Phys. Technol. 35 (1994) 609, eq. 1',
    validity:
      'for highly refractive compounds (worse as n falls below about 2.25); Tripathy (2015) gives 0.17 eV < Eg < 3.68 eV',
    range: [0.17, 3.68],
  },
  ravindra: {
    label: 'Ravindra',
    equation: 'n = 4.084 − 0.62 · Eg',
    source:
      'N. M. Ravindra, S. Auluck and V. K. Srivastava, Phys. Status Solidi B 93 (1979) K155, eq. 5',
    validity:
      'restricted to Eg below about 4 eV, unrealistic at low and high Eg (Moss, as cited by Hervé and Vandamme 1994); n < 0 above 6.587 eV',
    range: [0, 6.587],
  },
  'herve-vandamme': {
    label: 'Hervé–Vandamme',
    equation: 'n² = 1 + (A / (Eg + B))², A = 13.6 eV, B = 3.4 eV',
    source: 'P. J. L. Hervé and L. K. J. Vandamme, Infrared Phys. Technol. 35 (1994) 609, eq. 10',
    validity:
      'not for IV-VI compounds (PbS, PbSe, PbTe); Tripathy (2015) gives a failure below Eg = 1.4 eV',
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
      return Math.sqrt(1 + (13.6 / (egEv + 3.4)) ** 2);
  }
}

/** True when Eg lies in the range where the relation is stated to hold. */
export function inIndexRange(relation: IndexRelation, egEv: number): boolean {
  const [lo, hi] = INDEX_RELATIONS[relation].range;
  return egEv > lo && egEv < hi;
}
