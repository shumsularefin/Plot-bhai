import { digitizedSentence } from '../digitize/methods';
import type { BaselineMethod, NormaliseMethod, ReflectanceTransform } from './process';

/**
 * Methods paragraph for a paper, written from the settings the analysis actually used. Every
 * number in the text comes from the input; steps that were not used are left out, and nothing is
 * said about the spectrometer that the data files do not state.
 */
export interface FtirMethodsInput {
  software: string;
  allSynthetic: boolean;
  /** Number of spectra digitized from figure images. */
  digitized: number;
  spectra: {
    kind: 'absorbance' | 'transmittance' | 'reflectance';
    /** Absorbance-like quantity of a reflectance spectrum; null for other kinds. */
    reflectance: ReflectanceTransform | null;
    /** The range replaced by a straight line (CO₂), cm⁻¹; null when that step was off or did nothing. */
    co2: { fromCm: number; toCm: number } | null;
    /** Reference wavenumber of the ATR correction, cm⁻¹; null when it was off. */
    atrReferenceCm: number | null;
    baseline: { method: BaselineMethod; degree: number; logLambda: number; p: number } | null;
    smoothing: { window: number; order: number } | null;
    /** Normalisation actually applied (null when off or when it left the data unchanged). */
    normalise: {
      method: NormaliseMethod;
      fromCm?: number | null;
      toCm?: number | null;
      measure?: 'height' | 'area';
    } | null;
    /** Prominence threshold, percent of the absorbance range; null when no peaks were picked. */
    prominencePercent: number | null;
    /** Number of assignments the user accepted. */
    assignments: number;
    /** Peaks added by hand, shoulders accepted from the second derivative, picked peaks removed. */
    handAdded: number;
    shoulders: number;
    removed: number;
    /** The band fit of step 4, when one was made on the current processing. */
    fit: {
      fromCm: number;
      toCm: number;
      profile: 'gaussian' | 'lorentzian' | 'pseudo-voigt';
      bands: number;
      rSquared: number;
      /** Savitzky–Golay settings when the starting positions came from the second derivative. */
      fromDerivative: { window: number; order: number } | null;
    } | null;
    /** Number of band-area ranges with an area. */
    areas: number;
  }[];
  /** Tolerance of the comparison across samples, cm⁻¹; null with one sample. */
  groupToleranceCm: number | null;
  /** Number of difference spectra made in step 4. */
  differences: number;
  toleranceCm: number;
  /** Citation of the table of typical ranges, when assignments were used. */
  rangeSource: string;
  /** Quantity the processed spectra are presented in (figures and tables). */
  shown: 'absorbance' | 'transmittance';
}

const number = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();
const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const unique = <T>(items: readonly T[]) => [...new Set(items)];

const BASELINES: Record<
  BaselineMethod,
  (b: NonNullable<FtirMethodsInput['spectra'][number]['baseline']>) => string
> = {
  arpls: (b) =>
    `arPLS baseline correction (asymmetrically reweighted penalised least squares, Baek et al., Analyst 140 (2015) 250; smoothness λ = 10^${number(b.logLambda)})`,
  'rubber-band': () => 'rubber-band baseline correction (lower convex hull)',
  polynomial: (b) => `iterative polynomial baseline correction (degree ${b.degree})`,
  als: (b) =>
    `asymmetric least squares baseline correction (smoothness λ = 10^${number(b.logLambda)}, asymmetry p = ${number(b.p)})`,
};
const NORMALISATIONS: Record<
  NormaliseMethod,
  (n: NonNullable<FtirMethodsInput['spectra'][number]['normalise']>) => string
> = {
  max: () => 'normalisation to the highest absorbance',
  minmax: () => 'min–max normalisation to the range 0 to 1',
  band: (n) =>
    `normalisation to the ${n.measure ?? 'height'} of the band between ${number(Math.min(n.fromCm ?? 0, n.toCm ?? 0))} and ${number(Math.max(n.fromCm ?? 0, n.toCm ?? 0))} cm⁻¹, measured above the straight line joining the spectrum at the ends of that range`,
};

