import { SOFTWARE } from '../../ui/software';
import { uvvisMethodsParagraph, type UvvisMethodsInput } from '../../core/uvvis/methods';
import { DEFAULT_CLEANING } from '../../core/uvvis/process';
import { uvvisPeaks } from '../../core/uvvis/peaks';
import { baselineUsed, cleanAll, resultRows } from './analysis';
import { bandFitKey, bandSignal } from './bands';
import { bandFitFor, peakEditsFor, peaksFor, type UvvisData } from './data';

const PROFILE_NAMES = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  'pseudo-voigt': 'pseudo-Voigt',
} as const;

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(data: UvvisData): UvvisMethodsInput {
  const all = resultRows(data);
  const rows = all.filter((r) => r.primary);
  const cleaned = cleanAll(data.spectra, data.cleaning);
  return {
    software: SOFTWARE,
    allSynthetic: data.spectra.length > 0 && data.spectra.every((s) => s.synthetic),
    digitized: data.spectra.filter((s) => s.source === 'digitized').length,
    spectra: rows.map(({ spectrum, choice, analysis }) => {
      const cleaning = data.cleaning[spectrum.id] ?? DEFAULT_CLEANING;
      const index = data.spectra.indexOf(spectrum);
      const clean = cleaned[index] ?? spectrum;
      const signal = bandSignal(spectrum, clean);
      const settings = peaksFor(data, spectrum.id);
      const peaks = uvvisPeaks(signal.x, signal.y, settings, peakEditsFor(data, spectrum.id));
      const fit = bandFitFor(data, spectrum.id);
      const fitted =
        fit.result && fit.result.key === bandFitKey(data, spectrum.id) ? fit.result.fit : null;
      return {
        name: spectrum.name,
        kind: spectrum.kind,
        cleaning: {
          blank: cleaning.blank.enabled && cleaning.blank.blankId !== null,
          offset: cleaning.offset.enabled
            ? { fromNm: cleaning.offset.fromNm, toNm: cleaning.offset.toNm }
            : null,
          smoothing: cleaning.smoothing.enabled
            ? { window: cleaning.smoothing.window, order: cleaning.smoothing.order }
            : null,
        },
        transition: choice.transition,
        fitted: analysis.fit !== null,
        gapMethod: analysis.method,
        baselineEv: baselineUsed(analysis),
        powerBaseline: analysis.powerBaseline
          ? {
              m: analysis.powerBaseline.m,
              mSigma: analysis.powerBaseline.mFixed
                ? null
                : Math.sqrt(analysis.powerBaseline.covariance[2]?.[2] ?? NaN),
            }
          : null,
        component:
          analysis.component && analysis.componentFactor
            ? {
                name: analysis.component.name,
                factor: analysis.componentFactor.value,
                fitted: analysis.componentFactor.n > 0,
              }
            : null,
        sample: choice.sample,
        thicknessNm: choice.thicknessNm,
        pathCm: choice.pathCm,
        reflectance: analysis.reflection?.state === 'corrected' ? analysis.reflection.name : null,
        urbach: choice.urbach.enabled && analysis.urbach?.fit != null,
        derivative: analysis.derivative ? choice.derivative : 'off',
        alsoReported: all
          .filter((r) => r.spectrum === spectrum && !r.primary && r.analysis.fit)
          .map((r) => r.choice.transition),
        cody: analysis.cody?.fit ? [analysis.cody.fit.fromEv, analysis.cody.fit.toEv] : null,
        sigmoid: analysis.sigmoid?.fit
          ? {
              type: analysis.sigmoid.fit.type,
              fromEv: analysis.sigmoid.fit.fromEv,
              toEv: analysis.sigmoid.fit.toEv,
            }
          : null,
        bands: {
          count: peaks.length,
          prominencePercent: settings.prominencePercent,
          shoulders: peaks.filter((p) => p.origin === 'shoulder').length,
          hand: peaks.filter((p) => p.origin === 'hand').length,
        },
        bandFit:
          fitted && fit.fromNm !== null && fit.toNm !== null
            ? {
                profile: PROFILE_NAMES[fit.profile],
                fromNm: Math.min(fit.fromNm, fit.toNm),
                toNm: Math.max(fit.fromNm, fit.toNm),
                count: fitted.peaks.length,
              }
            : null,
      };
    }),
  };
}

export const methodsText = (data: UvvisData): string => uvvisMethodsParagraph(methodsInput(data));
