/*
 * X-ray tube anodes and their K-alpha wavelengths in ångström (Å).
 *
 * Sources:
 * - "Hölzer 1997": G. Hölzer, M. Fritsch, M. Deutsch, J. Härtwig and E. Förster,
 *   Phys. Rev. A 56 (1997) 4554–4568, Table IV, column "λ (nm) (this work)", converted to Å
 *   (× 10). Checked against the paper. It covers the 3d metals only (Cr, Fe, Co, Cu).
 * - TODO(verify), Mo and Ag: Mo Kα1 (0.70931713 Å) is International Tables for
 *   Crystallography Vol. C, 2nd ed., p. 203, as quoted in the xrayutilities source
 *   (lib/xrayutilities/utilities_noconf.py); Mo Kα2 and both Ag lines are from pymatgen's
 *   WAVELENGTHS table (src/pymatgen/analysis/diffraction/xrd.py), which gives no source.
 *   The file supplied as "Table 4.2.2.1" was Vol. F (membrane-protein detergents), not the
 *   Vol. C wavelength table, so these three values are still unchecked.
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
  Mo: {
    kAlpha1: 0.70931713,
    kAlpha2: 0.71359,
    source: 'Kα1: ITC via xrayutilities; Kα2: pymatgen (unverified)',
  },
  Ag: { kAlpha1: 0.559421, kAlpha2: 0.563813, source: 'pymatgen (unverified)' },
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
