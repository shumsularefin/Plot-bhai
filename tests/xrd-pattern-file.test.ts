import { describe, expect, it } from 'vitest';
import { importText } from '../src/core/xrd/import';
import { countingSigma, patternXy, patternXye } from '../src/core/xrd/patternFile';

const counts = Float64Array.from([0, 1, 4, 100, 2500, 7]);

describe('.xy and .xye pattern files', () => {
  it('gives σ = √N for counts and σ = 1 for zero counts (known answers)', () => {
    const result = countingSigma({ intensity: counts, intensityUnit: 'counts' });
    expect(result.ok && Array.from(result.sigma)).toEqual([1, 1, 2, 10, 50, Math.sqrt(7)]);
  });

  it('gives σ = √(R·t)/t for a count rate measured for t seconds', () => {
    // 400 cps for 0.25 s is 100 counts: σ = 10 counts = 40 cps.
    const result = countingSigma({
      intensity: Float64Array.from([400, 0]),
      intensityUnit: 'cps',
      countingTimeS: 0.25,
    });
    expect(result.ok && Array.from(result.sigma)).toEqual([40, 4]);
  });

  it('agrees for counts and the same data as a rate (invariance)', () => {
    const t = 2;
    const asCounts = countingSigma({ intensity: counts, intensityUnit: 'counts' });
    const asRate = countingSigma({
      intensity: counts.map((n) => n / t),
      intensityUnit: 'cps',
      countingTimeS: t,
    });
    if (!asCounts.ok || !asRate.ok) throw new Error('expected σ');
    asCounts.sigma.forEach((s, i) => expect(Number(asRate.sigma[i]) * t).toBeCloseTo(s, 12));
  });

  it('refuses σ for negative values or a rate with no counting time', () => {
    const negative = countingSigma({
      intensity: Float64Array.from([5, -1]),
      intensityUnit: 'counts',
    });
    expect(negative.ok ? '' : negative.reason).toContain('negative');
    const rate = countingSigma({ intensity: counts, intensityUnit: 'cps' });
    expect(rate.ok ? '' : rate.reason).toContain('counting time');
  });

  it('keeps the σ stored in the loaded file', () => {
    const sigma = Float64Array.from([3, 3, 3, 3, 3, 3]);
    const result = countingSigma({ intensity: counts, intensityUnit: 'counts', sigma });
    expect(result.ok && result.sigma).toBe(sigma);
  });

  it('reads back exactly the same numbers, σ, unit and wavelength (round trip)', () => {
    // Awkward numbers on purpose: 0.1 steps that do not add exactly, and zero counts.
    const x = Float64Array.from({ length: 200 }, (_, i) => 10.12345678901234 + i * 0.1);
    const y = Float64Array.from({ length: 200 }, (_, i) => (i % 7 === 0 ? 0 : (i * 37) % 1000));
    const sigma = countingSigma({ intensity: y, intensityUnit: 'counts' });
    if (!sigma.ok) throw new Error(sigma.reason);
    const text = patternXye(x, y, sigma.sigma, {
      header: ['Pattern: test', 'Intensity unit: counts', `Uncertainty: ${sigma.how}`],
      wavelengthA: 1.5405929,
      intensityLabel: 'intensity (counts)',
    });
    expect(text.split('\n')[0]).toBe('# Pattern: test');
    const back = importText('test.xye', text, 'xye');
    if (!back.ok) throw new Error(back.error);
    expect(Array.from(back.pattern.twoTheta)).toEqual(Array.from(x));
    expect(Array.from(back.pattern.intensity)).toEqual(Array.from(y));
    expect(Array.from(back.pattern.sigma ?? [])).toEqual(Array.from(sigma.sigma));
    expect(back.pattern.intensityUnit).toBe('counts');
    expect(back.pattern.wavelengthFromFileA).toBe(1.5405929);

    const xy = importText(
      'test.xy',
      patternXy(x, y, { header: [], intensityLabel: 'intensity (cps)' }),
      'xy',
    );
    if (!xy.ok) throw new Error(xy.error);
    expect(Array.from(xy.pattern.intensity)).toEqual(Array.from(y));
    expect(xy.pattern.intensityUnit).toBe('cps');
  });
});
