import { energyFromWavelength } from '../../core/uvvis/conversions';
import { cleanSpectrum, DEFAULT_CLEANING, lambdaMax, type Cleaned } from '../../core/uvvis/process';
import {
  absorptionSignal,
  compareTransitions,
  derivativeMaximum,
  fitBandGap,
  suggestRegion,
  suggestUrbachRegion,
  TRANSITIONS,
  taucValues,
  urbachFit,
  type AbsorptionSignal,
  type BandGapFit,
  type DerivativePeak,
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

export interface BandGapAnalysis {
  signal: AbsorptionSignal;
  /** The Tauc quantity for the chosen transition. */
  tauc: Float64Array;
  /** Fit region in use (the user's, or the suggestion) and whether it is the suggestion. */
  region: [number, number] | null;
  suggested: boolean;
  fit: BandGapFit | null;
  comparison: TransitionComparison[];
  urbach: { region: [number, number] | null; fit: UrbachFit | null } | null;
  derivative: DerivativePeak | null;
}

/** All band gap numbers of one cleaned spectrum under its settings. */
export function analyseBandGap(
  spectrum: Pick<Spectrum, 'kind' | 'scale'>,
  cleaned: Pick<Cleaned, 'wavelengthNm' | 'values'>,
  choice: BandGapChoice,
): BandGapAnalysis {
  const signal = absorptionSignal(
    cleaned.wavelengthNm,
    cleaned.values,
    spectrum,
    choice.thicknessNm,
  );
  const tauc = taucValues(signal.energyEv, signal.signal, TRANSITIONS[choice.transition].exponent);
  const own = choice.regions[choice.transition];
  const region = own ?? suggestRegion(signal.energyEv, tauc);
  const fit = region ? fitBandGap(signal.energyEv, tauc, region[0], region[1]) : null;
  const comparison = compareTransitions(signal.energyEv, signal.signal, choice.regions);

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
    signal,
    tauc,
    region,
    suggested: own === undefined,
    fit,
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

/** One result row per spectrum, from the cleaned data. */
export function resultRows(data: UvvisData): ResultRow[] {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  return data.spectra.map((spectrum, i) => {
    const clean = cleaned[i] ?? spectrum;
    const choice = bandGapFor(data, spectrum.id);
    const analysis = analyseBandGap(spectrum, clean, choice);
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
        text: `The fitted line meets the energy axis at ${eV(fit.egEv)}, inside the fit region (it starts at ${eV(fit.fromEv)}). Check the region.`,
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
