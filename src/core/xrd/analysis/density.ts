/** Avogadro constant N_A, mol⁻¹. Exact by definition since the 2019 revision of the SI. */
export const AVOGADRO = 6.02214076e23;

/** Cubic centimetres in one cubic ångström (1 Å = 10⁻⁸ cm). */
const CM3_PER_A3 = 1e-24;

/**
 * Crystallographic (X-ray) density
 *   ρ = Z M / (N_A V) = M_cell / (N_A V),
 * with M_cell = Z M the mass of the unit cell contents (g/mol, the sum of the atomic weights of
 * all atoms in one cell), N_A the Avogadro constant (mol⁻¹) and V the cell volume, given in Å³
 * and converted to cm³. Returns g/cm³, or NaN when the mass or volume is not positive.
 * It is the density of a perfect crystal: pores, defects and other phases make the measured
 * (bulk or pycnometric) density lower.
 */
export function xrayDensity(cellMassGmol: number, volumeA3: number): number {
  if (!(cellMassGmol > 0) || !(volumeA3 > 0)) return NaN;
  return cellMassGmol / (AVOGADRO * volumeA3 * CM3_PER_A3);
}
