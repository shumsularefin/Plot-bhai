import { pickPeaks } from '../ftir/peaks';
import { interpolate } from '../thermal/process';

/*
 * Refractive index and thickness of a thin film on a thick transparent substrate from the
 * interference fringes of its transmittance, after Swanepoel R., Determination of the thickness
 * and optical constants of amorphous silicon, J. Phys. E: Sci. Instrum. 16 (1983) 1214–1222.
 * Equation numbers below are the paper's (checked against it): (1) and (2) substrate, (3)
 * 2 n d = m λ, (11) film index, (23) thickness from adjacent extrema. Transmittance T is a
 * fraction (0 to 1), wavelength λ and thickness d in nm, refractive indices dimensionless.
 */

/**
 * Refractive index of a non-absorbing substrate from its own transmittance Ts (fraction), from
 * Ts = 2s / (s² + 1) (eq. 1): s = 1/Ts + √(1/Ts² − 1) (eq. 2). Null unless 0 < Ts ≤ 1.
 */
export function substrateIndex(ts: number): number | null {
  if (!(ts > 0 && ts <= 1)) return null;
  return 1 / ts + Math.sqrt(1 / (ts * ts) - 1);
}

/**
 * Film index from the two envelopes at one wavelength (transparent and weak absorption region):
 *   N = 2s (T_M − T_m) / (T_M T_m) + (s² + 1) / 2,   n = √(N + √(N² − s²))   (eq. 11).
 * Null when N² < s².
 */
export function filmIndex(tMax: number, tMin: number, s: number): number | null {
  const N = (2 * s * (tMax - tMin)) / (tMax * tMin) + (s * s + 1) / 2;
  const under = N * N - s * s;
  return under >= 0 ? Math.sqrt(N + Math.sqrt(under)) : null;
}

export interface Extremum {
  wavelengthNm: number;
  t: number;
  kind: 'max' | 'min';
}

/**
 * Fringe maxima and minima of a transmittance spectrum: local maxima of T and of −T whose
 * prominence is at least `minProminence` (fraction of transmittance), in order of increasing λ.
 */
export function findExtrema(
  wavelengthNm: Float64Array,
  t: Float64Array,
  minProminence: number,
): Extremum[] {
  const max = pickPeaks(wavelengthNm, t, { minProminence });
  const min = pickPeaks(
    wavelengthNm,
    t.map((v) => -v),
    { minProminence },
  );
  return [
    ...max.map((p) => ({ wavelengthNm: p.wavenumber, t: p.height, kind: 'max' as const })),
    ...min.map((p) => ({ wavelengthNm: p.wavenumber, t: -p.height, kind: 'min' as const })),
  ].sort((a, b) => a.wavelengthNm - b.wavelengthNm);
}

export interface SwanepoelRow {
  wavelengthNm: number;
  kind: 'max' | 'min';
  /** Envelopes at this wavelength (one of them is the extremum itself). */
  tMax: number;
  tMin: number;
  /** First index from the envelopes. */
  n1: number;
  /** Order number m (integer at maxima, half-integer at minima). */
  m: number;
  /** Thickness from this extremum, m λ / (2 n₁). */
  d: number;
  /** Index refined with the order number and the mean thickness, m λ / (2 d̄₂). */
  n2: number;
}

export interface SwanepoelResult {
  rows: SwanepoelRow[];
  /** Mean thickness from adjacent pairs (first estimate) and from the order numbers, with standard deviations. */
  d1: number;
  d1Sd: number;
  d2: number;
  d2Sd: number;
  notes: string[];
}

export type SwanepoelOutcome = { ok: true; result: SwanepoelResult } | { ok: false; error: string };

