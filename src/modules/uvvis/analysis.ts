import { energyFromWavelength } from '../../core/uvvis/conversions';
import { cleanSpectrum, DEFAULT_CLEANING, lambdaMax, type Cleaned } from '../../core/uvvis/process';
import { GAP_METHODS, SUB_GAP_SHIFT_EV, type TaucGap } from '../../core/uvvis/tauc';
import type { Spectrum } from '../../core/uvvis/types';
import {
  runBandGapJob,
  type BandGapAnalysis,
  type BandGapJob,
  type CleanedSpectrum,
} from './bandGap';
import { bandGapFor, reportedTransitions, type BandGapChoice, type UvvisData } from './data';

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

export interface ResultRow {
  spectrum: Spectrum;
  /** The settings of this row: the spectrum's, with `transition` set to the row's transition. */
  choice: BandGapChoice;
  /** True for the transition in use in the Band gap step; the others are reported next to it. */
  primary: boolean;
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

/** The reflectance spectrum chosen to correct the α of a film, with its cleaned data. */
export function reflectanceFor(
  spectra: readonly Spectrum[],
  cleaned: readonly Cleaned[],
  choice: BandGapChoice,
  ownId: string,
): CleanedSpectrum | null {
  const index = spectra.findIndex((s) => s.id === choice.reflectanceId && s.id !== ownId);
  const spectrum = spectra[index];
  const clean = cleaned[index];
  return spectrum && clean ? { spectrum, cleaned: clean } : null;
}

const slim = (c: CleanedSpectrum | null): CleanedSpectrum | null =>
  c && {
    spectrum: {
      id: c.spectrum.id,
      name: c.spectrum.name,
      kind: c.spectrum.kind,
      scale: c.spectrum.scale,
    },
    cleaned: { wavelengthNm: c.cleaned.wavelengthNm, values: c.cleaned.values },
  };

/** The analysis job of one spectrum of the session with its saved settings. */
export function spectrumJob(
  data: UvvisData,
  cleaned: readonly Cleaned[],
  index: number,
  choice: BandGapChoice = bandGapFor(data, data.spectra[index]?.id ?? ''),
): BandGapJob | null {
  const spectrum = data.spectra[index];
  const clean = cleaned[index];
  if (!spectrum || !clean) return null;
  return {
    spectrum: { kind: spectrum.kind, scale: spectrum.scale },
    cleaned: { wavelengthNm: clean.wavelengthNm, values: clean.values },
    choice,
    component: slim(componentFor(data.spectra, cleaned, choice, spectrum.id)),
    reflectance: slim(reflectanceFor(data.spectra, cleaned, choice, spectrum.id)),
  };
}

/** A result row before its analysis is done, with the job that gives it. */
export type PendingRow = Omit<ResultRow, 'analysis' | 'edgeNm'> & { job: BandGapJob };

/**
 * The rows of the results table from the cleaned data: per spectrum, one for the transition in
 * use and one for each other transition chosen to be reported, each with its own fit region. The
 * cross-checks (Cody, sigmoid) belong to the spectrum and are kept on its first row only.
 */
export function resultJobs(data: UvvisData): PendingRow[] {
  const cleaned = cleanAll(data.spectra, data.cleaning);
  return data.spectra.flatMap((spectrum, i) => {
    const clean = cleaned[i] ?? spectrum;
    const saved = bandGapFor(data, spectrum.id);
    const max = lambdaMax(
      clean.wavelengthNm,
      clean.values,
      spectrum,
      data.lambdaRange.fromNm ?? -Infinity,
      data.lambdaRange.toNm ?? Infinity,
    );
    return reportedTransitions(saved).flatMap((transition, k) => {
      const choice: BandGapChoice =
        k === 0
          ? saved
          : {
              ...saved,
              transition,
              cody: { ...saved.cody, enabled: false },
              sigmoid: { ...saved.sigmoid, enabled: false },
            };
      const job = spectrumJob(data, cleaned, i, choice);
      return job ? [{ spectrum, choice, primary: k === 0, lambdaMax: max, job }] : [];
    });
  });
}

/** The result rows, given the analysis of each pending row (in the same order). */
export function rowsFrom(pending: readonly PendingRow[], analyses: readonly BandGapAnalysis[]) {
  return pending.map((row, i): ResultRow => {
    const analysis = analyses[i] as BandGapAnalysis;
    return {
      spectrum: row.spectrum,
      choice: row.choice,
      primary: row.primary,
      lambdaMax: row.lambdaMax,
      analysis,
      edgeNm: analysis.fit ? energyFromWavelength(analysis.fit.egEv) : null,
    };
  });
}

/** The result rows, analysed on this thread (see `useBandGaps` for the worker). */
export function resultRows(data: UvvisData): ResultRow[] {
  const pending = resultJobs(data);
  return rowsFrom(
    pending,
    pending.map((row) => runBandGapJob(row.job)),
  );
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
  if (analysis.baselineUncertain) {
    messages.push({
      level: 'warning',
      text: 'The background shape is not well determined by the data below the edge, so this band gap is uncertain. A measured spectrum of the scattering material (subtract a measured component) is more reliable.',
    });
  }
  if (analysis.powerSuggestion) {
    const p = analysis.powerSuggestion;
    messages.push({
      level: 'info',
      text: `The background below the edge curves: a power law a + c·E^m (m = ${p.m.toFixed(2)}, as for scattering) fits the whole range below the edge with ${((100 * p.rmsPower) / p.rmsLine).toFixed(0)} % of the residual of the straight line, and gives Eg = ${eg(p.egEv)}. You can choose it under "Baseline shape".`,
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
      text: 'No film thickness or path length is given, so the vertical axis is only proportional to (αhν)^(1/n). The band gap is not affected, but the axis has no absolute scale.',
    });
  }
  if (signal.unit === 'alpha' && analysis.sample === 'solution') {
    messages.push({
      level: 'info',
      text: 'For a solution or dispersion, α = ln(10)·A/l is the absorption coefficient of the whole liquid in the cuvette (it grows with the concentration), not that of the solid. The band gap read from the edge is not affected; the vertical axis is (αhν)^(1/n) of the solution.',
    });
  }
  const reflection = analysis.reflection;
  if (reflection?.state === 'none') {
    messages.push({
      level: 'info',
      text: 'α = ln(10)·A/t treats all light that does not pass the film as absorbed. Where the film reflects, α is therefore overestimated. Choose the reflectance spectrum of the same film to correct for it.',
    });
  } else if (reflection?.state === 'not-reflectance') {
    messages.push({
      level: 'warning',
      text: `${reflection.name} is not a reflectance spectrum, so α is not corrected for reflection. Choose the film's measured reflectance.`,
    });
  } else if (reflection?.state === 'no-overlap') {
    messages.push({
      level: 'warning',
      text: `${reflection.name} does not cover the wavelengths of this spectrum, so α is not corrected for reflection.`,
    });
  } else if (reflection?.state === 'corrected') {
    messages.push({
      level: 'info',
      text: `α is corrected for reflection with ${reflection.name}, treating the film as a free-standing slab with multiple internal reflections; the substrate is not modelled, which matters most for films thinner than about 1 µm.`,
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
