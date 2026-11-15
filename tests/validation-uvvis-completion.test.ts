// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HC_EV_NM } from '../src/core/uvvis/conversions';
import { codyGap, sigmoidGap, type SigmoidType } from '../src/core/uvvis/crossChecks';
import {
  alphaWithReflection,
  extinctionCoefficient,
  indexFromGap,
} from '../src/core/uvvis/optics';
import { uvvisPeaks, DEFAULT_UVVIS_PEAKS } from '../src/core/uvvis/peaks';

/*
 * The UV-Vis completion (sub-stage 19e) against NumPy and SciPy (docs/validation.md, "19e"). The
 * data and the expected numbers are written by scripts/validation/spectra/uvvis_completion.py.
 */

interface Fixture {
  hcEvNm: number;
  sigmoid: {
    energyEv: number[];
    signal: number[];
    range: [number, number];
    n: number;
    sMin: number;
    sMax: number;
    e0Ev: number;
    e0Sigma: number;
    deltaEv: number;
    deltaSigma: number;
    eg: Record<SigmoidType, { egEv: number; egSigma: number }>;
  };
  cody: {
    energyEv: number[];
    signal: number[];
    window: [number, number];
    n: number;
    egEv: number;
    egSigma: number;
    slope: number;
  };
  slab: { t: number; r: number; thicknessNm: number; alpha: number }[];
  extinction: { alpha: number; wavelengthNm: number; k: number }[];
  index: { egEv: number; moss: number; ravindra: number; herveVandamme: number }[];
  peaks: {
    wavelengthNm: number[];
    absorbance: number[];
    prominencePercent: number;
    positionsNm: number[];
    energiesEv: number[];
    heights: number[];
    prominences: number[];
  };
}

const f = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/validation/uvvis-completion-reference.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('UV-Vis completion against NumPy and SciPy', () => {
  it('uses the same hc', () => {
    expect(rel(HC_EV_NM, f.hcEvNm)).toBeLessThan(1e-9);
  });

  it.each(['direct', 'indirect', 'amorphous'] as SigmoidType[])(
    'fits the sigmoid as scipy curve_fit does (%s)',
    (type) => {
      const s = f.sigmoid;
      const fit = sigmoidGap(
        Float64Array.from(s.energyEv),
        Float64Array.from(s.signal),
        s.range,
        type,
        false,
      );
      expect(fit).not.toBeNull();
      if (!fit) return;
      expect(fit.n).toBe(s.n);
      expect(fit.e0Ev).toBeCloseTo(s.e0Ev, 6);
      expect(fit.deltaEv).toBeCloseTo(s.deltaEv, 6);
      expect(rel(fit.sMin, s.sMin)).toBeLessThan(1e-4);
      expect(rel(fit.sMax, s.sMax)).toBeLessThan(1e-5);
      expect(rel(fit.e0Sigma, s.e0Sigma)).toBeLessThan(1e-3);
      expect(rel(fit.deltaSigma, s.deltaSigma)).toBeLessThan(1e-3);
      expect(fit.egEv).toBeCloseTo(s.eg[type].egEv, 6);
      expect(rel(fit.egSigma, s.eg[type].egSigma)).toBeLessThan(1e-3);
    },
  );

  it('reads the Cody gap and its uncertainty as scipy does', () => {
    const c = f.cody;
    const gap = codyGap(Float64Array.from(c.energyEv), Float64Array.from(c.signal), c.window);
    expect(gap.fit?.n).toBe(c.n);
    expect(gap.fit?.egEv).toBeCloseTo(c.egEv, 9);
    expect(rel(gap.fit?.slope as number, c.slope)).toBeLessThan(1e-9);
    expect(rel(gap.fit?.egSigma as number, c.egSigma)).toBeLessThan(1e-6);
  });

  it.each(f.slab)('solves the slab model as brentq does (T = $t, R = $r)', (c) => {
    const a = alphaWithReflection(c.t, c.r, c.thicknessNm * 1e-7);
    expect(rel(a, c.alpha)).toBeLessThan(1e-9);
  });

  it.each(f.extinction)('gives k as numpy does (alpha = $alpha)', (c) => {
    expect(rel(extinctionCoefficient(c.alpha, c.wavelengthNm), c.k)).toBeLessThan(1e-12);
  });

  it.each(f.index)('gives n from Eg = $egEv eV', (c) => {
    expect(rel(indexFromGap('moss', c.egEv), c.moss)).toBeLessThan(1e-12);
    expect(rel(indexFromGap('ravindra', c.egEv), c.ravindra)).toBeLessThan(1e-12);
    expect(rel(indexFromGap('herve-vandamme', c.egEv), c.herveVandamme)).toBeLessThan(1e-12);
  });

  it('picks the same bands as scipy find_peaks', () => {
    const p = f.peaks;
    const bands = uvvisPeaks(Float64Array.from(p.wavelengthNm), Float64Array.from(p.absorbance), {
      ...DEFAULT_UVVIS_PEAKS,
      prominencePercent: p.prominencePercent,
    });
    expect(bands.map((b) => b.wavelengthNm)).toHaveLength(p.positionsNm.length);
    bands.forEach((b, i) => {
      expect(b.wavelengthNm).toBeCloseTo(p.positionsNm[i] as number, 9);
      expect(b.energyEv).toBeCloseTo(p.energiesEv[i] as number, 9);
      expect(b.value).toBeCloseTo(p.heights[i] as number, 12);
      expect(b.prominence).toBeCloseTo(p.prominences[i] as number, 12);
    });
  });
});
