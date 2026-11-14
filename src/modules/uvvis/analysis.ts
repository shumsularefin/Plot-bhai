import { energyFromWavelength } from '../../core/uvvis/conversions';
import { cleanSpectrum, DEFAULT_CLEANING, lambdaMax, type Cleaned } from '../../core/uvvis/process';
import {
  absorptionSignal,
  analyseTaucGap,
  compareTransitions,
  derivativeMaximum,
  GAP_METHODS,
  interpolateOnto,
  suggestUrbachRegion,
  SUB_GAP_SHIFT_EV,
  TRANSITIONS,
  urbachFit,
  type AbsorptionSignal,
  type DerivativePeak,
  type TaucGap,
  type TransitionComparison,
  type UrbachFit,
} from '../../core/uvvis/tauc';
import type { Spectrum } from '../../core/uvvis/types';
import { bandGapFor, type BandGapChoice, type UvvisData } from './data';

/** Cleans every spectrum with its own settings (the blank is the spectrum chosen for it). */
export function cleanAll(spectra: readonly Spectrum[], cleaning: UvvisData['cleaning']): Cleaned[] {
  return spectra.map((s) => {
    const settings = cleaning[s.id] ?? DEFAULT_CLEANING;
    const blank = settings.blank.blankId
      ? spectra.find((b) => b.id === settings.blank.blankId && b.id !== s.id)
      : undefined;
    return cleanSpectrum(s, settings, blank);
  });
}

export interface BandGapAnalysis extends TaucGap {
  signal: AbsorptionSignal;
  /** For 'subtract-component': the component spectrum used, or why none could be used. */
  component: { name: string } | null;
  componentProblem: ComponentProblem;
  /** True when the method was chosen automatically. */
  automatic: boolean;
  comparison: TransitionComparison[];
  urbach: { region: [number, number] | null; fit: UrbachFit | null } | null;
  derivative: DerivativePeak | null;
}

/** A spectrum with its cleaned data, as passed for the second component. */
export interface CleanedSpectrum {
  spectrum: Pick<Spectrum, 'id' | 'name' | 'kind' | 'scale'>;
  cleaned: Pick<Cleaned, 'wavelengthNm' | 'values'>;
}

/** Why a chosen component spectrum cannot be used, or null when it can. */
export type ComponentProblem = 'none-chosen' | 'unit' | 'no-overlap' | null;

/** All band gap numbers of one cleaned spectrum under its settings. */
export function analyseBandGap(
  spectrum: Pick<Spectrum, 'kind' | 'scale'>,
  cleaned: Pick<Cleaned, 'wavelengthNm' | 'values'>,
  choice: BandGapChoice,
  component: CleanedSpectrum | null = null,
): BandGapAnalysis {
  const signal = absorptionSignal(
    cleaned.wavelengthNm,
    cleaned.values,
    spectrum,
    choice.thicknessNm,
  );
  // The component is converted to the same quantity (A or F(R)); its scale, including any
  // thickness, is absorbed by the factor c.
  let componentSignal: Float64Array | null = null;
  let componentProblem: ComponentProblem = null;
  if (choice.method === 'subtract-component') {
    if (!component) componentProblem = 'none-chosen';
    else {
      const other = absorptionSignal(
        component.cleaned.wavelengthNm,
        component.cleaned.values,
        component.spectrum,
        null,
      );
      if ((other.unit === 'kubelka-munk') !== (signal.unit === 'kubelka-munk')) {
        componentProblem = 'unit';
      } else {
        componentSignal = interpolateOnto(other.energyEv, other.signal, signal.energyEv);
        if (!componentSignal.some(Number.isFinite)) {
          componentSignal = null;
          componentProblem = 'no-overlap';
        }
      }
    }
  }
  const options = {
    method: choice.method,
    baselineRegion: choice.baselineRegion,
    ...(choice.legacySuggestion && { legacySuggestion: true }),
    component: componentSignal
      ? { signal: componentSignal, factor: choice.component?.factor ?? null }
      : null,
  };
  const gap = analyseTaucGap(
    signal.energyEv,
    signal.signal,
    TRANSITIONS[choice.transition].exponent,
    { ...options, edgeRegion: choice.regions[choice.transition] ?? null },
  );
  const { fit, region } = gap;
  const comparison = compareTransitions(signal.energyEv, signal.signal, choice.regions, options);

  let urbach: BandGapAnalysis['urbach'] = null;
  if (choice.urbach.enabled) {
    const urbachRegion =
      choice.urbach.region ??
      (fit ? suggestUrbachRegion(signal.energyEv, signal.signal, fit.egEv) : null);
    urbach = {
      region: urbachRegion,
      fit: urbachRegion
        ? urbachFit(signal.energyEv, signal.signal, urbachRegion[0], urbachRegion[1])
        : null,
    };
  }
  // The derivative is searched around the fit region (0.3 eV either side), or over everything.
  const derivative =
    choice.derivative === 'off'
      ? null
      : derivativeMaximum(
          signal.energyEv,
          signal.signal,
          choice.derivative,
          region ? region[0] - 0.3 : -Infinity,
          region ? region[1] + 0.3 : Infinity,
        );
  return {
    ...gap,
    signal,
    component: componentSignal && component ? { name: component.spectrum.name } : null,
    componentProblem,
    automatic: choice.method === null,
    comparison,
    urbach,
    derivative,
  };
}

