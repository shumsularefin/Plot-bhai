// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECTION } from '../src/core/xrd/peaks/detect';
import { backgroundTooLow, fitPeaks } from '../src/core/xrd/peaks/fit';
import { missedPeaks } from '../src/core/xrd/peaks/missed';
import { generatePattern } from '../src/core/xrd/synthetic';

// Synthetic counts: a strong peak with a weaker shoulder 0.3° away, and a separate peak.
const pattern = generatePattern({
  start: 25,
  end: 38,
  step: 0.01,
  peaks: [
    { center: 30, fwhm: 0.15, height: 3000, eta: 0.3 },
    { center: 30.3, fwhm: 0.15, height: 700, eta: 0.3 },
    { center: 33, fwhm: 0.15, height: 2000, eta: 0.3 },
  ],
  background: { constant: 200, amplitude: 0, decay: 1 },
  noiseSeed: 7,
});
const options = { profile: 'pseudo-voigt' as const, fixedEta: null };

describe('missed peaks from the fit residual', () => {
  it('finds a shoulder that was left out of the fit', () => {
    const regions = fitPeaks(
      pattern.twoTheta,
      pattern.intensity,
      [
        { center: 30, width: 0.2 },
        { center: 33, width: 0.2 },
      ],
      options,
    );
    const missed = missedPeaks(pattern.twoTheta, pattern.intensity, regions, DEFAULT_DETECTION);
    expect(missed).toHaveLength(1);
    expect(missed[0]?.center).toBeCloseTo(30.3, 1);
  });

  it('suggests nothing when every peak is fitted', () => {
    const regions = fitPeaks(
      pattern.twoTheta,
      pattern.intensity,
      [
        { center: 30, width: 0.2 },
        { center: 30.3, width: 0.2 },
        { center: 33, width: 0.2 },
      ],
      options,
    );
    expect(missedPeaks(pattern.twoTheta, pattern.intensity, regions, DEFAULT_DETECTION)).toEqual(
      [],
    );
  });
});

describe('fit warnings for a broad peak standing in for the background', () => {
  // A narrow peak on a broad hump; the region is narrower than the hump.
  const hump = generatePattern({
    start: 45,
    end: 55,
    step: 0.01,
    peaks: [
      { center: 50, fwhm: 0.2, height: 1000, eta: 0.3 },
      { center: 50, fwhm: 3, height: 600, eta: 0 },
    ],
    background: { constant: 100, amplitude: 0, decay: 1 },
    noiseSeed: 3,
  });

  it('reports the grown width', () => {
    const [region] = fitPeaks(
      hump.twoTheta,
      hump.intensity,
      [
        { center: 50, width: 0.2 },
        { center: 50.05, width: 0.4 },
      ],
      options,
    );
    const peakTexts = region?.peaks.flatMap((p) => p.messages.map((m) => m.text)) ?? [];
    expect(peakTexts.some((t) => t.startsWith('The width grew'))).toBe(true);
  });

  it('tells a background under the data from one that touches it', () => {
    // Flat data at 100 with a peak of 400 in the middle; noise σ = 2.
    const x = Float64Array.from({ length: 101 }, (_, i) => i * 0.01);
    const y = x.map((v) => 100 + 400 * Math.exp(-(((v - 0.5) / 0.05) ** 2)));
    const line = (intercept: number, slope = 0) => ({ intercept, slope, pivot: 0.5 });
    expect(backgroundTooLow(x, y, line(100), 2)).toBe(false);
    // 60 below the flat part: more than 10 % of the range (40) plus 3σ (6).
    expect(backgroundTooLow(x, y, line(40), 2)).toBe(true);
    // Tilted: meets the data at the right end (x = 1) but is 100 below it at the left end.
    expect(backgroundTooLow(x, y, line(50, 100), 2)).toBe(true);
  });

  it('stays quiet for well-separated peaks on a flat background', () => {
    const regions = fitPeaks(
      pattern.twoTheta,
      pattern.intensity,
      [
        { center: 30, width: 0.2 },
        { center: 30.3, width: 0.2 },
        { center: 33, width: 0.2 },
      ],
      options,
    );
    const texts = regions.flatMap((r) => [
      ...r.messages.map((m) => m.text),
      ...r.peaks.flatMap((p) => p.messages.map((m) => m.text)),
    ]);
    expect(texts.filter((t) => /width grew|straight background/.test(t))).toEqual([]);
  });
});