const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const sd = (v: readonly number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

/**
 * Envelope method. At each extremum the other envelope is interpolated linearly between the
 * neighbouring extrema of the other kind (Swanepoel suggests a smoother interpolation, so the
 * envelopes here are a little less accurate where the fringes are far apart), and n₁ follows from
 * filmIndex. A first thickness comes from each pair of adjacent extrema of the same kind (two
 * neighbouring maxima, or two neighbouring minima, whose orders differ by 1),
 *   d = λ₁ λ₂ / [2 (λ₁ n₂ − λ₂ n₁)]   (λ₁ > λ₂; eq. 23),
 * and d̄₁ is their mean. Order numbers follow from 2 n d = m λ: adjacent extrema differ by ½, so
 * one series m_k = m₀ + k/2 (k counted from the longest wavelength) is chosen, with m₀ an integer
 * at a maximum and a half-integer at a minimum, closest in least squares to 2 n₁ d̄₁ / λ. Then
 * d = m λ / (2 n₁) at each extremum, d̄₂ is their mean, and n₂ = m λ / (2 d̄₂).
 */
export function swanepoel(substrate: number, extrema: readonly Extremum[]): SwanepoelOutcome {
  const maxima = extrema.filter((e) => e.kind === 'max');
  const minima = extrema.filter((e) => e.kind === 'min');
  if (maxima.length < 2 || minima.length < 2) {
    return {
      ok: false,
      error:
        'At least two maxima and two minima are needed. Lower the prominence, or widen the range to include more fringes.',
    };
  }
  const envelope = (list: Extremum[], at: number) =>
    at < (list[0] as Extremum).wavelengthNm || at > (list[list.length - 1] as Extremum).wavelengthNm
      ? null
      : interpolate(
          list.map((e) => e.wavelengthNm),
          list.map((e) => e.t),
          at,
        );
  const used: { e: Extremum; tMax: number; tMin: number; n1: number }[] = [];
  for (const e of extrema) {
    const tMax = e.kind === 'max' ? e.t : envelope(maxima, e.wavelengthNm);
    const tMin = e.kind === 'min' ? e.t : envelope(minima, e.wavelengthNm);
    if (tMax === null || tMin === null || !(tMax > tMin)) continue;
    const n1 = filmIndex(tMax, tMin, substrate);
    if (n1 !== null) used.push({ e, tMax, tMin, n1 });
  }
  // Longest wavelength first (lowest order).
  used.sort((a, b) => b.e.wavelengthNm - a.e.wavelengthNm);
  if (used.length < 3) {
    return {
      ok: false,
      error: 'Too few extrema lie between both envelopes. Include more fringes.',
    };
  }
  const alternate = used.every((u, k) => k === 0 || u.e.kind !== used[k - 1]?.e.kind);
  if (!alternate) {
    return {
      ok: false,
      error:
        'The maxima and minima found do not alternate, so a fringe was missed or a bump counted twice. Change the prominence, or smooth the spectrum.',
    };
  }
  const pairs: number[] = [];
  for (let k = 0; k + 2 < used.length; k++) {
    const a = used[k] as (typeof used)[number];
    const b = used[k + 2] as (typeof used)[number];
    const l1 = a.e.wavelengthNm;
    const l2 = b.e.wavelengthNm;
    const d = (l1 * l2) / (2 * (l1 * b.n1 - l2 * a.n1));
    if (d > 0 && Number.isFinite(d)) pairs.push(d);
  }
  if (pairs.length === 0) {
    return {
      ok: false,
      error: 'No pair of neighbouring maxima or minima gives a positive thickness.',
    };
  }
  const d1 = mean(pairs);
  const m0 = used.map((u, k) => (2 * u.n1 * d1) / u.e.wavelengthNm - k / 2);
  const firstIsMax = (used[0] as (typeof used)[number]).e.kind === 'max';
  const base = mean(m0);
  const mBase = firstIsMax ? Math.round(base) : Math.round(base - 0.5) + 0.5;
  const rows0 = used.map((u, k) => {
    const m = mBase + k / 2;
    return { u, m, d: (m * u.e.wavelengthNm) / (2 * u.n1) };
  });
  const d2 = mean(rows0.map((r) => r.d));
  const rows: SwanepoelRow[] = rows0.map(({ u, m, d }) => ({
    wavelengthNm: u.e.wavelengthNm,
    kind: u.e.kind,
    tMax: u.tMax,
    tMin: u.tMin,
    n1: u.n1,
    m,
    d,
    n2: (m * u.e.wavelengthNm) / (2 * d2),
  }));
  const notes: string[] = [];
  const d2Sd = sd(rows.map((r) => r.d));
  if (d2Sd / d2 > 0.05) {
    notes.push(
      `The thickness from the single extrema spreads by ${((100 * d2Sd) / d2).toFixed(1)} % of the mean. Check the extrema found, and leave out the strongly absorbing short-wavelength part.`,
    );
  }
  if (mBase < 1) {
    notes.push('The lowest order number is below 1, so the film may be too thin for this method.');
  }
  return { ok: true, result: { rows, d1, d1Sd: sd(pairs), d2, d2Sd, notes } };
}
