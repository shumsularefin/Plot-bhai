// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareOverall, comparePeaks, type PaperSettings } from '../src/core/xrd/size/compare';

const DEG = Math.PI / 180;
const paper: PaperSettings = { k: 0.9, lambdaA: 1.5406, instrumentDeg: 0, correction: 'gaussian' };

/** FWHM (degrees 2θ) of size broadening D nm plus strain ε: β cos θ = Kλ/D + 4ε sin θ. */
const width = (twoTheta: number, d: number, strain = 0) => {
  const theta = (twoTheta / 2) * DEG;
  return ((0.9 * 0.15406) / d / Math.cos(theta) + 4 * strain * Math.tan(theta)) / DEG;
};

describe('paper comparison', () => {
  const angles = [28.9, 32.6, 47.3, 56.1];

  it('agrees with the reported size when the widths fit it, and implies the measured width', () => {
    const peaks = comparePeaks(
      angles.map((t) => ({ twoTheta: t, fwhm: width(t, 20), reportedNm: 20, reportedFwhm: null })),
      paper,
    );
    for (const p of peaks) {
      expect(p.sizeNm).toBeCloseTo(20, 9);
      expect(p.sizeDifference).toBeCloseTo(0, 9);
      expect(p.impliedFwhm).toBeCloseTo(p.fwhm, 9);
      expect(p.explanations).toEqual([]);
    }
    const overall = compareOverall(peaks, 'scherrer', paper, 20, null);
    expect(overall.sizeNm).toBeCloseTo(20, 9);
  });

  it('subtracts the stated instrument width and adds it back for the implied width', () => {
    const settings: PaperSettings = { ...paper, instrumentDeg: 0.1 };
    const sample = width(32.6, 25);
    const [p] = comparePeaks(
      [{ twoTheta: 32.6, fwhm: Math.hypot(sample, 0.1), reportedNm: 25, reportedFwhm: null }],
      settings,
    );
    expect(p?.corrected).toBeCloseTo(sample, 9);
    expect(p?.sizeNm).toBeCloseTo(25, 9);
    expect(p?.impliedFwhm).toBeCloseTo(Math.hypot(sample, 0.1), 9);
  });

  it('recognises a size computed with the width in degrees', () => {
    const t = 32.6;
    const beta = width(t, 20) * DEG;
    // The slip: β used in degrees in D = Kλ/(β cos θ).
    const reported = (0.9 * 0.15406) / ((beta / DEG) * Math.cos((t / 2) * DEG));
    const [p] = comparePeaks(
      [{ twoTheta: t, fwhm: width(t, 20), reportedNm: reported, reportedFwhm: null }],
      paper,
    );
    expect(p?.explanations.map((e) => e.text)).toEqual([
      'The width was used in degrees instead of radians.',
    ]);
  });

  it('recovers size and strain with Williamson–Hall', () => {
    const peaks = comparePeaks(
      angles.map((t) => ({
        twoTheta: t,
        fwhm: width(t, 30, 0.002),
        reportedNm: null,
        reportedFwhm: null,
      })),
      paper,
    );
    const overall = compareOverall(peaks, 'wh-udm', paper, 30, 0.002);
    expect(overall.sizeNm).toBeCloseTo(30, 6);
    expect(overall.strain).toBeCloseTo(0.002, 9);
    expect(overall.sizeDifference).toBeCloseTo(0, 6);
    expect(overall.strainDifference).toBeCloseTo(0, 6);
  });
});
