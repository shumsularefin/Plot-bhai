import { derivativeBands, secondDerivative } from '../ftir/bands';
import { nearestMaximum, peakAt, pickPeaks } from '../ftir/peaks';
import { energyFromWavelength } from './conversions';

/*
 * Absorption bands of a UV-Vis spectrum, with the peak picker of the FTIR tool (src/core/ftir/peaks.ts)
 * run on the wavelength axis. The values y are the absorbance A or, for diffuse reflectance, the
 * Kubelka–Munk function F(R), on increasing wavelengths in nm.
 */

/** Peak picking settings of one spectrum. */
export interface UvvisPeakSettings {
  /** Smallest prominence to keep, percent of the highest minus the lowest value in the range. */
  prominencePercent: number;
  /** Search range, nm; null means the end of the spectrum. */
  fromNm: number | null;
  toNm: number | null;
  /** Savitzky–Golay window (odd number of points) of the second derivative for shoulders. */
  shoulderWindow: number;
}

/**
 * Defaults of my own choosing, adjustable on screen: 5 % as in the FTIR tool, and a 15-point cubic
 * window, a few nanometres at the usual 0.5 to 2 nm step, narrower than UV-Vis bands.
 */
export const DEFAULT_UVVIS_PEAKS: UvvisPeakSettings = {
  prominencePercent: 5,
  fromNm: null,
  toNm: null,
  shoulderWindow: 15,
};

/** A band added by hand, or a second-derivative shoulder the user accepted. */
export interface UvvisHandPeak {
  id: string;
  wavelengthNm: number;
  shoulder: boolean;
}

/** Hand edits, kept by position so that they survive a change of the cleaning. */
export interface UvvisPeakEdits {
  added: UvvisHandPeak[];
  /** Positions of picked bands the user removed, nm. */
  removed: number[];
}

export const NO_UVVIS_EDITS: UvvisPeakEdits = { added: [], removed: [] };

/**
 * A click within this distance (nm) of a local maximum adds the band at the maximum, and a removed
 * position hides the picked band nearest to it within this distance. My own choice: UV-Vis bands are
 * tens of nanometres wide, and blank subtraction, offset and smoothing move a maximum by less.
 */
export const SNAP_NM = 5;

export interface UvvisPeak {
  /** Position of the maximum (parabola vertex through the highest three points), nm. */
  wavelengthNm: number;
  /** The same position as a photon energy E = hc/λ, eV. */
  energyEv: number;
  /** A or F(R) at the highest data point. */
  value: number;
  /** Height above the higher of the two surrounding valleys; 0 for a shoulder. */
  prominence: number;
  /** Value as a percentage of the highest band in the table. */
  relative: number;
  origin: 'picked' | 'hand' | 'shoulder';
  handId?: string;
}

function range(x: Float64Array, y: Float64Array, settings: UvvisPeakSettings) {
  const from = settings.fromNm ?? -Infinity;
  const to = settings.toNm ?? Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const v = y[i] as number;
    const w = x[i] as number;
    if (w < from || w > to || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { from, to, lo, hi };
}

/**
 * Bands of one spectrum: local maxima whose prominence is at least the chosen percentage of the
 * value range in the search range, less the ones removed by hand (one picked band per removed
 * position, the nearest within SNAP_NM), plus those added by hand (at the nearest maximum within
 * SNAP_NM, or where clicked) and accepted shoulders. Increasing wavelength. NaN values (for example
 * F(R) where R = 0) are skipped: they never form a maximum.
 */
export function uvvisPeaks(
  x: Float64Array,
  y: Float64Array,
  settings: UvvisPeakSettings,
  edits: UvvisPeakEdits = NO_UVVIS_EDITS,
): UvvisPeak[] {
  const { from, to, lo, hi } = range(x, y, settings);
  if (!(hi > lo)) return [];
  const picked = pickPeaks(x, y, {
    minProminence: ((hi - lo) * settings.prominencePercent) / 100,
    fromCm: from,
    toCm: to,
  });
  const hidden = new Set<number>();
  for (const at of edits.removed) {
    let best = -1;
    for (let k = 0; k < picked.length; k++) {
      if (hidden.has(k)) continue;
      const d = Math.abs((picked[k]?.wavenumber as number) - at);
      if (d <= SNAP_NM && (best < 0 || d < Math.abs((picked[best]?.wavenumber as number) - at)))
        best = k;
    }
    if (best >= 0) hidden.add(best);
  }
  const step = x.length > 1 ? ((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1) : 0;
  const peaks: Omit<UvvisPeak, 'relative' | 'energyEv'>[] = picked
    .filter((_, k) => !hidden.has(k))
    .map((p) => ({
      wavelengthNm: p.wavenumber,
      value: p.height,
      prominence: p.prominence,
      origin: 'picked',
    }));
  for (const hand of edits.added) {
    const at = hand.shoulder
      ? hand.wavelengthNm
      : (nearestMaximum(x, y, hand.wavelengthNm, SNAP_NM) ?? hand.wavelengthNm);
    if (peaks.some((p) => Math.abs(p.wavelengthNm - at) <= Math.abs(step))) continue;
    const p = peakAt(x, y, at);
    if (!p) continue;
    peaks.push({
      wavelengthNm: at,
      value: p.height,
      prominence: hand.shoulder ? 0 : p.prominence,
      origin: hand.shoulder ? 'shoulder' : 'hand',
      handId: hand.id,
    });
  }
  peaks.sort((a, b) => a.wavelengthNm - b.wavelengthNm);
  const top = peaks.reduce((m, p) => Math.max(m, p.value), 0);
  return peaks.map((p) => ({
    ...p,
    energyEv: energyFromWavelength(p.wavelengthNm),
    relative: top > 0 ? (100 * p.value) / top : 0,
  }));
}

/** Order of the polynomial of the shoulder search (cubic, as in the FTIR tool). */
const SHOULDER_ORDER = 3;
/** Smallest second-derivative minimum kept, percent of the deepest (as in the FTIR tool). */
const SHOULDER_DEPTH = 5;

/**
 * Possible shoulders: minima of the second derivative d²y/dλ² (Savitzky–Golay, see
 * src/core/ftir/bands.ts) in the search range with no band of the table within SNAP_NM. Suggestions
 * only, since noise also makes minima. Empty when the wavelengths are not evenly spaced.
 */
export function shoulderSuggestions(
  x: Float64Array,
  y: Float64Array,
  settings: UvvisPeakSettings,
  peaks: readonly Pick<UvvisPeak, 'wavelengthNm'>[],
): number[] {
  if (y.some((v) => !Number.isFinite(v))) return [];
  const d2 = secondDerivative(x, y, settings.shoulderWindow, SHOULDER_ORDER);
  if (!d2) return [];
  return derivativeBands(
    x,
    d2,
    SHOULDER_DEPTH,
    settings.fromNm ?? undefined,
    settings.toNm ?? undefined,
  )
    .map((b) => b.wavenumber)
    .filter((nm) => !peaks.some((p) => Math.abs(p.wavelengthNm - nm) <= SNAP_NM));
}
