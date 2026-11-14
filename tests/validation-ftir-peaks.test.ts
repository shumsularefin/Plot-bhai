// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { peakShapes } from '../src/core/ftir/peakShape';

// References from scipy (scripts/validation/spectra/ftir_peaks.py); see docs/validation.md, 19c.
interface Isolated {
  x: number[];
  y: number[];
  peak: number;
  fwhm: number;
  area: number;
}
interface Reference {
  gaussian: Isolated;
  lorentzian: Isolated;
  sloped: {
    x: number[];
    y: number[];
    peaks: {
      wavenumber: number;
      from: number;
      to: number;
      height: number;
      fwhm: number;
      area: number;
    }[];
  };
}
const ref = JSON.parse(
  readFileSync(new URL('./fixtures/validation/ftir-peaks-reference.json', import.meta.url), 'utf8'),
) as Reference;

describe('FTIR peak width and area against scipy', () => {
  for (const kind of ['gaussian', 'lorentzian'] as const) {
    it(`isolated ${kind} band: scipy.signal.peak_widths and trapezoid`, () => {
      const r = ref[kind];
      const [s] = peakShapes(Float64Array.from(r.x), Float64Array.from(r.y), [r.peak]);
      expect(s?.fwhm).toBeCloseTo(r.fwhm, 6);
      expect(s?.area).toBeCloseTo(r.area, 6);
    });
  }

  it('two bands on a sloping noisy background: local baseline, width and area', () => {
    const r = ref.sloped;
    const shapes = peakShapes(
      Float64Array.from(r.x),
      Float64Array.from(r.y),
      r.peaks.map((p) => p.wavenumber),
    );
    r.peaks.forEach((p, k) => {
      const s = shapes[k];
      expect(s?.fromCm).toBe(p.from);
      expect(s?.toCm).toBe(p.to);
      expect(s?.heightAbove).toBeCloseTo(p.height, 9);
      expect(s?.fwhm).toBeCloseTo(p.fwhm, 6);
      expect(s?.area).toBeCloseTo(p.area, 6);
    });
  });
});
