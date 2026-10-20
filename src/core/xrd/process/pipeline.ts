import { stepStats } from '../summary';
import type { DataMessage } from '../types';
import { ANODES, type RadiationSettings } from '../radiation';
import { anchorBackground, polynomialBackground, snipBackground } from './background';
import { stripKAlpha2 } from './kAlpha2';
import { savitzkyGolay } from './savitzkyGolay';

export type BackgroundMethod = 'polynomial' | 'snip' | 'manual';

/** Every preprocessing option. Each step can be switched off; the original data are never changed. */
export interface ProcessingSettings {
  zeroShift: {
    enabled: boolean;
    /** degrees; corrected 2θ = measured 2θ − shift */ shiftDeg: number;
  };
  smoothing: { enabled: boolean; /** points, odd */ window: number; order: number };
  background: {
    enabled: boolean;
    method: BackgroundMethod;
    /** Polynomial degree for the iterative polynomial method. */
    degree: number;
    /** SNIP clipping width in degrees 2θ (converted to points using the median step). */
    snipWidthDeg: number;
    /** Manual anchors: [2θ in degrees, intensity]. */
    anchors: [number, number][];
  };
  kAlpha2: { enabled: boolean };
  normalise: { enabled: boolean; /** highest point after processing */ target: 1 | 100 };
}

export const DEFAULT_PROCESSING: ProcessingSettings = {
  zeroShift: { enabled: false, shiftDeg: 0 },
  smoothing: { enabled: false, window: 11, order: 3 },
  background: { enabled: false, method: 'snip', degree: 4, snipWidthDeg: 2, anchors: [] },
  kAlpha2: { enabled: false },
  normalise: { enabled: false, target: 100 },
};

export type ProcessingStep = keyof ProcessingSettings;

export interface ProcessingResult {
  /** 2θ in degrees after any zero shift. */
  twoTheta: Float64Array;
  /** Data after smoothing, before background removal (what the background is drawn against). */
  beforeBackground: Float64Array;
  /** Background curve, when background removal ran. */
  background?: Float64Array;
  /** Final processed intensity. */
  intensity: Float64Array;
  /** Plain-language messages, keyed by the step they concern. */
  messages: Partial<Record<ProcessingStep, DataMessage[]>>;
}

/**
 * Runs the enabled steps in this order: zero shift, smoothing, background removal, Kα2
 * stripping, normalisation. Input: 2θ in degrees (increasing) and intensity.
 */
export function runPipeline(
  twoTheta: Float64Array,
  intensity: Float64Array,
  settings: ProcessingSettings,
  radiation: RadiationSettings,
): ProcessingResult {
  const messages: ProcessingResult['messages'] = {};
  const note = (step: ProcessingStep, level: DataMessage['level'], text: string) =>
    (messages[step] ??= []).push({ level, text });
  const step = stepStats(twoTheta);

  let x = twoTheta;
  if (settings.zeroShift.enabled && settings.zeroShift.shiftDeg !== 0) {
    const shift = settings.zeroShift.shiftDeg;
    x = twoTheta.map((v) => v - shift);
  }

  let y = intensity;
  if (settings.smoothing.enabled) {
    const { window, order } = settings.smoothing;
    if (window % 2 === 0 || window < 3 || order >= window) {
      note(
        'smoothing',
        'error',
        'The window must be an odd number of points, larger than the order.',
      );
    } else {
      y = savitzkyGolay(y, window, order);
      if (!step.uniform) {
        note(
          'smoothing',
          'warning',
          'The step size is not constant. Savitzky–Golay assumes evenly spaced points, so smoothing is approximate here.',
        );
      }
      const widthDeg = window * step.median;
      if (widthDeg > 0.5) {
        note(
          'smoothing',
          'warning',
          `The window spans ${widthDeg.toFixed(2)}°, which may flatten and broaden narrow peaks. Try a smaller window.`,
        );
      }
    }
  }
  const beforeBackground = y;

  let background: Float64Array | undefined;
  if (settings.background.enabled) {
    const b = settings.background;
    if (b.method === 'polynomial') {
      background = polynomialBackground(x, y, b.degree);
    } else if (b.method === 'snip') {
      const halfWidth = Math.max(1, Math.round(b.snipWidthDeg / step.median));
      background = snipBackground(y, halfWidth);
    } else if (b.anchors.length >= 2) {
      background = anchorBackground(x, b.anchors);
    } else {
      note(
        'background',
        'info',
        'Tap or click the plot to place at least two anchor points on the background.',
      );
    }
    if (background) {
      const bg = background;
      y = y.map((v, i) => v - (bg[i] as number));
    }
  }

  if (settings.kAlpha2.enabled) {
    if (radiation.kAlpha1Only) {
      note('kAlpha2', 'info', 'The radiation is set to Kα1 only, so there is no Kα2 to remove.');
    } else {
      const lines = ANODES[radiation.anode];
      y = stripKAlpha2(x, y, lines.kAlpha1, lines.kAlpha2, radiation.kAlpha2Ratio);
      if (!background) {
        note(
          'kAlpha2',
          'warning',
          'Kα2 stripping works best after the background is removed; otherwise the background is lowered too.',
        );
      }
    }
  }

  if (settings.normalise.enabled) {
    let max = -Infinity;
    for (const v of y) if (v > max) max = v;
    if (max > 0) {
      const scale = settings.normalise.target / max;
      y = y.map((v) => v * scale);
    } else {
      note('normalise', 'warning', 'There is no positive intensity left to normalise.');
    }
  }

  return {
    twoTheta: x,
    beforeBackground,
    ...(background && { background }),
    intensity: y,
    messages,
  };
}
