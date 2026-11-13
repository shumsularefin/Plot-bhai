// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitRegion } from '../src/core/xrd/peaks/fit';

/*
 * Independent check of the peak fit against lmfit (SciPy least squares):
 * scripts/validation/lmfit/make_peakfit.py writes two noisy data sets and fits them with
 * lmfit's built-in PseudoVoigtModel and Pearson7Model. This site fits the same files. Both are
 * unweighted least squares of the same model, so they must reach the same minimum; the
 * tolerances are far below the standard uncertainties lmfit reports (about 0.0003° on a centre
 * and 0.001° on a width).
 */
const dir = 'tests/fixtures/validation';
const read = (name: string) => readFileSync(join(process.cwd(), dir, name), 'utf8');
interface PvPeak {
  center: number;
  fwhm: number;
  eta: number;
  height: number;
  area: number;
}
const fixture = JSON.parse(read('peakfit-lmfit.json')) as {
  source: string;
  doublet: { peaks: PvPeak[]; sumSquares: number };
  pearson: {
    center: number;
    fwhm: number;
    m: number;
    height: number;
    area: number;
    sumSquares: number;
  };
};

function load(name: string) {
  const rows = read(name)
    .trim()
    .split('\n')
    .map((line) => line.split(' ').map(Number));
  return {
    x: Float64Array.from(rows, (r) => r[0] as number),
    y: Float64Array.from(rows, (r) => r[1] as number),
  };
}
const relative = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe(`peak fit against ${fixture.source}`, () => {
  it('fits two overlapping pseudo-Voigt peaks to the same centres, widths, shapes and areas', () => {
    const { x, y } = load('peakfit-doublet.xy');
    const region = fitRegion(
      x,
      y,
      {
        start: 34,
        end: 37,
        peaks: [
          { center: 35.28, width: 0.2 },
          { center: 35.68, width: 0.2 },
        ],
      },
      { profile: 'pseudo-voigt', fixedEta: null },
    );
    expect(region.converged).toBe(true);
    expect(region.peaks).toHaveLength(2);
    region.peaks.forEach((peak, i) => {
      const ref = fixture.doublet.peaks[i] as PvPeak;
      expect(Math.abs(peak.center - ref.center)).toBeLessThan(2e-5);
      expect(Math.abs(peak.fwhm - ref.fwhm)).toBeLessThan(1e-4);
      expect(Math.abs(peak.eta - ref.eta)).toBeLessThan(2e-3);
      expect(relative(peak.height, ref.height)).toBeLessThan(1e-3);
      expect(relative(peak.area, ref.area)).toBeLessThan(1e-3);
    });
  });

  it('fits a Pearson VII peak to the same centre, width, exponent and area', () => {
    const { x, y } = load('peakfit-pearson.xy');
    const region = fitRegion(
      x,
      y,
      { start: 29, end: 31, peaks: [{ center: 30.02, width: 0.25 }] },
      { profile: 'pearson-vii', fixedEta: null },
    );
    const peak = region.peaks[0];
    if (!peak || peak.shape?.kind !== 'pearson-vii') throw new Error('no Pearson VII fit');
    const ref = fixture.pearson;
    expect(region.converged).toBe(true);
    expect(Math.abs(peak.center - ref.center)).toBeLessThan(2e-5);
    expect(Math.abs(peak.fwhm - ref.fwhm)).toBeLessThan(1e-4);
    expect(relative(peak.shape.m, ref.m)).toBeLessThan(2e-3);
    expect(relative(peak.height, ref.height)).toBeLessThan(1e-3);
    expect(relative(peak.area, ref.area)).toBeLessThan(1e-3);
  });
});
