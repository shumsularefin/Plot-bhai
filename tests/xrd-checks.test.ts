// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFile } from '../src/core/xrd/import';
import { fitRegion } from '../src/core/xrd/peaks/fit';
import { ANODES } from '../src/core/xrd/radiation';
import { stepStats, summarise } from '../src/core/xrd/summary';
import {
  EXAMPLE_SIZES_NM,
  EXAMPLE_STANDARD_CAGLIOTI,
  examplePatterns,
  generatePattern,
  pseudoVoigt,
  seededRandom,
} from '../src/core/xrd/synthetic';
import { checkPattern, radiansToDegrees } from '../src/core/xrd/validate';

const load = (name: string) => {
  const result = importFile(
    name,
    new Uint8Array(readFileSync(new URL(`./fixtures/xrd/${name}`, import.meta.url))),
  );
  if (!result.ok) throw new Error(result.error);
  return result.pattern;
};
const texts = (p: Parameters<typeof checkPattern>[0]) =>
  checkPattern(p).messages.map((m) => m.text);

describe('checkPattern', () => {
  it('flags radians and stops flagging after conversion', () => {
    const p = load('radians.xy');
    const check = checkPattern(p);
    expect(check.looksLikeRadians).toBe(true);
    expect(check.messages[0]?.text).toContain('looks like radians');

    const converted = { ...p, twoTheta: radiansToDegrees(p.twoTheta) };
    expect(checkPattern(converted).looksLikeRadians).toBe(false);
    expect(converted.twoTheta[125]).toBeCloseTo(22.5, 5);
  });

  it('explains a guessed unit, and stops once the user has chosen', () => {
    const p = load('basic.xy');
    expect(texts(p).some((t) => t.includes('look like raw counts'))).toBe(true);
    expect(
      texts({ ...p, unitOrigin: 'user' }).some((t) => t.includes('look like raw counts')),
    ).toBe(false);
  });

  it('guesses cps for decimals and warns if the user picks counts', () => {
    const p = load('cps-decimals.xy');
    expect(p.intensityUnit).toBe('cps');
    expect(texts({ ...p, intensityUnit: 'counts', unitOrigin: 'user' })).toContain(
      'The unit is set to counts, but some intensities have decimals. Raw counts are whole numbers.',
    );
  });

  it('warns about negative intensities, a varying step and a coarse step', () => {
    const twoTheta = Float64Array.from({ length: 300 }, (_, i) =>
      i < 150 ? 10 + i * 0.2 : 40 + (i - 150) * 0.5,
    );
    const intensity = Float64Array.from({ length: 300 }, (_, i) => (i === 5 ? -3 : 100));
    const messages = texts({ twoTheta, intensity, intensityUnit: 'cps', unitOrigin: 'file' }).join(
      '\n',
    );
    expect(messages).toContain('Some intensities are negative');
    expect(messages).toContain('The step size changes from 0.2° to 0.5°');
    expect(messages).toContain('coarse for powder XRD');
  });

  it('has nothing to say about a clean pattern with a known unit', () => {
    expect(texts({ ...load('start-end.xrdml') })).toEqual([]);
  });
});

describe('summary', () => {
  it('reports range, step, points and the maximum', () => {
    const p = load('basic.xy');
    const s = summarise(p.twoTheta, p.intensity);
    expect(s.twoThetaMin).toBe(20);
    expect(s.twoThetaMax).toBe(25);
    expect(s.points).toBe(251);
    expect(s.maxIntensity).toBe(1100);
    expect(s.maxIntensityAt).toBe(22.5);
    expect(s.step.median).toBeCloseTo(0.02, 9);
    expect(s.step.uniform).toBe(true);
  });

  it('marks an uneven step as not uniform', () => {
    expect(stepStats([0, 1, 2, 4]).uniform).toBe(false);
  });
});

describe('synthetic data', () => {
  it('pseudo-Voigt is 1 at the centre and 1/2 at ± FWHM/2 for any η', () => {
    for (const eta of [0, 0.3, 1]) {
      expect(pseudoVoigt(30, 30, 0.4, eta)).toBeCloseTo(1, 12);
      expect(pseudoVoigt(30.2, 30, 0.4, eta)).toBeCloseTo(0.5, 12);
      expect(pseudoVoigt(29.8, 30, 0.4, eta)).toBeCloseTo(0.5, 12);
    }
  });

  it('places a noise-free peak at the chosen position with the chosen height', () => {
    const { twoTheta, intensity } = generatePattern({
      start: 20,
      end: 40,
      step: 0.01,
      peaks: [{ center: 30, fwhm: 0.2, height: 5000, eta: 0.5 }],
      background: { constant: 100, amplitude: 0, decay: 1 },
    });
    expect(twoTheta.length).toBe(2001);
    const s = summarise(twoTheta, intensity);
    expect(s.maxIntensityAt).toBe(30);
    expect(s.maxIntensity).toBe(5100);
  });

  it('is repeatable for a given seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('example data are two whole-count patterns with peaks where the lines are', () => {
    const lines = [
      { twoTheta: 31.8, intensity: 57 },
      { twoTheta: 36.3, intensity: 100 },
      { twoTheta: 56.6, intensity: 30 },
      { twoTheta: 95, intensity: 10 },
    ];
    const examples = examplePatterns(lines, 'ZnO');
    expect(examples.map((e) => e.name)).toEqual([
      'ZnO, calculated, 60 nm crystallites',
      'ZnO, calculated, 15 nm crystallites',
    ]);
    for (const e of examples) {
      expect(e.twoTheta[0]).toBe(20);
      expect(e.twoTheta[e.twoTheta.length - 1]).toBe(80);
      expect(e.intensity.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
      expect(summarise(e.twoTheta, e.intensity).maxIntensityAt).toBeCloseTo(36.3, 1);
    }
  });

  it('example peaks carry the stated crystallite size: fitted and corrected widths give it back', () => {
    const line = { twoTheta: 36.3, intensity: 100 };
    const lambda = ANODES.Cu.kAlpha1;
    const theta = (line.twoTheta / 2) * (Math.PI / 180);
    const { u, v, w } = EXAMPLE_STANDARD_CAGLIOTI;
    const t = Math.tan(theta);
    const instrument = Math.sqrt(u * t * t + v * t + w);
    const sizes = [EXAMPLE_SIZES_NM.narrow, EXAMPLE_SIZES_NM.broad];
    examplePatterns([line], 'One line').forEach((example, i) => {
      const region = fitRegion(
        example.twoTheta,
        example.intensity,
        { start: 33.5, end: 39, peaks: [{ center: 36.25, width: 0.3 }] },
        {
          profile: 'pseudo-voigt',
          fixedEta: null,
          kAlpha2: { lambda1: lambda, lambda2: ANODES.Cu.kAlpha2, ratio: 0.5 },
        },
      );
      const fwhm = region.peaks[0]?.fwhm ?? NaN;
      // Scherrer after the Gaussian correction the generator used: L = K λ / (β cos θ).
      const beta = Math.sqrt(fwhm ** 2 - instrument ** 2) * (Math.PI / 180);
      const sizeNm = (0.9 * lambda) / 10 / (beta * Math.cos(theta));
      expect(Math.abs(sizeNm - (sizes[i] as number)) / (sizes[i] as number)).toBeLessThan(0.05);
    });
  });
});
