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
  /** Monochromator in words, for example "a graphite (002) diffracted-beam monochromator"; missing is none. */
  monochromator?: string;
  /** True when the data were measured with an automatic (variable) divergence slit. */
  variableSlit?: boolean;
  /** Where a fixed instrument profile came from, for example "a refinement of LaB6". */
  instrumentSource?: string;
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
    ...(choices.transparency ? ['the sample transparency'] : []),
    ...(choices.size ? ['the crystallite size of each phase'] : []),
    ...(choices.strain ? ['the microstrain of each phase'] : []),
    ...(choices.sampleMix && (choices.size || choices.strain)
      ? ['the Lorentzian fractions of the size and strain broadening']
      : []),
    ...(choices.overallB ? ['an overall displacement factor B'] : []),
    ...(choices.roughness
      ? ['the Suortti surface-roughness correction (J. Appl. Cryst. 5 (1972) 325)']
      : []),
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
  const tch = result.phases.some((p) => p.tch);
  if (tch && !choices.tch)
    sentences[1] = sentences[1]?.replace(
      'a pseudo-Voigt function with FWHM² = U tan²θ + V tanθ + W',
      'the Thompson–Cox–Hastings pseudo-Voigt (J. Appl. Cryst. 20 (1987) 79) with Gaussian FWHM² = U tan²θ + V tanθ + W and Lorentzian FWHM = X/cosθ + Y tanθ',
    ) as string;
  const pola = result.polarisation ?? 0.5;
  if (input.monochromator || pola !== 0.5)
    sentences.push(
      `The polarisation factor was that of ${input.monochromator ?? 'the monochromator'} (polarisation coefficient P = ${pola.toFixed(4)} in the GSAS-II convention, P = 0.5 for an unpolarised beam).`,
    );
  if (input.variableSlit)
    sentences.push(
      'The data were measured with an automatic divergence slit, so the calculated intensities were multiplied by sin θ.',
    );
  if (result.instrument)
    sentences.push(
      `The instrument profile (U, V, W, X, Y) was fixed${input.instrumentSource ? ` from ${input.instrumentSource}` : ''}, so the refined broadening is that of the sample.`,
    );
  const excluded = result.excluded ?? [];
  if (excluded.length > 0)
    sentences.push(
      `The 2θ ranges ${list(excluded.map(([a, b]) => `${a}–${b}°`))} were excluded from the refinement.`,
    );
  const leBail = result.phases.filter((p) => p.leBail);
  if (leBail.length > 0)
    sentences.push(
      `${list(leBail.map((p) => p.name))} ${leBail.length > 1 ? 'were' : 'was'} fitted by the Le Bail method (A. Le Bail, H. Duroy and J. L. Fourquet, Mat. Res. Bull. 23 (1988) 447), with intensities extracted from the data instead of calculated from a structure.`,
    );
  const sized = result.phases.filter((p) => p.size || p.microstrain);
  if (sized.length > 0)
    sentences.push(
      `Isotropic sample broadening was modelled as in GSAS-II, with Lorentzian size broadening (180/π)λ/(D cos θ) and strain broadening (180/π)·10⁻⁶·μ·tan θ (degrees 2θ): ${list(
        sized.map((p) =>
          [
            p.size && Number.isFinite(p.size.value)
              ? `${p.name} D = ${withUncertainty(p.size.value, p.size.esd, 1)} nm`
              : p.size
                ? `${p.name} no measurable size broadening`
                : p.name,
            p.microstrain
              ? `μ = ${withUncertainty(p.microstrain.value, p.microstrain.esd, 0)} × 10⁻⁶`
              : '',
          ]
            .filter(Boolean)
            .join(', '),
        ),
      )}${result.instrument ? '' : ' (the instrument profile was not fixed, so D is a lower limit)'}.`,
    );
  const fractions = result.phases.filter((p) => p.weightFraction);
  if (fractions.length > 1)
    sentences.push(
      `Weight fractions were calculated with the method of Hill and Howard (J. Appl. Cryst. 20 (1987) 467): ${list(fractions.map((p) => `${p.name} ${withUncertainty(100 * (p.weightFraction?.value ?? 0), 100 * (p.weightFraction?.esd ?? 0), 1)} wt%`))}, relative to the crystalline phases refined.`,
    );
  const dopants = result.phases.flatMap((p) =>
    (p.atoms ?? []).flatMap((a) => (a.substitute ? [{ phase: p.name, atom: a }] : [])),
  );
  if (dopants.length > 0)
    sentences.push(
      `${list(
        dopants.map(
          ({ phase, atom }) =>
            `${atom.substitute?.element} was placed on the ${atom.label} site of ${phase} with ${atom.substitute?.fraction.refined ? 'a refined' : 'a fixed'} fraction x = ${withUncertainty(atom.substitute?.fraction.value ?? 0, atom.substitute?.fraction.esd ?? 0, 3)}`,
        ),
      )}, sharing the site's position and displacement parameter (site scattering factor (1 − x) f_host + x f_dopant).`,
    );
  const standard = result.standard;
  if (standard) {
    const name = result.phases.find((p) => p.id === standard.phaseId)?.name ?? 'the standard';
    sentences.push(
      `With ${name} added as an internal standard at ${(100 * standard.fraction).toFixed(2)} wt%, the amorphous and unidentified content of the sample was ${withUncertainty(100 * standard.amorphous.value, 100 * standard.amorphous.esd, 1)} wt%.`,
    );
  }
  if (Number.isFinite(result.stats.durbinWatson))
    sentences.push(
      `The Durbin–Watson d statistic of the weighted residuals was ${result.stats.durbinWatson.toFixed(2)}.`,
    );
  return sentences.join(' ');
}
