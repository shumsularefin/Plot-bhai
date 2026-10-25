import groups from '../../../data/ftir/groups.json';
import { ftirMethodsParagraph, type FtirMethodsInput } from '../../core/ftir/methods';
import { DEFAULT_FTIR_PROCESSING } from '../../core/ftir/process';
import { peaksFor, type FtirData } from './data';
import { peakRows } from './analysis';
import { shownQuantity } from './quantity';

const SOFTWARE = 'XRD Toolkit (free, runs in the browser; version not recorded)';

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(data: FtirData): FtirMethodsInput {
  const rows = peakRows(data);
  return {
    software: SOFTWARE,
    allSynthetic: data.spectra.length > 0 && data.spectra.every((s) => s.synthetic),
    spectra: data.spectra.map((s) => {
      const p = data.processing[s.id] ?? DEFAULT_FTIR_PROCESSING;
      const own = rows.filter((r) => r.spectrum.id === s.id);
      return {
        kind: s.kind,
        baseline: p.baseline.enabled
          ? {
              method: p.baseline.method,
              degree: p.baseline.degree,
              logLambda: p.baseline.logLambda,
              p: p.baseline.p,
            }
          : null,
        smoothing: p.smoothing.enabled
          ? { window: p.smoothing.window, order: p.smoothing.order }
          : null,
        normalise: p.normalise.enabled ? p.normalise.method : null,
        prominencePercent: own.length > 0 ? peaksFor(data, s.id).prominencePercent : null,
        assignments: own.filter((r) => r.assignment !== '').length,
      };
    }),
    toleranceCm: data.toleranceCm,
    rangeSource: `${groups.source.citation}, doi:${groups.source.doi}`,
    shown: shownQuantity(data, data.spectra).quantity,
  };
}

export const methodsText = (data: FtirData): string => ftirMethodsParagraph(methodsInput(data));
