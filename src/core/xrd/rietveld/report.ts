/*
 * Text for Rietveld results: values with standard uncertainties in the crystallographic notation,
 * and the methods sentences written from the settings and the result.
 */

import type { RefineChoices, RietveldResult } from './refine';

/**
 * A value with its standard uncertainty in parentheses on the last digits, for example
 * 3.79586(3) for 3.795861 ± 0.000031. The uncertainty keeps two significant digits when its
 * first digit is 1, otherwise one (the "rule of 19" used by IUCr journals). A fixed parameter
 * (uncertainty 0) is written with `fixedDecimals` decimals; an unknown uncertainty (NaN) too,
 * followed by " (s.u. not available)".
 */
export function withUncertainty(value: number, esd: number, fixedDecimals = 5): string {
  if (!Number.isFinite(value)) return '–';
  if (esd === 0) return value.toFixed(fixedDecimals);
  if (!Number.isFinite(esd) || esd < 0)
    return `${value.toFixed(fixedDecimals)} (s.u. not available)`;
  // First significant digit of the uncertainty at 10^−decimals; a second digit when it rounds to 1.
  let decimals = -Math.floor(Math.log10(esd));
  if (esd * 10 ** decimals < 1.95) decimals += 1;
  const su = Math.round(esd * 10 ** decimals);
  if (decimals <= 0) return `${Math.round(value)}(${Math.round(esd)})`;
  return `${value.toFixed(decimals)}(${su})`;
}

export interface RietveldMethodsInput {
  result: RietveldResult;
  choices: RefineChoices;
  backgroundTerms: number;
  /** Phase name and where its structure came from (for example "COD 9015929"), in result order. */
  phases: { name: string; reference: string }[];
  /** Radiation as written in the methods, for example "Cu Kα1/Kα2 (λ = 1.5405929, 1.5444274 Å, ratio 0.5)". */
  radiation: string;
}

const percent = (v: number) => `${(100 * v).toFixed(2)} %`;

/** Methods sentences for a basic Rietveld refinement. */
export function rietveldMethods(input: RietveldMethodsInput): string {
  const { result, choices } = input;
  const from = result.x[0] as number;
  const to = result.x[result.x.length - 1] as number;
  const refined = [
    'scale factors',
    `a ${input.backgroundTerms}-term Chebyshev background`,
    ...(choices.zero ? ['the zero shift'] : []),
    ...(choices.displacement ? ['the sample displacement'] : []),
    ...(choices.cell ? ['the unit cell parameters'] : []),
    ...(choices.width
      ? [
          choices.tch
            ? 'the Gaussian W and Lorentzian X widths'
            : 'the Caglioti W parameter and the pseudo-Voigt mixing parameter η',
        ]
      : []),
    ...(choices.widthSlope
      ? [
          choices.tch
            ? 'the Gaussian U, V and Lorentzian Y widths'
            : 'the Caglioti U and V parameters',
        ]
      : []),
    ...(choices.orientation && result.phases.some((p) => p.orientation)
      ? ['March–Dollase preferred orientation']
      : []),
    ...(choices.overallB ? ['an overall displacement factor B'] : []),
    ...(choices.asymmetry
      ? [
          'the peak asymmetry parameters P1 and P2 of the Bérar–Baldinozzi correction (J. Appl. Cryst. 26 (1993) 128), applied with their 1/tan θ terms',
        ]
      : []),
    ...(result.phases.some((p) => p.atoms)
      ? [
          ...(choices.positions
            ? [
                `the atom coordinates left free by the site symmetry${choices.restraints ? ' (with bond-length restraints to the starting structure, σ = 0.02 Å)' : ''}`,
              ]
            : []),
          ...(choices.occupancy ? ['the site occupancies'] : []),
          ...(choices.biso && !choices.aniso
            ? ['the isotropic displacement parameters B of each atom']
            : []),
          ...(choices.aniso
            ? [
                'the anisotropic displacement parameters U_ij of each atom, constrained by its site symmetry',
              ]
            : []),
        ]
      : []),
  ];
  const structured = result.phases.some((p) => p.atoms);
  const list = (items: string[]) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const sentences = [
    `A ${structured ? 'Rietveld' : 'basic Rietveld'} refinement was carried out over 2θ = ${from.toFixed(2)}–${to.toFixed(2)}° with ${input.radiation}, using the structure models of ${list(input.phases.map((p) => `${p.name} (${p.reference})`))} ${structured ? ', starting from the atom positions, occupancies and displacement parameters of these files' : ' with atom positions, occupancies and displacement parameters fixed'}.`,
    `Refined were ${list(refined)}; the profile was ${choices.tch ? 'the Thompson–Cox–Hastings pseudo-Voigt (J. Appl. Cryst. 20 (1987) 79) with Gaussian FWHM² = U tan²θ + V tanθ + W and Lorentzian FWHM = X/cosθ + Y tanθ' : 'a pseudo-Voigt function with FWHM² = U tan²θ + V tanθ + W'}, and points were weighted by 1/y_obs.`,
    `Final agreement: R_wp = ${percent(result.stats.rwp)}, R_p = ${percent(result.stats.rp)}, R_exp = ${percent(result.stats.rexp)}, χ² = ${result.stats.chi2.toFixed(2)}.`,
  ];
  const fractions = result.phases.filter((p) => p.weightFraction);
  if (fractions.length > 1)
    sentences.push(
      `Weight fractions were calculated with the method of Hill and Howard (J. Appl. Cryst. 20 (1987) 467): ${list(fractions.map((p) => `${p.name} ${withUncertainty(100 * (p.weightFraction?.value ?? 0), 100 * (p.weightFraction?.esd ?? 0), 1)} wt%`))}, relative to the crystalline phases refined.`,
    );
  return sentences.join(' ');
}
