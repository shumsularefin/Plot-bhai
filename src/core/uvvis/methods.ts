import { digitizedSentence } from '../digitize/methods';
import { HC_EV_NM } from './conversions';
import { TRANSITIONS, type TransitionId } from './tauc';
import type { SpectrumKind } from './types';

/**
 * Methods paragraph for a paper, written from the settings the analysis actually used. Every
 * number in the text comes from the input; a step that was not used is left out, and nothing is
 * said about the spectrometer that the data files do not state.
 */
export interface UvvisMethodsInput {
  software: string;
  /** True when every spectrum is generated example data; then no measurement is described. */
  allSynthetic: boolean;
  /** Number of spectra digitized from figure images. */
  digitized: number;
  spectra: {
    name: string;
    kind: SpectrumKind;
    cleaning: {
      blank: boolean;
      offset: { fromNm: number; toNm: number } | null;
      smoothing: { window: number; order: number } | null;
    };
    transition: TransitionId;
    /** Whether a band gap fit was obtained for this spectrum. */
    fitted: boolean;
    thicknessNm: number | null;
    urbach: boolean;
    derivative: 'off' | 'linear' | 'log';
  }[];
}

const number = (value: number, digits = 4) => Number(value.toPrecision(digits)).toString();
const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const unique = <T>(items: readonly T[]) => [...new Set(items)];

const KIND_NAMES: Record<SpectrumKind, string> = {
  absorbance: 'absorbance',
  transmittance: 'transmittance',
  reflectance: 'diffuse reflectance',
};

/** The paragraph, as plain text. */
export function uvvisMethodsParagraph(input: UvvisMethodsInput): string {
  const { spectra } = input;
  const sentences: string[] = [];
  const kinds = unique(spectra.map((s) => KIND_NAMES[s.kind]));
  sentences.push(
    input.allSynthetic
      ? `The spectra analysed here are generated example data, not measurements. They were treated as ${list(kinds)} spectra.`
      : `UV-Vis ${list(kinds)} spectra (${spectra.length} in total) were analysed.`,
  );
  const digitized = digitizedSentence(input.digitized, spectra.length, ['spectrum', 'spectra']);
  if (digitized) sentences.push(digitized);

  const prepared: string[] = [];
  const withBlank = spectra.filter((s) => s.cleaning.blank).length;
  if (withBlank > 0)
    prepared.push(
      withBlank === spectra.length
        ? 'subtraction of a blank spectrum'
        : `subtraction of a blank spectrum (${withBlank} of ${spectra.length} spectra)`,
    );
  const offsets = unique(
    spectra.flatMap((s) =>
      s.cleaning.offset
        ? [`${number(s.cleaning.offset.fromNm)} to ${number(s.cleaning.offset.toNm)} nm`]
        : [],
    ),
  );
  if (offsets.length > 0) prepared.push(`a baseline offset set to zero over ${list(offsets)}`);
  const smoothings = unique(
    spectra.flatMap((s) =>
      s.cleaning.smoothing
        ? [`${s.cleaning.smoothing.window} points, polynomial order ${s.cleaning.smoothing.order}`]
        : [],
    ),
  );
  if (smoothings.length > 0) prepared.push(`Savitzky–Golay smoothing (${list(smoothings)})`);
  sentences.push(
    prepared.length > 0
      ? `Before analysis the data were treated with ${list(prepared)}.`
      : 'The data were not blank-corrected, offset or smoothed before analysis.',
  );

  sentences.push(
    `Photon energy was calculated as E = hc/λ with hc = ${number(HC_EV_NM, 6)} eV nm.`,
  );

  const fitted = spectra.filter((s) => s.fitted);
  if (fitted.length === 0) {
    sentences.push('No band gap fit was obtained.');
    return sentences.join(' ');
  }
  const byTransition = unique(fitted.map((s) => s.transition)).map((id) => {
    const names = fitted.filter((s) => s.transition === id).map((s) => s.name);
    const { nText, label } = TRANSITIONS[id];
    return `n = ${nText} (${label.toLowerCase()} transition) for ${fitted.length === names.length ? 'all spectra' : list(names)}`;
  });
  sentences.push(
    `The optical band gap Eg was estimated with the Tauc method: (αhν)^(1/n) was plotted against hν, with ${list(byTransition)}, and Eg was taken as the energy at which a straight line fitted to the linear part of the absorption edge meets the energy axis. The fit region was chosen for each spectrum and is listed with its R² in the results table; the uncertainty of Eg comes from the covariance of the fitted line and does not include systematic errors.`,
  );

  const thicknesses = unique(
    fitted.flatMap((s) =>
      s.kind !== 'reflectance' && s.thicknessNm !== null ? [`${number(s.thicknessNm)} nm`] : [],
    ),
  );
  const proportional = fitted.some((s) => s.kind !== 'reflectance' && s.thicknessNm === null);
  const alphaParts: string[] = [];
  if (thicknesses.length > 0)
    alphaParts.push(
      `the absorption coefficient was calculated as α = ln(10)·A/t with film thickness t = ${list(thicknesses)}`,
    );
  if (proportional)
    alphaParts.push(
      'where no thickness was given, the absorbance itself was used in place of α (the plot is then only proportional to the true quantity, which does not shift Eg)',
    );
  if (fitted.some((s) => s.kind === 'reflectance'))
    alphaParts.push(
      'for diffuse reflectance the Kubelka–Munk function F(R) = (1 − R)²/(2R) replaced α',
    );
  if (alphaParts.length > 0) sentences.push(`${capitalise(list(alphaParts))}.`);

  if (fitted.some((s) => s.urbach))
    sentences.push(
      'The Urbach energy Eu was obtained from the inverse slope of a straight-line fit of ln α against photon energy in the tail below the edge.',
    );
  const derivatives = unique(fitted.map((s) => s.derivative).filter((d) => d !== 'off'));
  if (derivatives.length > 0)
    sentences.push(
      `As a cross-check the energy of the steepest rise was taken from the maximum of ${derivatives
        .map((d) => (d === 'linear' ? 'dS/dE' : 'd(ln S)/dE'))
        .join(' or ')}, where S is the plotted absorption quantity.`,
    );
  sentences.push(`Analysis used ${input.software}.`);
  return sentences.join(' ');
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
