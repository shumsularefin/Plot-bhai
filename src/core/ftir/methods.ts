import { digitizedSentence } from '../digitize/methods';
import type { BaselineMethod, NormaliseMethod } from './process';

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
    kind: 'absorbance' | 'transmittance';
    baseline: { method: BaselineMethod; degree: number; logLambda: number; p: number } | null;
    smoothing: { window: number; order: number } | null;
    normalise: NormaliseMethod | null;
    /** Prominence threshold, percent of the absorbance range; null when no peaks were picked. */
    prominencePercent: number | null;
    /** Number of assignments the user accepted. */
    assignments: number;
  }[];
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
const NORMALISATIONS: Record<NormaliseMethod, string> = {
  max: 'normalisation to the highest absorbance',
  minmax: 'min–max normalisation to the range 0 to 1',
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
  if (kinds.includes('transmittance')) {
    sentences.push(
      'Transmittance was converted to absorbance with A = 2 − log10(%T) before processing and peak picking.',
    );
  }

  /** Distinct descriptions, each followed by how many spectra used it when that is not all of them. */
  const counted = (items: string[]) =>
    unique(items).map((text) => {
      const n = items.filter((i) => i === text).length;
      return n === spectra.length ? text : `${text} (${n} of ${spectra.length} spectra)`;
    });
  const steps: string[] = [
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
    ...counted(spectra.flatMap((s) => (s.normalise ? [NORMALISATIONS[s.normalise]] : []))),
  ];
  sentences.push(
    steps.length > 0
      ? `The data were treated with ${list(steps)}, in the order baseline, smoothing, normalisation.`
      : 'The data were not baseline-corrected, smoothed or normalised.',
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
  }
  if (spectra.some((s) => s.assignments > 0)) {
    sentences.push(
      `Bands were assigned by comparison with typical wavenumber ranges (${input.rangeSource}), accepting a band within ${number(input.toleranceCm)} cm⁻¹ of a listed range; these assignments rest on typical ranges and are not proof of the groups present.`,
    );
  }
  sentences.push(`Analysis used ${input.software}.`);
  return sentences.join(' ');
}
