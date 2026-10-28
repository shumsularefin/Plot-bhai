import { SOFTWARE } from '../../ui/software';
import groups from '../../../data/ftir/groups.json';
import { ftirMethodsParagraph, type FtirMethodsInput } from '../../core/ftir/methods';
import { DEFAULT_FTIR_PROCESSING } from '../../core/ftir/process';
import { bandArea } from '../../core/ftir/bands';
import { bandsFor, peaksFor, processingFor, type FtirData } from './data';
import { processAll } from './analysis';
import { peakRows } from './analysis';
import { shownQuantity } from './quantity';

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(data: FtirData): FtirMethodsInput {
  const rows = peakRows(data);
  const processed = processAll(data.spectra, data.processing);
  return {
    software: SOFTWARE,
    allSynthetic: data.spectra.length > 0 && data.spectra.every((s) => s.synthetic),
    digitized: data.spectra.filter((s) => s.source === 'digitized').length,
    spectra: data.spectra.map((s, i) => {
      const p = data.processing[s.id] ?? DEFAULT_FTIR_PROCESSING;
      const bands = bandsFor(data, s.id);
      const result = bands.fit.result;
      const fit =
        result && result.key === JSON.stringify(processingFor(data, s.id)) ? result.fit : null;
      const curve = processed[i];
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
        fit: fit
          ? {
              fromCm: fit.start,
              toCm: fit.end,
              profile: bands.fit.profile,
              bands: fit.peaks.length,
              rSquared: fit.rSquared,
              fromDerivative: bands.derivative.used
                ? { window: bands.derivative.window, order: bands.derivative.order }
                : null,
            }
          : null,
        areas: curve
          ? bands.areas.ranges.filter(
              (r) =>
                r.fromCm !== null &&
                r.toCm !== null &&
                bandArea(curve.wavenumber, curve.absorbance, r.fromCm, r.toCm) !== null,
            ).length
          : 0,
      };
    }),
    differences: data.spectra.filter((s) => s.source === 'computed').length,
    toleranceCm: data.toleranceCm,
    rangeSource: `${groups.source.citation}, doi:${groups.source.doi}`,
    shown: shownQuantity(data, data.spectra).quantity,
  };
}

export const methodsText = (data: FtirData): string => ftirMethodsParagraph(methodsInput(data));
