import { digitizedSentence } from '../digitize/methods';
import { HC_EV_NM } from './conversions';
import { SIGMOID_N, type SigmoidType } from './crossChecks';
import { TRANSITIONS, type GapMethod, type TransitionId } from './tauc';
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
    /** How Eg was read from the Tauc line, and the sub-gap baseline region (eV) when one was used. */
    gapMethod: GapMethod;
    baselineEv: [number, number] | null;
    /** For 'subtract-component': the component spectrum and its factor c (fitted or typed). */
    component: { name: string; factor: number; fitted: boolean } | null;
    /** Film (thickness in nm) or solution (path length in cm); `thicknessNm` is the film's. */
    sample: 'film' | 'solution';
    thicknessNm: number | null;
    pathCm: number | null;
    /** Name of the reflectance spectrum α was corrected with, or null. */
    reflectance: string | null;
    urbach: boolean;
    derivative: 'off' | 'linear' | 'log';
    /** Other transitions reported in the results, each with its own fit; only those fitted. */
    alsoReported: TransitionId[];
    /** Cody fit region (eV), when the cross-check gave a gap. */
    cody: [number, number] | null;
    /** Sigmoid fit, when the cross-check gave a gap. */
    sigmoid: { type: SigmoidType; fromEv: number; toEv: number } | null;
    /** Bands of the band table, and the prominence threshold used. */
    bands: { count: number; prominencePercent: number; shoulders: number; hand: number };
    /** Band fit on the energy axis, when one was made. */
    bandFit: { profile: string; fromNm: number; toNm: number; count: number } | null;
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
  const methods = unique(fitted.map((s) => s.gapMethod));
  const whom = (method: GapMethod) => {
    const names = fitted.filter((s) => s.gapMethod === method).map((s) => s.name);
    return methods.length === 1 ? '' : ` (${list(names)})`;
  };
  const regions = (method: GapMethod) =>
    list(
      unique(
        fitted.flatMap((s) =>
          s.gapMethod === method && s.baselineEv
            ? [`${number(s.baselineEv[0])}–${number(s.baselineEv[1])} eV`]
            : [],
        ),
      ),
    );
  const readings: string[] = [];
  if (methods.includes('axis'))
    readings.push(
      `the energy at which a straight line fitted to the linear part of the absorption edge meets the energy axis${whom('axis')}`,
    );
  if (methods.includes('subtract-baseline'))
    readings.push(
      `the energy at which that line meets the energy axis after a straight line fitted to the absorption quantity below the edge (${regions('subtract-baseline')}) was subtracted from the whole spectrum before the Tauc plot was made (the subtraction of Makuła, Pacia and Macyk, J. Phys. Chem. Lett. 9 (2018) 6814, with a straight line in place of a measured component spectrum)${whom('subtract-baseline')}`,
    );
  if (methods.includes('subtract-component')) {
    const parts = fitted.flatMap((s) =>
      s.gapMethod === 'subtract-component' && s.component
        ? [
            `${s.component.name}, c = ${number(s.component.factor)}${s.component.fitted && s.baselineEv ? `, fitted by least squares over ${number(s.baselineEv[0])}–${number(s.baselineEv[1])} eV, where only that component absorbs` : ', set by the user'}${methods.length === 1 && fitted.length === 1 ? '' : `, for ${s.name}`}`,
          ]
        : [],
    );
    readings.push(
      `the energy at which that line meets the energy axis after the spectrum of the second component, measured on its own and scaled by a factor c, was subtracted from the sample spectrum (α_s = α − c·α_m; ${parts.join('; ')}), following Makuła, Pacia and Macyk (J. Phys. Chem. Lett. 9 (2018) 6814)`,
    );
  }
  if (methods.includes('baseline-crossing'))
    readings.push(
      `the energy at which the edge line crosses a second straight line fitted to the Tauc curve below the edge (${regions('baseline-crossing')}), following Makuła, Pacia and Macyk (J. Phys. Chem. Lett. 9 (2018) 6814)${whom('baseline-crossing')}`,
    );
  sentences.push(
    `The optical band gap Eg was estimated with the Tauc method: (αhν)^(1/n) was plotted against hν, with ${list(byTransition)}, and Eg was taken as ${readings.join('; or as ')}. The fit region was chosen for each spectrum and is listed with its R² in the results table; the uncertainty of Eg comes from the covariance of the fitted line${methods.some((m) => m !== 'axis') ? 's' : ''}${fitted.some((s) => s.component?.fitted) ? ' (including that of a fitted factor c)' : ''} and does not include systematic errors.`,
  );

  const films = fitted.filter((s) => s.kind !== 'reflectance' && s.sample === 'film');
  const solutions = fitted.filter((s) => s.kind !== 'reflectance' && s.sample === 'solution');
  const thicknesses = unique(
    films.flatMap((s) => (s.thicknessNm !== null ? [`${number(s.thicknessNm)} nm`] : [])),
  );
  const paths = unique(
    solutions.flatMap((s) => (s.pathCm !== null ? [`${number(s.pathCm)} cm`] : [])),
  );
  const proportional =
    films.some((s) => s.thicknessNm === null) || solutions.some((s) => s.pathCm === null);
  const corrected = films.filter((s) => s.thicknessNm !== null && s.reflectance !== null);
  const alphaParts: string[] = [];
  if (thicknesses.length > 0)
    alphaParts.push(
      `for films the absorption coefficient was calculated as α = ln(10)·A/t with film thickness t = ${list(thicknesses)}`,
    );
  if (corrected.length > 0)
    alphaParts.push(
      `for ${list(corrected.map((s) => `${s.name} (reflectance ${s.reflectance})`))} α was instead obtained from the measured transmittance T and reflectance R as α = (1/t)·ln[(1 − R)²/(2T) + √((1 − R)⁴/(4T²) + R²)], which treats the film as a slab with incoherent multiple internal reflections and neglects the substrate (A. R. Zanatta, Sci. Rep. 9 (2019) 11225, Eq. 6)`,
    );
  if (films.length > corrected.length && thicknesses.length > 0)
    alphaParts.push(
      'without a reflectance spectrum no correction for reflection was made, so α is overestimated where the film reflects',
    );
  if (paths.length > 0)
    alphaParts.push(
      `for solutions α = ln(10)·A/l with path length l = ${list(paths)}, the absorption coefficient of the solution`,
    );
  if (proportional)
    alphaParts.push(
      'where no thickness or path length was given, the absorbance itself was used in place of α (the plot is then only proportional to the true quantity, which does not shift Eg)',
    );
  if (fitted.some((s) => s.kind === 'reflectance'))
    alphaParts.push(
      'for diffuse reflectance the Kubelka–Munk function F(R) = (1 − R)²/(2R) replaced α',
    );
  if (alphaParts.length > 0) sentences.push(`${capitalise(alphaParts.join('; '))}.`);

  const reported = fitted.filter((s) => s.alsoReported.length > 0);
  if (reported.length > 0)
    sentences.push(
      `Band gaps for ${list(
        reported.map(
          (s) => `${list(s.alsoReported.map((t) => `n = ${TRANSITIONS[t].nText}`))} (${s.name})`,
        ),
      )} are also reported, each fitted over its own region of the corresponding Tauc plot.`,
    );

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
  const cody = fitted.filter((s) => s.cody);
  if (cody.length > 0)
    sentences.push(
      `As a cross-check, a Cody plot, (α/hν)^(1/2) against hν, was fitted by a straight line (${list(
        unique(
          cody.map(
            (s) =>
              `${number((s.cody as [number, number])[0])}–${number((s.cody as [number, number])[1])} eV`,
          ),
        ),
      )}) and Eg read where it meets zero (no refractive index factor).`,
    );
  const sigmoid = fitted.filter((s) => s.sigmoid);
  if (sigmoid.length > 0) {
    const types = unique(sigmoid.map((s) => (s.sigmoid as { type: SigmoidType }).type));
    sentences.push(
      `As a further cross-check the absorption edge was fitted by least squares with the sigmoid (Boltzmann) function S(E) = S_max + (S_min − S_max)/[1 + exp((E − E0)/δE)] over ${list(
        unique(
          sigmoid.map((s) => {
            const g = s.sigmoid as { fromEv: number; toEv: number };
            return `${number(g.fromEv)}–${number(g.toEv)} eV`;
          }),
        ),
      )}, and Eg was estimated as E0 − n·δE with ${list(types.map((t) => `n = ${SIGMOID_N[t]} (${t})`))}, following A. R. Zanatta, Sci. Rep. 9 (2019) 11225.`,
    );
  }
  sentences.push(
    'Refractive indices listed with the band gaps are rough empirical estimates from Eg by the relations of Moss (n⁴Eg = 95 eV), Ravindra (n = 4.084 − 0.62Eg) and Hervé–Vandamme (n² = 1 + (13.6/(Eg + 3.47))², energies in eV), as given by S. K. Tripathy, Opt. Mater. 46 (2015) 240.',
  );

  const banded = spectra.filter((s) => s.bands.count > 0);
  if (banded.length > 0) {
    const thresholds = unique(banded.map((s) => `${number(s.bands.prominencePercent)} %`));
    const hand = banded.reduce((n, s) => n + s.bands.hand, 0);
    const shoulders = banded.reduce((n, s) => n + s.bands.shoulders, 0);
    sentences.push(
      `Absorption band maxima were located as local maxima of the absorbance (F(R) for diffuse reflectance) with a prominence of at least ${list(thresholds)} of the value range, the position taken from a parabola through the highest point and its two neighbours${hand > 0 ? `; ${hand} band${hand === 1 ? ' was' : 's were'} added by hand` : ''}${shoulders > 0 ? `; ${shoulders} shoulder${shoulders === 1 ? ' was' : 's were'} taken from minima of the Savitzky–Golay second derivative` : ''}.`,
    );
  }
  const fits = spectra.filter((s) => s.bandFit);
  if (fits.length > 0)
    sentences.push(
      `Overlapping bands were fitted on the photon energy axis with ${list(
        fits.map((s) => {
          const f = s.bandFit as NonNullable<(typeof s)['bandFit']>;
          return `${f.count} ${f.profile} band${f.count === 1 ? '' : 's'} plus a straight background over ${number(f.fromNm)}–${number(f.toNm)} nm (${s.name})`;
        }),
      )}, by least squares.`,
    );
  sentences.push(`Analysis used ${input.software}.`);
  return sentences.join(' ');
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