export interface ResultRow {
  spectrum: Spectrum;
  choice: BandGapChoice;
  lambdaMax: ReturnType<typeof lambdaMax>;
  analysis: BandGapAnalysis;
  /** Wavelength at the band gap energy, nm. */
  edgeNm: number | null;
}

/** The sub-gap baseline region the method used, or null when it used none. */
export function baselineUsed(analysis: TaucGap): [number, number] | null {
  if (analysis.method === 'axis') return null;
  if (analysis.method === 'subtract-component' && analysis.componentFactor?.n === 0) return null;
  return analysis.baselineRegion;
}

/** The second-component spectrum chosen for a spectrum, with its cleaned data. */
export function componentFor(
  spectra: readonly Spectrum[],
  cleaned: readonly Cleaned[],
  choice: BandGapChoice,
  ownId: string,
): CleanedSpectrum | null {
  const id = choice.component?.spectrumId;
  const index = spectra.findIndex((s) => s.id === id && s.id !== ownId);
  const spectrum = spectra[index];
  const clean = cleaned[index];
  return spectrum && clean ? { spectrum, cleaned: clean } : null;
}

/** One result row per spectrum, from the cleaned data. */
export function resultRows(data: UvvisData): ResultRow[] {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  return data.spectra.map((spectrum, i) => {
    const clean = cleaned[i] ?? spectrum;
    const choice = bandGapFor(data, spectrum.id);
    const analysis = analyseBandGap(
      spectrum,
      clean,
      choice,
      componentFor(data.spectra, cleaned, choice, spectrum.id),
    );
    return {
      spectrum,
      choice,
      lambdaMax: lambdaMax(
        clean.wavelengthNm,
        clean.values,
        spectrum,
        data.lambdaRange.fromNm ?? -Infinity,
        data.lambdaRange.toNm ?? Infinity,
      ),
      analysis,
      edgeNm: analysis.fit ? energyFromWavelength(analysis.fit.egEv) : null,
    };
  });
}

export interface FitMessage {
  level: 'warning' | 'info';
  text: string;
}

