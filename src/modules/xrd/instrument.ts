import {
  fitInstrumentCurve,
  gsasToCaglioti,
  pointsNeeded,
  type CurveFit,
  type InstrumentCurve,
} from '../../core/xrd/instrument/curve';
import type { CorrectionSettings } from '../../core/xrd/instrument/correction';
import { DEFAULT_PROCESSING, type ProcessingSettings } from '../../core/xrd/process/pipeline';
import type { RadiationSettings } from '../../core/xrd/radiation';
import type { InstrumentState, StandardState, XrdData } from './data';

/** Cleaning for a standard: SNIP background, and Kα2 stripping unless the data are Kα1 only. */
export function standardProcessing(radiation: RadiationSettings): ProcessingSettings {
  return {
    ...DEFAULT_PROCESSING,
    background: { ...DEFAULT_PROCESSING.background, enabled: true },
    kAlpha2: { enabled: !radiation.kAlpha1Only },
  };
}

/** One fitted standard peak: 2θ and FWHM in degrees, with σ(FWHM) and η. */
export interface StandardPoint {
  twoTheta: number;
  fwhm: number;
  fwhmSigma: number;
  eta: number;
  included: boolean;
}

export function standardPoints(standard: StandardState): StandardPoint[] {
  const peaks = standard.peaks.fit?.regions.flatMap((r) => r.peaks) ?? [];
  return peaks.map((p, i) => ({
    twoTheta: p.center,
    fwhm: p.fwhm,
    fwhmSigma: p.sigma.fwhm,
    eta: p.eta,
    included: !standard.excluded.includes(i),
  }));
}

export interface InstrumentModel extends Omit<CorrectionSettings, 'method'> {
  /** The curve fit to the standard's peaks (standard source only). */
  fit?: CurveFit;
  points?: StandardPoint[];
}

/**
 * The instrument curve and η from the user's settings, or a plain-language message saying what
 * is still missing. 'skip' has neither.
 */
export function instrumentModel(
  instrument: InstrumentState,
): { model: InstrumentModel } | { problem: string } | { skipped: true } {
  const typedEta = () => instrument.eta;
  switch (instrument.source) {
    case 'skip':
      return { skipped: true };
    case 'constant': {
      const fwhm = instrument.constantFwhm;
      if (fwhm === null || !(fwhm > 0))
        return { problem: 'Type the instrument FWHM in degrees 2θ, or choose another option.' };
      return { model: { curve: { kind: 'constant', fwhm }, instrumentEta: typedEta } };
    }
    case 'caglioti': {
      const { u, v, w, convention } = instrument.caglioti;
      if (u === null || v === null || w === null)
        return { problem: 'Type all three Caglioti parameters U, V and W.' };
      const p = convention === 'gsas' ? gsasToCaglioti(u, v, w) : { u, v, w };
      const curve: InstrumentCurve = { kind: 'caglioti', ...p, covariance: null };
      return { model: { curve, instrumentEta: typedEta } };
    }
    case 'standard': {
      const standard = instrument.standard;
      if (!standard) return { problem: 'Load a standard pattern, or choose another option.' };
      if (!standard.peaks.fit) return { problem: "Fit the standard's peaks." };
      const points = standardPoints(standard);
      const used = points.filter((p) => p.included);
      const fit = fitInstrumentCurve(used, standard.curve);
      if (!fit) {
        return {
          problem: `Include at least ${pointsNeeded(standard.curve)} standard peaks at different angles for this curve.`,
        };
      }
      const options = standard.peaks.fitOptions;
      const meanEta = used.reduce((s, p) => s + p.eta, 0) / used.length;
      const eta =
        options.profile === 'gaussian'
          ? 0
          : options.profile === 'lorentzian'
            ? 1
            : (options.fixedEta ?? meanEta);
      const angles = used.map((p) => p.twoTheta);
      return {
        model: {
          curve: fit.curve,
          instrumentEta: () => eta,
          coveredRange: [Math.min(...angles), Math.max(...angles)],
          fit,
          points,
        },
      };
    }
  }
}

/** Wizard validation for the instrument step. */
export function instrumentProblem(data: XrdData): string | null {
  const result = instrumentModel(data.instrument);
  return 'problem' in result ? result.problem : null;
}