/** The paragraph, as plain text. */
export function ftirMethodsParagraph(input: FtirMethodsInput): string {
  const { spectra } = input;
  const sentences: string[] = [];
  const kinds = unique(spectra.map((s) => s.kind));
  sentences.push(
    input.allSynthetic
      ? `The spectra analysed here are generated example data, not measurements. They were treated as ${list(kinds)} spectra.`
      : `FTIR ${list(kinds)} spectra (${spectra.length} in total) were analysed.`,
  );
  const digitized = digitizedSentence(input.digitized, spectra.length, ['spectrum', 'spectra']);
  if (digitized) sentences.push(digitized);
  /** Distinct descriptions, each followed by how many spectra used it when that is not all of them. */
  const counted = (items: string[]) =>
    unique(items).map((text) => {
      const n = items.filter((i) => i === text).length;
      return n === spectra.length ? text : `${text} (${n} of ${spectra.length} spectra)`;
    });
  if (kinds.includes('transmittance')) {
    sentences.push(
      'Transmittance was converted to absorbance with A = 2 − log10(%T) before processing and peak picking.',
    );
  }
  const reflectance = counted(
    spectra.flatMap((s) =>
      s.reflectance === 'kubelka-munk'
        ? [
            'the Kubelka–Munk function F(R) = (1 − R)²/(2R), R the reflectance as a fraction, which assumes an optically thick, diluted and strongly scattering sample',
          ]
        : s.reflectance === 'log-inverse'
          ? ['the apparent absorbance log10(1/R)']
          : [],
    ),
  );
  if (reflectance.length > 0) {
    sentences.push(
      `Diffuse reflectance was converted to ${list(reflectance)} before processing and peak picking; band heights and areas are given in that quantity.`,
    );
  }
  const co2 = counted(
    spectra.flatMap((s) =>
      s.co2
        ? [
            `${number(s.co2.fromCm)}–${number(s.co2.toCm)} cm⁻¹ was replaced by a straight line between its ends`,
          ]
        : [],
    ),
  );
  if (co2.length > 0) {
    sentences.push(
      `To remove the atmospheric CO2 band, ${list(co2)} before the other processing steps; no peaks were picked in that range, and any sample band there is lost.`,
    );
  }

  const steps: string[] = [
    ...counted(
      spectra.flatMap((s) =>
        s.atrReferenceCm !== null
          ? [
              `an ATR correction for the wavelength dependence of the penetration depth (A × ν̃/${number(s.atrReferenceCm)} cm⁻¹)`,
            ]
          : [],
      ),
    ),
    ...counted(
      spectra.flatMap((s) => (s.baseline ? [BASELINES[s.baseline.method](s.baseline)] : [])),
    ),
    ...counted(
      spectra.flatMap((s) =>
        s.smoothing
          ? [
              `Savitzky–Golay smoothing (${s.smoothing.window} points, polynomial order ${s.smoothing.order})`,
            ]
          : [],
      ),
    ),
    ...counted(
      spectra.flatMap((s) =>
        s.normalise ? [NORMALISATIONS[s.normalise.method](s.normalise)] : [],
      ),
    ),
  ];
  sentences.push(
    steps.length > 0
      ? `The data were treated with ${list(steps)}, in the order ATR correction, baseline, smoothing, normalisation.`
      : 'The data were not ATR-corrected, baseline-corrected, smoothed or normalised.',
  );

  if (input.shown === 'transmittance') {
    sentences.push(
      'The processed spectra are presented as transmittance, %T = 100 × 10^(−A) of the processed absorbance.',
    );
  }

  const prominences = unique(
    spectra.flatMap((s) =>
      s.prominencePercent !== null ? [`${number(s.prominencePercent)} %`] : [],
    ),
  );
  if (prominences.length > 0) {
    sentences.push(
      `Band positions were taken as the maxima of local peaks in the absorbance spectrum whose prominence was at least ${list(prominences)} of the absorbance range, refined with a parabola through the maximum and its two neighbouring points.`,
    );
    const sum = (key: 'handAdded' | 'shoulders' | 'removed') =>
      spectra.reduce((total, s) => total + s[key], 0);
    const edits = [
      sum('handAdded') > 0 &&
        `${sum('handAdded')} added by hand at local maxima or chosen positions`,
      sum('shoulders') > 0 &&
        `${sum('shoulders')} shoulder${sum('shoulders') === 1 ? '' : 's'} accepted from minima of the second derivative`,
      sum('removed') > 0 &&
        `${sum('removed')} picked peak${sum('removed') === 1 ? '' : 's'} removed by hand`,
    ].filter((e): e is string => typeof e === 'string');
    if (edits.length > 0) sentences.push(`The peak list was edited by hand: ${list(edits)}.`);
    sentences.push(
      'Band widths (full width at half height) and integrated areas were measured above a straight local baseline joining the lowest points on either side of each band; values for bands that overlap a neighbour are approximate.',
    );
    if (input.groupToleranceCm !== null) {
      sentences.push(
        `For comparison between samples, peaks within ${number(input.groupToleranceCm)} cm⁻¹ of each other were treated as the same band.`,
      );
    }
  }
  if (input.differences > 0) {
    sentences.push(
      `${input.differences === 1 ? 'One difference spectrum was' : `${input.differences} difference spectra were`} calculated after processing as A_sample − k·A_reference, with the reference interpolated linearly onto the sample wavenumbers (k is given in the spectrum name).`,
    );
  }
  const PROFILES = {
    gaussian: 'Gaussian',
    lorentzian: 'Lorentzian',
    'pseudo-voigt': 'pseudo-Voigt',
  };
  for (const s of spectra) {
    const f = s.fit;
    if (!f) continue;
    const start = f.fromDerivative
      ? ` Starting positions were the minima of the second derivative (Savitzky–Golay, ${f.fromDerivative.window} points, polynomial order ${f.fromDerivative.order}).`
      : '';
    sentences.push(
      `The region ${number(Math.min(f.fromCm, f.toCm))}–${number(Math.max(f.fromCm, f.toCm))} cm⁻¹${spectra.length > 1 ? ` of spectrum ${spectra.indexOf(s) + 1}` : ''} was fitted with ${f.bands} ${PROFILES[f.profile]} band${f.bands === 1 ? '' : 's'} plus a linear background by Levenberg–Marquardt least squares (R² = ${number(f.rSquared, 5)}).${start}`,
    );
  }
  if (spectra.some((s) => s.areas > 0)) {
    sentences.push(
      'Band areas were integrated by the trapezoid rule above a straight line joining the spectrum at the two ends of each range.',
    );
  }
  if (spectra.some((s) => s.assignments > 0)) {
    sentences.push(
      `Bands were assigned by comparison with typical wavenumber ranges (${input.rangeSource}), accepting a band within ${number(input.toleranceCm)} cm⁻¹ of a listed range; these assignments rest on typical ranges and are not proof of the groups present.`,
    );
  }
  sentences.push(`Analysis used ${input.software}.`);
  return sentences.join(' ');
}
