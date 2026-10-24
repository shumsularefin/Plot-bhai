/*
 * X-ray tube anodes and their K-alpha wavelengths in ångström (Å).
 *
 * Sources:
 * - "Hölzer 1997": G. Hölzer, M. Fritsch, M. Deutsch, J. Härtwig and E. Förster,
 *   Phys. Rev. A 56 (1997) 4554–4568, Table IV, column "λ (nm) (this work)", converted to Å
 *   (× 10). Checked against the paper. It covers the 3d metals only (Cr, Fe, Co, Cu).
 * - "NIST", Mo and Ag: R. D. Deslattes, E. G. Kessler Jr., P. Indelicato, L. de Billy, E. Lindroth
 *   and J. Anton, "X-ray transition energies: new approach to a comprehensive evaluation",
 *   Rev. Mod. Phys. 75 (2003) 35–99, as served by the NIST X-ray Transition Energies Database
 *   (physics.nist.gov/PhysRefData/XrayTrans), column "Direct Exp. Wavelength (Å)":
 *   Mo KL3 (Kα1) 0.709 317 15(41), Mo KL2 (Kα2) 0.713 607(12),
 *   Ag KL3 (Kα1) 0.559 421 78(76), Ag KL2 (Kα2) 0.563 813 1(26).
 *   The values below are these rounded to seven decimals.
 * - The Kα2/Kα1 intensity ratio of 0.5 is the default used by GSAS-II (GSASIIpwd.py,
 *   'I(L2)/I(L1)': 0.5). Real tubes differ slightly, so the ratio can be changed in the app.
 */

export type Anode = 'Cu' | 'Co' | 'Cr' | 'Fe' | 'Mo' | 'Ag';

export interface AnodeLines {
  /** Kα1 wavelength, Å. */
  kAlpha1: number;
  /** Kα2 wavelength, Å. */
  kAlpha2: number;
  /** Where the two wavelengths were taken from (see the file comment). */
  source: string;
}

export const ANODES: Record<Anode, AnodeLines> = {
  Cu: { kAlpha1: 1.5405929, kAlpha2: 1.5444274, source: 'Hölzer 1997' },
  Co: { kAlpha1: 1.788996, kAlpha2: 1.792835, source: 'Hölzer 1997' },
  Cr: { kAlpha1: 2.289726, kAlpha2: 2.293651, source: 'Hölzer 1997' },
  Fe: { kAlpha1: 1.936041, kAlpha2: 1.939973, source: 'Hölzer 1997' },
  Mo: { kAlpha1: 0.7093172, kAlpha2: 0.713607, source: 'NIST (Deslattes et al. 2003)' },
  Ag: { kAlpha1: 0.5594218, kAlpha2: 0.5638131, source: 'NIST (Deslattes et al. 2003)' },
};

export const DEFAULT_KALPHA2_RATIO = 0.5;

export interface RadiationSettings {
  anode: Anode;
  /** True when a monochromator removed Kα2, so the data contain Kα1 only. */
  kAlpha1Only: boolean;
  /** Intensity of Kα2 relative to Kα1 (dimensionless, 0 to 1). */
  kAlpha2Ratio: number;
}

export const DEFAULT_RADIATION: RadiationSettings = {
  anode: 'Cu',
  kAlpha1Only: false,
  kAlpha2Ratio: DEFAULT_KALPHA2_RATIO,
};