/** Plain-language messages about a band gap fit, shown next to it. */
export function fitMessages(analysis: BandGapAnalysis): FitMessage[] {
  const { fit, signal } = analysis;
  const messages: FitMessage[] = [];
  const eV = (v: number) => `${Number(v.toFixed(3))} eV`;
  if (!fit) {
    messages.push({
      level: 'warning',
      text: 'No rising straight line could be fitted in this region (it needs at least 4 points, a positive slope and a gap above zero). Move the markers over the straight part of the edge.',
    });
  } else {
    if (fit.n < 8) {
      messages.push({
        level: 'warning',
        text: `Only ${fit.n} points are in the fit, so the line and its uncertainty are poorly determined. Widen the region.`,
      });
    }
    if (fit.rSquared < 0.99) {
      messages.push({
        level: 'warning',
        text: `The points in this region are not very close to a straight line (R² = ${fit.rSquared.toFixed(4)}). Move the markers over the straightest part of the edge.`,
      });
    }
    if (fit.egEv > fit.fromEv) {
      messages.push({
        level: 'warning',
        text: `The band gap (${eV(fit.egEv)}) lies inside the fit region (it starts at ${eV(fit.fromEv)}). Check the region.`,
      });
    } else if (fit.fromEv - fit.egEv > 1.5 * (fit.toEv - fit.fromEv)) {
      messages.push({
        level: 'warning',
        text: `The band gap lies ${eV(fit.fromEv - fit.egEv)} below the fitted region, a long extrapolation compared with the ${eV(fit.toEv - fit.fromEv)} width of the region, so it is uncertain.`,
      });
    }
    if (fit.egEv < (signal.energyEv[0] as number)) {
      messages.push({
        level: 'warning',
        text: 'The band gap is below the lowest photon energy measured. Check the fit region and the data.',
      });
    }
  }
  const eg = (v: number) => `${v.toFixed(3)} eV`;
  if (analysis.subGapLevel && analysis.method === 'axis') {
    messages.push({
      level: 'warning',
      text: `The Tauc curve does not fall to zero below the edge (there is background absorption, for example from scattering, a second phase, defects or an imperfect blank), so the line meets the axis below the true gap: ${analysis.axisEgEv === null ? 'no straight edge is found without correction' : eg(analysis.axisEgEv)}${analysis.subtractedEgEv === null ? '' : `, against ${eg(analysis.subtractedEgEv)} with the sub-gap baseline subtracted`}. Choose "${GAP_METHODS['subtract-baseline'].label}" (or the crossing with a baseline) under "How Eg is read".`,
    });
  }
  if (
    fit &&
    analysis.method === 'baseline-crossing' &&
    analysis.subtractedEgEv !== null &&
    Math.abs(fit.egEv - analysis.subtractedEgEv) > SUB_GAP_SHIFT_EV
  ) {
    messages.push({
      level: 'info',
      text: `With background absorption the Tauc curve bends above the gap, so the crossing lies below the gap found with the baseline subtracted first (${eg(analysis.subtractedEgEv)}). Report which method you used.`,
    });
  }
  if (analysis.method === 'subtract-component') {
    const problem = analysis.componentProblem;
    const c = analysis.componentFactor;
    if (problem === 'none-chosen') {
      messages.push({
        level: 'warning',
        text: 'Choose the spectrum of the second component (for example the dye, modifier or support measured on its own) under "Second component". Upload it with the sample if it is not loaded.',
      });
    } else if (problem === 'unit') {
      messages.push({
        level: 'warning',
        text: 'The second component must be measured the same way as this spectrum: both diffuse reflectance (F(R)) or both absorbance or transmittance.',
      });
    } else if (problem === 'no-overlap') {
      messages.push({
        level: 'warning',
        text: 'The second component does not cover the energies of this spectrum, so it cannot be subtracted.',
      });
    } else if (!c) {
      messages.push({
        level: 'warning',
        text: 'The scale factor c could not be fitted: the baseline region needs at least 4 points where the component absorbs. Set the baseline region or type c.',
      });
    } else {
      if (c.value < 0) {
        messages.push({
          level: 'warning',
          text: `The scale factor c is negative (${c.value.toPrecision(3)}), so the component is not what absorbs below the edge. Check that the right spectrum is chosen.`,
        });
      }
      messages.push({
        level: 'info',
        text:
          c.n > 0
            ? `c = ${c.value.toPrecision(4)} ± ${c.sigma.toPrecision(2)}, fitted over the baseline region, where the sample is assumed to absorb only through the second component. Its uncertainty is included in that of Eg.`
            : `c = ${c.value.toPrecision(4)}, typed by you (for example from the concentration of the component); no uncertainty is assigned to it.`,
      });
    }
  }
  if (
    (analysis.method === 'baseline-crossing' ||
      analysis.method === 'subtract-baseline' ||
      (analysis.method === 'subtract-component' && analysis.componentFactor?.n !== 0)) &&
    !analysis.baselineRegion
  ) {
    messages.push({
      level: 'warning',
      text: 'No baseline region could be placed below the edge (the spectrum needs at least 6 points there). Set one by typing its limits, or use the axis intercept.',
    });
  }
  if (signal.unit === 'proportional') {
    messages.push({
      level: 'info',
      text: 'No film thickness is given, so the vertical axis is only proportional to (αhν)^(1/n). The band gap is not affected, but the axis has no absolute scale.',
    });
  }
  if (signal.unit === 'kubelka-munk') {
    messages.push({
      level: 'info',
      text: 'For diffuse reflectance the Kubelka–Munk function F(R) is used in place of α. This assumes an optically thick, scattering powder sample.',
    });
  }
  return messages;
}
