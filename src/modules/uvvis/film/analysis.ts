import {
  absorbanceFromPercentT,
  mapValues,
  percentTFromAbsorbance,
} from '../../../core/uvvis/conversions';
import {
  findExtrema,
  substrateIndex,
  swanepoel,
  type Extremum,
  type SwanepoelOutcome,
} from '../../../core/uvvis/swanepoel';
import type { Spectrum } from '../../../core/uvvis/types';
import type { FilmData } from './data';

/** Absorbance of a spectrum (A = 2 − log₁₀ %T for transmittance); null for reflectance. */
export function absorbanceOf(s: Spectrum): Float64Array | null {
  if (s.kind === 'absorbance') return s.values;
  if (s.kind === 'reflectance') return null;
  return mapValues(s.values, (v) => absorbanceFromPercentT(s.scale === 'percent' ? v : 100 * v));
}

/** Transmittance as a fraction (T = 10^−A for absorbance); null for reflectance. */
export function transmittanceOf(s: Spectrum): Float64Array | null {
  if (s.kind === 'transmittance')
    return s.scale === 'percent' ? s.values.map((v) => v / 100) : s.values;
  if (s.kind === 'reflectance') return null;
  return mapValues(s.values, (a) => percentTFromAbsorbance(a) / 100);
}

/** The part of the spectrum inside [fromNm, toNm] (either may be null for the end). */
export function cut(
  x: Float64Array,
  y: Float64Array,
  fromNm: number | null,
  toNm: number | null,
): { x: Float64Array; y: Float64Array } {
  const lo = Math.min(fromNm ?? -Infinity, toNm ?? Infinity);
  const hi = Math.max(fromNm ?? -Infinity, toNm ?? Infinity);
  const keep: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number;
    if (v >= lo && v <= hi && Number.isFinite(y[i])) keep.push(i);
  }
  return {
    x: Float64Array.from(keep, (i) => x[i] as number),
    y: Float64Array.from(keep, (i) => y[i] as number),
  };
}

/** Why step 1 is not complete, or null. */
export function uploadProblem(data: FilmData): string | null {
  const s = data.spectrum;
  if (!s) return 'Load a spectrum, or press Try with example data.';
  if (s.kind === 'reflectance') {
    return 'This needs an absorbance or transmittance spectrum, not reflectance.';
  }
  return null;
}

/** The substrate index from the settings, or null when it is missing or impossible. */
export function substrateOf(data: FilmData): number | null {
  const st = data.swanepoel;
  if (st.substrateBy === 'index') {
    return st.substrateIndex !== null && st.substrateIndex > 1 ? st.substrateIndex : null;
  }
  return st.substrateTPct === null ? null : substrateIndex(st.substrateTPct / 100);
}

export interface SwanepoelView {
  x: Float64Array;
  t: Float64Array;
  extrema: Extremum[];
  outcome: SwanepoelOutcome;
}

/** Extrema and the Swanepoel result for the saved settings; null without a usable spectrum. */
export function swanepoelView(data: FilmData): SwanepoelView | null {
  const s = data.spectrum;
  const t = s ? transmittanceOf(s) : null;
  if (!s || !t) return null;
  const part = cut(s.wavelengthNm, t, data.swanepoel.fromNm, data.swanepoel.toNm);
  const extrema = findExtrema(part.x, part.y, data.swanepoel.prominencePct / 100);
  const sub = substrateOf(data);
  const outcome: SwanepoelOutcome =
    sub === null
      ? { ok: false, error: 'Give the substrate refractive index (above 1) or its transmittance.' }
      : swanepoel(sub, extrema);
  return { x: part.x, t: part.y, extrema, outcome };
}

/** Key of the plasmon settings and data a fit was made with, to tell when it is out of date. */
export const plasmonKey = (data: FilmData): string =>
  JSON.stringify([
    data.spectrum?.id,
    data.plasmon.fromNm,
    data.plasmon.toNm,
    data.plasmon.centresNm,
    data.plasmon.profile,
  ]);
