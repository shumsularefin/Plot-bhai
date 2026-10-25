/**
 * Methods paragraph for a paper, written from the settings the analysis actually used.
 * Every number in the text comes from the input; a step that was not used is left out, and
 * nothing is said about the instrument that the data files do not state.
 */

export interface MethodsInput {
  software: string;
  /** Radiation assumed in the analysis. */
  radiation: { anode: string; kAlpha1A: number; kAlpha2A: number; kAlpha1Only: boolean };
  /** Scan range and step of the first pattern, when known. */
  scan: { fromDeg: number; toDeg: number; stepDeg: number } | null;
  patterns: number;
  /** True when every pattern is generated example data; then no real measurement is described. */
  allSynthetic: boolean;
  /** Preprocessing of the first pattern. Null entries mean "not used". */
  processing: {
    zeroShiftDeg: number | null;
    smoothing: { window: number; order: number } | null;
    background: {
      method: 'arpls' | 'polynomial' | 'snip' | 'manual';
      degree: number;
      snipWidthDeg: number;
      arplsWidthDeg: number;
      anchors: number;
    } | null;
    kAlpha2Stripped: { ratio: number } | null;
    normalisedTo: number | null;
  };
  /** Peak fitting; null when no peaks were fitted. */
  fit: { profile: 'gaussian' | 'lorentzian' | 'pseudo-voigt'; fixedEta: number | null } | null;
  /** Instrumental broadening. */
  instrument:
    | { kind: 'skipped' }
    | {
        kind: 'constant' | 'caglioti' | 'standard';
        method: 'gaussian' | 'lorentzian' | 'voigt';
        /** Constant FWHM in degrees 2θ, or the standard's material. */
        fwhmDeg?: number;
        standardMaterial?: string;
      };
  /** Size and strain; null when no method produced a result. */
  size: { k: number; methods: string[] } | null;
  /** Reference phases chosen in step 4, from the Crystallography Open Database. */
  /** reference: where the structure came from, for example "COD 9009086" (see phaseReference). */
  phases: { name: string; formula: string; reference: string }[];
  toleranceDeg: number;
}

const number = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();
const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const PROFILES = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'pseudo-Voigt',
} as const;
const CORRECTIONS = {
  gaussian: 'Gaussian (β² = B² − b²)',
  lorentzian: 'Lorentzian (β = B − b)',
  voigt: 'approximate Voigt',
} as const;

/** The paragraph, as plain text (θ, λ and Å as Unicode). */
export function methodsParagraph(input: MethodsInput): string {
  const sentences: string[] = [];
  const { radiation: r, processing: p } = input;

  const lines = r.kAlpha1Only
    ? `${r.anode} Kα1 radiation (λ = ${number(r.kAlpha1A, 7)} Å)`
    : `${r.anode} Kα radiation (Kα1 λ = ${number(r.kAlpha1A, 7)} Å, Kα2 λ = ${number(r.kAlpha2A, 7)} Å)`;
  sentences.push(
    input.allSynthetic
      ? `The patterns analysed here are generated example data, not measurements. Analysis assumed ${lines}.`
      : `Powder X-ray diffraction patterns were analysed assuming ${lines}.`,
  );
  if (input.scan && !input.allSynthetic)
    sentences.push(
      `The scan covered ${number(input.scan.fromDeg)}° to ${number(input.scan.toDeg)}° 2θ in steps of ${number(input.scan.stepDeg)}°.`,
    );

  const prepared: string[] = [];
  if (p.zeroShiftDeg !== null)
    prepared.push(`a zero-shift correction of ${number(p.zeroShiftDeg)}° in 2θ`);
  if (p.smoothing)
    prepared.push(
      `Savitzky–Golay smoothing (${p.smoothing.window} points, polynomial order ${p.smoothing.order})`,
    );
  if (p.background) {
    const detail =
      p.background.method === 'arpls'
        ? `asymmetrically reweighted penalised least squares (arPLS; Baek et al., Analyst 140 (2015) 250) with a smoothness width of ${number(p.background.arplsWidthDeg)}° 2θ`
        : p.background.method === 'snip'
          ? `SNIP, clipping width ${number(p.background.snipWidthDeg)}° 2θ`
          : p.background.method === 'polynomial'
            ? `iterative polynomial of degree ${p.background.degree}`
            : `a curve through ${p.background.anchors} manually placed points`;
    prepared.push(`background subtraction (${detail})`);
  }
  if (p.kAlpha2Stripped)
    prepared.push(
      `Kα2 stripping by the Rachinger method (intensity ratio ${number(p.kAlpha2Stripped.ratio)})`,
    );
  if (p.normalisedTo !== null)
    prepared.push(`normalisation to a maximum of ${number(p.normalisedTo)}`);
  sentences.push(
    prepared.length > 0
      ? `Before analysis the data were treated with ${list(prepared)}.`
      : 'The data were not smoothed, background-corrected or otherwise processed before analysis.',
  );

  if (input.fit) {
    const eta =
      input.fit.profile === 'pseudo-voigt'
        ? input.fit.fixedEta === null
          ? ', with the Lorentzian fraction fitted'
          : `, with the Lorentzian fraction fixed at ${number(input.fit.fixedEta)}`
        : '';
    sentences.push(
      `Peak positions, widths (FWHM) and areas were obtained by non-linear least-squares fitting of ${PROFILES[input.fit.profile]} profile functions${eta}; interplanar spacings follow from Bragg's law, λ = 2d sin θ.`,
    );
  }

  const i = input.instrument;
  if (i.kind === 'skipped')
    sentences.push(
      'Instrumental broadening was not corrected, so the widths include it and crystallite sizes are lower limits.',
    );
  else {
    const source =
      i.kind === 'constant'
        ? `a constant instrumental width of ${number(i.fwhmDeg ?? NaN)}° 2θ`
        : i.kind === 'caglioti'
          ? 'an instrumental width described by the Caglioti function'
          : `an instrumental width curve fitted to a measured ${i.standardMaterial ?? 'line-profile'} standard`;
    sentences.push(
      `Instrumental broadening was removed from the measured FWHM (B) with the ${CORRECTIONS[i.method]} correction, using ${source}.`,
    );
  }

  if (input.size) {
    sentences.push(
      `Crystallite size was estimated with ${list(input.size.methods)} using a shape factor K = ${number(input.size.k)}; the values are estimates from peak broadening, not exact sizes.`,
    );
  }

  if (input.phases.length > 0) {
    const named = input.phases.map((ph) => `${ph.name} (${ph.formula}, ${ph.reference})`);
    const allCod = input.phases.every((ph) => ph.reference.startsWith('COD '));
    sentences.push(
      `${allCod ? 'Reference patterns were calculated from structures in the Crystallography Open Database' : 'Reference patterns were calculated from crystal structures (built-in entries from the Crystallography Open Database and CIF files supplied by the user, as named)'}: ${list(named)}. Fitted peaks were assigned to the nearest reference line within ${number(input.toleranceDeg)}° 2θ; these assignments are suggestions, not phase identifications.`,
    );
  }

  sentences.push(`Analysis used ${input.software}.`);
  return sentences.join(' ');
}
