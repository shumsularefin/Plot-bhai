import type { DataMessage } from '../types';
import { instrumentWidth, type InstrumentCurve } from './curve';
import { splitVoigt, tchFwhm } from './voigt';

/*
 * Removing the instrument's contribution from an observed peak width.
 *
 * An observed peak is the sample profile convolved with the instrument profile. For the two
 * pure shapes the widths combine exactly:
 *   Gaussian ⊗ Gaussian:     B² = β² + b²   ⇒  β = √(B² − b²)
 *   Lorentzian ⊗ Lorentzian: B  = β + b     ⇒  β = B − b
 * with B the observed FWHM, b the instrument FWHM and β the sample FWHM (all degrees 2θ).
 *
 * Approximate Voigt: each pseudo-Voigt (FWHM, η) is split into Gaussian and Lorentzian
 * widths with the Thompson–Cox–Hastings relations (voigt.ts). The Gaussian parts are corrected
 * in quadrature, the Lorentzian parts linearly, and the two sample parts are joined again:
 *   β_G = √(B_G² − b_G²),  β_L = B_L − b_L,  β = TCH(β_G, β_L).
 * It is approximate because a pseudo-Voigt is only close to a true Voigt.
 */

export type CorrectionMethod = 'gaussian' | 'lorentzian' | 'voigt';

/**
 * Above this fraction b / B the corrected width is flagged: at b / B = 0.8 the Gaussian
 * correction turns a 1 % error in b into a 1.8 % error in β (∂ln β / ∂ln b = −b² / β²),
 * and the amplification grows quickly beyond that.
 */
export const RESOLUTION_LIMIT_RATIO = 0.8;

const LIMITED_TEXT = 'Limited by instrument resolution, size is a lower limit.';

/**
 * Sample FWHM β (degrees 2θ) from observed FWHM B and instrument FWHM b. etaObserved and
 * etaInstrument (0–1) are used only by the Voigt method. Returns 0 when nothing is left
 * after the correction. `clipped` names a Voigt component that would have been negative and
 * was set to 0.
 */
export function correctWidth(
  observed: number,
  instrument: number,
  method: CorrectionMethod,
  etaObserved = 0,
  etaInstrument = 0,
): { width: number; clipped: 'gaussian' | 'lorentzian' | null } {
  if (method === 'gaussian') {
    const d = observed ** 2 - instrument ** 2;
    return { width: d > 0 ? Math.sqrt(d) : 0, clipped: null };
  }
  if (method === 'lorentzian') return { width: Math.max(0, observed - instrument), clipped: null };
  const o = splitVoigt(observed, etaObserved);
  const i = splitVoigt(instrument, etaInstrument);
  const g2 = o.gaussian ** 2 - i.gaussian ** 2;
  const l = o.lorentzian - i.lorentzian;
  if (g2 <= 0 && l <= 0) return { width: 0, clipped: null };
  const clipped = g2 < 0 ? 'gaussian' : l < 0 ? 'lorentzian' : null;
  return { width: tchFwhm(Math.sqrt(Math.max(0, g2)), Math.max(0, l)), clipped };
}

/** A fitted sample peak. Angles and widths in degrees 2θ. */
export interface ObservedPeak {
  twoTheta: number;
  fwhm: number;
  fwhmSigma: number;
  eta: number;
}

export interface CorrectedPeak {
  twoTheta: number;
  observed: number;
  observedSigma: number;
  instrument: number;
  instrumentSigma: number;
  /** Sample FWHM after correction, degrees 2θ. NaN when no width is left or b is unknown. */
  corrected: number;
  correctedSigma: number;
  /** b / B. */
  ratio: number;
  /** Instrument resolution limits this peak, so a size from it is only a lower limit. */
  limited: boolean;
  messages: DataMessage[];
}

export interface CorrectionSettings {
  curve: InstrumentCurve;
  method: CorrectionMethod;
  /** Instrument Lorentzian fraction η (0–1) for the Voigt method, as a function of 2θ. */
  instrumentEta: (twoTheta: number) => number;
  /** 2θ range covered by the standard's peaks; outside it the curve is extrapolated. */
  coveredRange?: readonly [number, number];
}

/**
 * Corrects every peak. σ(β) combines σ(B) and σ(b) as independent uncertainties, using
 * numerical derivatives ∂β/∂B and ∂β/∂b. The uncertainty of the instrument η is not included.
 */
export function correctPeaks(
  peaks: readonly ObservedPeak[],
  settings: CorrectionSettings,
): CorrectedPeak[] {
  const { curve, method, instrumentEta, coveredRange } = settings;
  return peaks.map((peak) => {
    const b = instrumentWidth(curve, peak.twoTheta);
    const etaI = instrumentEta(peak.twoTheta);
    const B = peak.fwhm;
    const messages: DataMessage[] = [];
    const base = {
      twoTheta: peak.twoTheta,
      observed: B,
      observedSigma: peak.fwhmSigma,
      instrument: b.fwhm,
      instrumentSigma: b.sigma,
    };
    if (!Number.isFinite(b.fwhm)) {
      return {
        ...base,
        corrected: NaN,
        correctedSigma: NaN,
        ratio: NaN,
        limited: false,
        messages: [
          {
            level: 'error',
            text: 'The instrument curve gives no valid width at this angle, so this peak cannot be corrected.',
          },
        ],
      };
    }
    const at = (obs: number, ins: number) => correctWidth(obs, ins, method, peak.eta, etaI);
    const result = at(B, b.fwhm);
    const ratio = b.fwhm / B;
    let corrected = NaN;
    let correctedSigma = NaN;
    let limited = false;
    if (result.width > 0) {
      corrected = result.width;
      const h = 1e-6 * B;
      const dB = (at(B + h, b.fwhm).width - at(B - h, b.fwhm).width) / (2 * h);
      const db = (at(B, b.fwhm + h).width - at(B, b.fwhm - h).width) / (2 * h);
      correctedSigma = Math.hypot(dB * peak.fwhmSigma, db * b.sigma);
      if (ratio >= RESOLUTION_LIMIT_RATIO) {
        limited = true;
        messages.push({
          level: 'warning',
          text: `${LIMITED_TEXT} The instrument accounts for ${Math.round(100 * ratio)} % of the observed width, so small errors in either width change the corrected width a lot.`,
        });
      }
    } else {
      limited = true;
      messages.push({
        level: 'warning',
        text: `${LIMITED_TEXT} The instrument width is as large as the observed width, so no sample broadening can be measured.`,
      });
    }
    if (result.clipped) {
      messages.push({
        level: 'info',
        text: `The ${result.clipped === 'gaussian' ? 'Gaussian' : 'Lorentzian'} part of the instrument width is larger than that of this peak, so the sample's ${result.clipped} part was set to zero. The peak shape (η) of the sample and the instrument may not match.`,
      });
    }
    if (coveredRange && (peak.twoTheta < coveredRange[0] || peak.twoTheta > coveredRange[1])) {
      messages.push({
        level: 'warning',
        text: `This peak lies outside the standard's peaks (${coveredRange[0].toFixed(1)}–${coveredRange[1].toFixed(1)}°), so the instrument width here is extrapolated.`,
      });
    }
    return { ...base, corrected, correctedSigma, ratio, limited, messages };
  });
}
