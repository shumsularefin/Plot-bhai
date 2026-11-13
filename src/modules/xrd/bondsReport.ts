import { BOND_TOLERANCE } from '../../core/xrd/structure/geometry';
import type { BondSettings, RietveldState } from './data';

export const DEFAULT_BONDS: BondSettings = { tolerance: BOND_TOLERANCE, states: {} };

/**
 * Methods sentences for the bond table and bond-valence sums, when the last refinement gave a
 * structure (a phase refined with its atoms rather than in Le Bail mode).
 */
export function bondsMethodsFor(rietveld: RietveldState | undefined): string {
  const outcome = rietveld?.result?.outcome;
  if (!outcome?.ok || !outcome.phases.some((p) => p.geometry)) return '';
  const tolerance = (rietveld?.bonds ?? DEFAULT_BONDS).tolerance;
  return (
    `Interatomic distances and angles were calculated from the refined structure for atom pairs closer than the sum of their covalent radii (Cordero et al., 2008) plus ${tolerance} Å, with standard uncertainties propagated from the covariance of the refined cell parameters and atom coordinates. ` +
    'Bond-valence sums were calculated as V = Σ exp((R₀ − R)/b) (Brown & Altermatt, 1985) with the parameters of the accumulated table bvparm2020 (I. D. Brown, IUCr, 2020) and the oxidation states given in the bond-valence table, each pair of ions taking the first-listed parameters of the table.'
  );
}
