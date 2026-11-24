import {
  codyGap,
  sigmoidGap,
  suggestSigmoidRange,
  type CodyGap,
  type SigmoidFit,
  type SigmoidType,
} from '../../core/uvvis/crossChecks';
import { toQuantity, type Cleaned } from '../../core/uvvis/process';
import {
  absorptionSignal,
  analyseTaucGap,
  compareTransitions,
  derivativeMaximum,
  interpolateOnto,
  suggestUrbachRegion,
  TRANSITIONS,
  urbachFit,
  type AbsorptionSignal,
  type DerivativePeak,
  type TaucGap,
  type TransitionComparison,
  type TransitionId,
  type UrbachFit,
} from '../../core/uvvis/tauc';
import type { Spectrum } from '../../core/uvvis/types';
import type { BandGapChoice } from './data';

/*
 * The band gap analysis of one spectrum. It imports only core code (and types), so the band gap
 * worker (src/workers/bandgap.worker.ts) can run it without the user interface.
 */

/** Optical path in nm for α = ln(10)·A/path: the film thickness, or the cuvette path length. */
export function opticalPathNm(choice: BandGapChoice): number | null {
  if (choice.sample === 'solution') return choice.pathCm !== null ? choice.pathCm * 1e7 : null;
  return choice.thicknessNm;
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
  /** What was measured, from the settings: it decides what α means. */
  sample: BandGapChoice['sample'];
  /** How reflection was treated in α (films with a thickness only; null otherwise). */
  reflection: Reflection | null;
  /** Cody plot cross-check, when switched on. */
  cody: CodyGap | null;
  /** Sigmoid (Boltzmann) cross-check, when switched on. */
  sigmoid: SigmoidCheck | null;
}

/**
 * Reflection in α of a film: 'corrected' with the chosen reflectance spectrum, 'none' when no
 * spectrum is chosen (α is then overestimated where the film reflects), or why the chosen one
 * cannot be used.
 */
export type Reflection =
  | { state: 'corrected'; name: string }
  | { state: 'none' }
  | { state: 'not-reflectance' | 'no-overlap'; name: string };

export interface SigmoidCheck {
  type: SigmoidType;
  range: [number, number] | null;
  fit: SigmoidFit | null;
}

/** The sigmoid type that matches a Tauc transition, used when the user has not chosen one. */
export const sigmoidTypeFor = (transition: TransitionId): SigmoidType =>
  transition.startsWith('direct') ? 'direct' : 'indirect';

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
  reflectance: CleanedSpectrum | null = null,
): BandGapAnalysis {
  const path = opticalPathNm(choice);
  const film = choice.sample === 'film' && path !== null && spectrum.kind !== 'reflectance';
  let reflection: Reflection | null = film ? { state: 'none' } : null;
  let reflectanceValues: Float64Array | null = null;
  if (film && reflectance) {
    const name = reflectance.spectrum.name;
    const percent =
      reflectance.spectrum.kind === 'reflectance'
        ? toQuantity(reflectance.cleaned.values, reflectance.spectrum, 'reflectance')
        : null;
    if (!percent) reflection = { state: 'not-reflectance', name };
    else {
      reflectanceValues = interpolateOnto(
        reflectance.cleaned.wavelengthNm,
        percent.map((v) => v / 100),
        cleaned.wavelengthNm,
      );
      if (reflectanceValues.some(Number.isFinite)) reflection = { state: 'corrected', name };
      else {
        reflectanceValues = null;
        reflection = { state: 'no-overlap', name };
      }
    }
  }
  const signal = absorptionSignal(
    cleaned.wavelengthNm,
    cleaned.values,
    spectrum,
    path,
    reflectanceValues,
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
        choice.component?.factor !== null && choice.component?.factor !== undefined ? path : null,
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
    ...(choice.regionRule && { regionRule: choice.regionRule }),
    ...(choice.powerBaseline && {
      baselineShape: 'power' as const,
      baselineExponent: choice.powerBaseline.exponent,
    }),
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
  const cody = choice.cody.enabled
    ? codyGap(
        signal.energyEv,
        signal.signal,
        choice.cody.region,
        choice.legacySuggestion || choice.regionRule ? 'widest' : 'steepest',
      )
    : null;
  let sigmoid: SigmoidCheck | null = null;
  if (choice.sigmoid.enabled) {
    const type = choice.sigmoid.type ?? sigmoidTypeFor(choice.transition);
    const range =
      choice.sigmoid.range ??
      (fit ? suggestSigmoidRange(signal.energyEv, signal.signal, fit.egEv) : null);
    sigmoid = {
      type,
      range,
      fit: range
        ? sigmoidGap(signal.energyEv, signal.signal, range, type, choice.sigmoid.range === null)
        : null,
    };
  }
  return {
    ...gap,
    signal,
    component: componentSignal && component ? { name: component.spectrum.name } : null,
    componentProblem,
    automatic: choice.method === null,
    comparison,
    urbach,
    derivative,
    sample: choice.sample,
    reflection,
    cody,
    sigmoid,
  };
}

/**
 * The inputs of `analyseBandGap` for one spectrum, as plain data that can be posted to the band
 * gap worker (src/workers/bandgap.worker.ts): only the fields the analysis reads.
 */
export interface BandGapJob {
  spectrum: Pick<Spectrum, 'kind' | 'scale'>;
  cleaned: Pick<Cleaned, 'wavelengthNm' | 'values'>;
  choice: BandGapChoice;
  component: CleanedSpectrum | null;
  reflectance: CleanedSpectrum | null;
}

export const runBandGapJob = (job: BandGapJob): BandGapAnalysis =>
  analyseBandGap(job.spectrum, job.cleaned, job.choice, job.component, job.reflectance);
