// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { crystallinity, PEAK_EXCLUSION_FWHM } from '../src/core/xrd/analysis/crystallinity';
import { patternCharacter, SINGLE_CRYSTAL_DISCLAIMER } from '../src/core/xrd/analysis/character';
import { textureCoefficients } from '../src/core/xrd/analysis/texture';
import { peakArea } from '../src/core/xrd/peaks/profiles';
import { generatePattern, type SyntheticPeak } from '../src/core/xrd/synthetic';

describe('Harris texture coefficient', () => {
  it('gives 1 for every reflection when the intensities follow the reference', () => {
    const outcome = textureCoefficients([
      { observed: 500, reference: 100 },
      { observed: 250, reference: 50 },
      { observed: 100, reference: 20 },
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) outcome.tc.forEach((t) => expect(t).toBeCloseTo(1, 12));
  });

  it('matches a worked example: ratios 10, 1, 1, 1 give TC = 10/3.25 and 1/3.25', () => {
    // I/I0 = 10, 1, 1, 1; mean = 13/4 = 3.25.
    const outcome = textureCoefficients([
      { observed: 1000, reference: 100 },
      { observed: 50, reference: 50 },
      { observed: 30, reference: 30 },
      { observed: 20, reference: 20 },
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.tc[0]).toBeCloseTo(10 / 3.25, 12);
    expect(outcome.tc[1]).toBeCloseTo(1 / 3.25, 12);
    // The coefficients always average to 1.
    expect(outcome.tc.reduce((s, t) => s + t, 0) / 4).toBeCloseTo(1, 12);
  });

  it('gives TC(00l) > 1 and the others < 1 when the 00l lines are ten times too strong', () => {
    const reference = [100, 40, 30, 25, 20, 15];
    const isAxial = [true, true, false, false, false, false];
    const outcome = textureCoefficients(
      reference.map((r, i) => ({ observed: r * (isAxial[i] ? 10 : 1), reference: r })),
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    outcome.tc.forEach((t, i) =>
      isAxial[i] ? expect(t).toBeGreaterThan(1) : expect(t).toBeLessThan(1),
    );
  });

  it('treats a missing reflection (observed 0) as TC = 0 and still averages to 1', () => {
    const outcome = textureCoefficients([
      { observed: 100, reference: 100 },
      { observed: 0, reference: 50 },
    ]);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.tc).toEqual([2, 0]);
  });

  it('refuses with a plain reason for fewer than two reflections, no intensity or a bad reference', () => {
    expect(textureCoefficients([{ observed: 5, reference: 5 }])).toMatchObject({
      ok: false,
      reason: expect.stringContaining('two'),
    });
    expect(
      textureCoefficients([
        { observed: 0, reference: 5 },
        { observed: 0, reference: 5 },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      textureCoefficients([
        { observed: 5, reference: 0 },
        { observed: 5, reference: 5 },
      ]),
    ).toMatchObject({ ok: false });
  });
});

describe('crystallinity index', () => {
  const START = 10;
  const END = 80;
  const STEP = 0.02;
  const crystalline: SyntheticPeak[] = [
    { center: 25.3, fwhm: 0.25, height: 3000, eta: 0.4 },
    { center: 37.8, fwhm: 0.3, height: 1200, eta: 0.4 },
    { center: 48.1, fwhm: 0.3, height: 1500, eta: 0.4 },
    { center: 53.9, fwhm: 0.3, height: 900, eta: 0.4 },
    { center: 62.7, fwhm: 0.35, height: 700, eta: 0.4 },
  ];
  // A Gaussian hump is a pseudo-Voigt with η = 0.
  const hump: SyntheticPeak = { center: 30, fwhm: 14, height: 500, eta: 0 };
  const zero = { constant: 0, amplitude: 0, decay: 1 };
  const grid = (peaks: SyntheticPeak[], noiseSeed?: number) =>
    generatePattern({
      start: START,
      end: END,
      step: STEP,
      peaks,
      background: zero,
      ...(noiseSeed !== undefined && { noiseSeed }),
    });
  const area = (x: Float64Array, y: Float64Array) => {
    let sum = 0;
    for (let i = 1; i < x.length; i++)
      sum +=
        (((y[i] as number) + (y[i - 1] as number)) / 2) * ((x[i] as number) - (x[i - 1] as number));
    return sum;
  };
  const sample = grid([...crystalline, hump]);
  const truth = (() => {
    const cr = grid(crystalline);
    const am = grid([hump]);
    const a = area(cr.twoTheta, cr.intensity);
    const b = area(am.twoTheta, am.intensity);
    return { crystalline: a, amorphous: b, index: (100 * a) / (a + b) };
  })();
  // Fitted-peak widths: keep the hump fit away from every crystalline peak, as the app does.
  const exclude = crystalline.map(
    (p) =>
      [p.center - PEAK_EXCLUSION_FWHM * p.fwhm, p.center + PEAK_EXCLUSION_FWHM * p.fwhm] as const,
  );

  it('knows the true areas it is compared with (sanity check of the test itself)', () => {
    const analytic = crystalline.reduce(
      (s, p) => s + peakArea({ height: p.height, center: p.center, fwhm: p.fwhm, eta: p.eta }),
      0,
    );
    expect(truth.crystalline / analytic).toBeCloseTo(1, 2);
    expect(truth.index).toBeGreaterThan(10);
    expect(truth.index).toBeLessThan(60);
  });

  it('recovers the crystalline fraction within 2 % with a fitted Gaussian hump', () => {
    const outcome = crystallinity(sample.twoTheta, sample.intensity, [START, END], {
      kind: 'gaussian',
      centre: 30,
      fwhm: 14,
      exclude,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(Math.abs(outcome.index / truth.index - 1)).toBeLessThan(0.02);
    expect(outcome.crystallineArea + outcome.amorphousArea).toBeCloseTo(outcome.totalArea, 6);
  });

  it('recovers it within 8 % with anchor points read from the data between the peaks', () => {
    const outcome = crystallinity(sample.twoTheta, sample.intensity, [START, END], {
      kind: 'anchors',
      positions: [11, 15, 19, 23, 28, 31, 34, 36, 41, 44, 51, 57, 59, 66, 70, 75, 79.5],
      halfWidth: 0.2,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    // Each anchor also reads the slowly falling tails of the peaks (0.4 Lorentzian here), which
    // makes the hump a little too large; the Gaussian fit above avoids the points near peaks.
    expect(outcome.index).toBeLessThan(truth.index);
    expect(Math.abs(outcome.index / truth.index - 1)).toBeLessThan(0.08);
  });

  it('still recovers the fraction within 2 % with counting noise', () => {
    const noisy = grid([...crystalline, hump], 11);
    const outcome = crystallinity(noisy.twoTheta, noisy.intensity, [START, END], {
      kind: 'gaussian',
      centre: 30,
      fwhm: 14,
      exclude,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(Math.abs(outcome.index / truth.index - 1)).toBeLessThan(0.02);
  });

  it('gives almost 100 % for sharp peaks with no hump', () => {
    const sharp = grid(crystalline);
    const outcome = crystallinity(sharp.twoTheta, sharp.intensity, [START, END], {
      kind: 'gaussian',
      centre: 30,
      fwhm: 14,
      exclude,
    });
    // Only the far tails of the peaks lie between them, so almost nothing is called amorphous.
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.index).toBeGreaterThan(98);
  });

  it('refuses with a plain reason when the range, the anchors or the points do not allow it', () => {
    const { twoTheta, intensity } = sample;
    expect(
      crystallinity(twoTheta, intensity, [30, 30.1], { kind: 'anchors', positions: [30, 30.05] }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('range') });
    expect(
      crystallinity(twoTheta, intensity, [START, END], { kind: 'anchors', positions: [30] }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('two') });
    expect(
      crystallinity(twoTheta, intensity, [START, END], {
        kind: 'gaussian',
        centre: 30,
        fwhm: 14,
        exclude: [[START, END]],
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('peaks') });
    expect(
      crystallinity(twoTheta, intensity, [START, END], {
        kind: 'gaussian',
        centre: 30,
        fwhm: 0,
        exclude: [],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('pattern character hints', () => {
  const axial = (n: number) => ({ hkl: [[0, 0, n]] as [number, number, number][], tc: 2.4 });
  const ids = (hints: { id: string }[]) => hints.map((h) => h.id);

  it('suggests strong orientation when only one family of planes is seen and strong lines are missing', () => {
    const hints = patternCharacter({
      phases: [
        {
          name: 'ZnO',
          peaks: [axial(2), axial(4)],
          missing: [[[1, 0, 0]], [[1, 0, 1]], [[1, 1, 0]]],
        },
      ],
      medianFwhm: 0.15,
      crystallinity: null,
    });
    expect(ids(hints)).toContain('orientation');
    expect(ids(hints)).not.toContain('random');
    const hint = hints.find((h) => h.id === 'orientation');
    expect(hint?.reason).toContain('(002)');
    expect(hint?.reason).toContain('(100)');
    expect(hint?.text).toContain(SINGLE_CRYSTAL_DISCLAIMER);
  });

  it('suggests a random powder when most reflections are present with near-reference intensities', () => {
    const peak = (hkl: [number, number, number], tc: number) => ({ hkl: [hkl], tc });
    const hints = patternCharacter({
      phases: [
        {
          name: 'Anatase',
          peaks: [
            peak([1, 0, 1], 1.1),
            peak([0, 0, 4], 0.9),
            peak([2, 0, 0], 1.0),
            peak([1, 0, 5], 0.95),
            peak([2, 1, 1], 1.05),
          ],
          missing: [],
        },
      ],
      medianFwhm: 0.15,
      crystallinity: null,
    });
    expect(ids(hints)).toContain('random');
    expect(ids(hints)).not.toContain('orientation');
    expect(hints.every((h) => h.text.includes(SINGLE_CRYSTAL_DISCLAIMER))).toBe(true);
  });

  it('flags very broad peaks, and a low crystallinity index, as nanocrystalline or amorphous content', () => {
    const hints = patternCharacter({
      phases: [],
      medianFwhm: 2.4,
      crystallinity: 35,
    });
    expect(ids(hints)).toContain('broad');
    expect(ids(hints)).toContain('amorphous');
  });

  it('gives no hint when the evidence is mixed', () => {
    const hints = patternCharacter({
      phases: [
        {
          name: 'Anatase',
          peaks: [
            { hkl: [[1, 0, 1]], tc: 2.0 },
            { hkl: [[0, 0, 4]], tc: 0.3 },
            { hkl: [[2, 0, 0]], tc: 1.2 },
          ],
          missing: [[[2, 1, 1]]],
        },
      ],
      medianFwhm: 0.2,
      crystallinity: 80,
    });
    expect(hints).toEqual([]);
  });
});
