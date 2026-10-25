// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { levenbergMarquardt } from '../src/core/math/levenbergMarquardt';
import { DEFAULT_DETECTION, detectPeaks } from '../src/core/xrd/peaks/detect';
import { fitRegion } from '../src/core/xrd/peaks/fit';
import { localNoise } from '../src/core/xrd/peaks/noise';
import { pseudoVoigt, seededRandom } from '../src/core/xrd/synthetic';
import { formatWithSigma } from '../src/ui/format';

/** Standard normal numbers from a seeded uniform generator (Box–Muller). */
function gaussian(seed: number) {
  const random = seededRandom(seed);
  return () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}

const grid = (n: number, start = 10, step = 0.02) =>
  Float64Array.from({ length: n }, (_, i) => start + step * i);

describe('local noise estimate', () => {
  it('recovers the noise of white noise on a curved background', () => {
    const g = gaussian(3);
    const x = grid(3000);
    const y = x.map((v) => 500 + 40 * Math.sin(v / 5) + 10 * g());
    const sd = localNoise(y);
    // MAD of ~200 points scatters by about 10 %; the average over the scan must be close.
    const mean = sd.reduce((a, b) => a + b, 0) / sd.length;
    expect(mean).toBeGreaterThan(9.5);
    expect(mean).toBeLessThan(10.5);
    for (const v of sd) {
      expect(v).toBeGreaterThan(7.5);
      expect(v).toBeLessThan(12.5);
    }
  });

  it('follows counting noise that grows with the signal', () => {
    const g = gaussian(4);
    const x = grid(4000);
    const level = (v: number) => 50 + 2000 * ((v - 10) / 80);
    const y = x.map((v) => level(v) + Math.sqrt(level(v)) * g());
    const sd = localNoise(y);
    expect((sd[100] as number) / Math.sqrt(level(x[100] as number))).toBeCloseTo(1, 0);
    expect((sd[3900] as number) / Math.sqrt(level(x[3900] as number))).toBeCloseTo(1, 0);
  });
});

describe('peak detection on noisy data', () => {
  it('finds at most a rare false peak in 20 scans of pure counting noise with the defaults', () => {
    let found = 0;
    for (let run = 0; run < 20; run++) {
      const g = gaussian(100 + run);
      const x = grid(3500);
      const y = x.map(() => Math.max(0, Math.round(140 + Math.sqrt(140) * g())));
      found += detectPeaks(x, y, DEFAULT_DETECTION).length;
    }
    // Without the noise tests the same scans give about 100 false peaks each.
    expect(found).toBeLessThanOrEqual(3);
  });

  it('still finds a real peak of 10 noise levels, and keeps its signal-to-noise', () => {
    const g = gaussian(9);
    const x = grid(3500);
    const sigma = Math.sqrt(140);
    const y = x.map((v) => 140 + 10 * sigma * pseudoVoigt(v, 40, 0.15, 0.5) + sigma * g());
    const peaks = detectPeaks(x, y, DEFAULT_DETECTION);
    expect(peaks).toHaveLength(1);
    expect(peaks[0]?.center).toBeCloseTo(40, 1);
    expect(peaks[0]?.snr).toBeGreaterThan(7);
  });

  it('drops a one-point spike that the prominence threshold alone keeps', () => {
    const x = grid(1000);
    const y = x.map((v) => 100 + 400 * pseudoVoigt(v, 20, 0.2, 0.5));
    y[700] = 400; // a single-point spike
    const plain = detectPeaks(x, y, { ...DEFAULT_DETECTION, minSnr: 0, minWidthSteps: 0 });
    const filtered = detectPeaks(x, y, DEFAULT_DETECTION);
    expect(plain.map((p) => p.index)).toContain(700);
    expect(filtered.map((p) => p.index)).not.toContain(700);
    expect(filtered).toHaveLength(1);
  });
});

describe('fit uncertainties and goodness of fit', () => {
  it('says the uncertainties are not defined when parameters cannot be separated', () => {
    // Two copies of the same parameter: y = (a + b) x has no unique a and b.
    const x = [1, 2, 3, 4, 5];
    const result = levenbergMarquardt({
      y: Float64Array.from(x, (v) => 2 * v + 0.01 * Math.sin(v)),
      initial: Float64Array.of(1, 0.5),
      lower: Float64Array.of(-Infinity, -Infinity),
      upper: Float64Array.of(Infinity, Infinity),
      free: [true, true],
      evaluate(p, model, jacobian) {
        x.forEach((v, i) => {
          model[i] = ((p[0] as number) + (p[1] as number)) * v;
          if (jacobian) {
            jacobian[2 * i] = v;
            jacobian[2 * i + 1] = v;
          }
        });
      },
    });
    expect(result.covarianceOk).toBe(false);
    expect(Number.isNaN(result.standardErrors[0])).toBe(true);
    expect(formatWithSigma(1.23456, result.standardErrors[0] as number)).toBe('1.235 ± n/a');
  });

  it('gives χ²ν near 1 for the right model and far above 1 when a peak is missing', () => {
    const g = gaussian(21);
    const x = grid(400, 30);
    const noise = 5;
    const y = x.map(
      (v) =>
        50 +
        300 * pseudoVoigt(v, 33, 0.2, 0.3) +
        120 * pseudoVoigt(v, 33.5, 0.2, 0.3) +
        noise * g(),
    );
    const options = { profile: 'pseudo-voigt' as const, fixedEta: null };
    const both = fitRegion(
      x,
      y,
      {
        start: 32,
        end: 34.5,
        peaks: [
          { center: 33, width: 0.2 },
          { center: 33.5, width: 0.2 },
        ],
      },
      options,
    );
    expect(both.uncertaintiesOk).toBe(true);
    expect(both.reducedChiSquared).toBeGreaterThan(0.7);
    expect(both.reducedChiSquared).toBeLessThan(1.4);
    expect(both.noiseSd).toBeGreaterThan(4);
    expect(both.noiseSd).toBeLessThan(6);
    const one = fitRegion(
      x,
      y,
      { start: 32, end: 34.5, peaks: [{ center: 33, width: 0.2 }] },
      options,
    );
    expect(one.reducedChiSquared).toBeGreaterThan(4);
    expect(one.messages.map((m) => m.text).join(' ')).toContain('misses real structure');
  });
});
