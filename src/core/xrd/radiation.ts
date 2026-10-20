/*
 * X-ray tube anodes and their K-alpha wavelengths in ångström (Å).
 *
 * TODO(verify): these values were copied from the sources named in each entry because the
 * primary references (International Tables for Crystallography Vol. C, Table 4.2.2.1, and
 * Hölzer et al., Phys. Rev. A 56 (1997) 4554) could not be reached when this was written.
 * Please check every value against International Tables before relying on it.
 *
 * Sources:
 * - "ITC via xrayutilities": International Tables for Crystallography Vol. C, 2nd ed., p. 203,
 *   as quoted in the xrayutilities source (lib/xrayutilities/utilities_noconf.py).
 * - "pymatgen": the WAVELENGTHS table in pymatgen (src/pymatgen/analysis/diffraction/xrd.py).
 *   pymatgen does not state where its values come from.
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
  Cu: { kAlpha1: 1.54059292, kAlpha2: 1.544414, source: 'ITC via xrayutilities' },
  Co: { kAlpha1: 1.78896, kAlpha2: 1.79285, source: 'pymatgen' },
  Cr: { kAlpha1: 2.2897, kAlpha2: 2.29361, source: 'pymatgen' },
  Fe: { kAlpha1: 1.93604, kAlpha2: 1.93998, source: 'pymatgen' },
  Mo: {
    kAlpha1: 0.70931713,
    kAlpha2: 0.71359,
    source: 'Kα1: ITC via xrayutilities; Kα2: pymatgen',
  },
  Ag: { kAlpha1: 0.559421, kAlpha2: 0.563813, source: 'pymatgen' },
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
