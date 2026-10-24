import { describe, expect, it } from 'vitest';
import {
  buildRun,
  guessMapping,
  importThermalFile,
  importThermalText,
} from '../src/core/thermal/import';
import {
  DEFAULT_CLEAN,
  cleanRun,
  estimateHeatingRate,
  rampIndices,
} from '../src/core/thermal/process';
import { dtg, localPolynomial } from '../src/core/thermal/smooth';
import {
  DEFAULT_DETECT,
  analyseSteps,
  detectSteps,
  massAtTemperature,
  temperatureAtMass,
} from '../src/core/thermal/steps';
import type { ThermalRun } from '../src/core/thermal/types';
import { deconvolveSteps } from '../src/core/thermal/deconvolve';
import { EXAMPLE_STEPS, exampleTgaTable, normalCdf } from '../src/core/thermal/synthetic';
import type { SyntheticStep } from '../src/core/thermal/synthetic';
import { seededRandom } from '../src/core/xrd/synthetic';

/** Mass (%) = 100 − Σ loss·Φ((T − peak)/σ): each step has a Gaussian DTG with area = loss. */
function syntheticMass(T: Float64Array, steps: SyntheticStep[], noise = 0, seed = 1): Float64Array {
  const random = seededRandom(seed);
  return T.map((t) => {
    let m = 100;
    for (const s of steps) m -= s.loss * normalCdf((t - s.peak) / s.sigma);
    const gauss = Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
    return m + noise * gauss;
  });
}

const grid = (from: number, to: number, n: number) =>
  Float64Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

function runOf(
  T: Float64Array,
  mass: Float64Array,
  unit: 'mg' | 'percent' = 'percent',
): ThermalRun {
  return {
    name: 'x',
    temperatureC: T,
    mass,
    massUnit: unit,
    timeMin: null,
    heatFlow: null,
    notes: [],
  };
}

describe('local polynomial slope', () => {
  it('recovers the exact slope of a quadratic on uneven x', () => {
    const x = Float64Array.from({ length: 60 }, (_, i) => i + 0.3 * Math.sin(i));
    const y = x.map((v) => 3 + 2 * v + 0.01 * v * v);
    const { slope, value } = localPolynomial(x, y, 5, 2);
    for (const i of [0, 7, 30, 59]) {
      expect(slope[i]).toBeCloseTo(2 + 0.02 * (x[i] as number), 8);
      expect(value[i]).toBeCloseTo(y[i] as number, 8);
    }
  });
});

describe('synthetic TGA with known steps', () => {
  const T = grid(30, 800, 3851); // 0.2 °C spacing
  const truth: SyntheticStep[] = [
    { loss: 12, peak: 150, sigma: 12 },
    { loss: 30, peak: 420, sigma: 25 },
    { loss: 8, peak: 650, sigma: 20 },
  ];
  const mass = syntheticMass(T, truth);

  it('recovers peak, onset, endset, loss and residue of every step', () => {
    const d = dtg(T, mass, 10);
    const limits = detectSteps(T, d, DEFAULT_DETECT);
    expect(limits).toHaveLength(3);
    const { steps, regions } = analyseSteps(T, mass, d, limits, 10);
    expect(regions).toHaveLength(0);
    let expectedResidue = 100;
    steps.forEach((step, k) => {
      const t = truth[k] as SyntheticStep;
      expectedResidue -= t.loss;
      expect(step.peakC).toBeCloseTo(t.peak, 0);
      expect(step.lossPct).toBeGreaterThan(t.loss * 0.98);
      expect(step.lossPct).toBeLessThan(t.loss * 1.001);
      // Onset/endset of a Gaussian DTG: T_p ∓ σ·sqrt(2π)/2.
      const half = (t.sigma * Math.sqrt(2 * Math.PI)) / 2;
      expect(step.onsetC).toBeCloseTo(t.peak - half, 0);
      expect(step.endsetC).toBeCloseTo(t.peak + half, 0);
      expect(step.residualPct).toBeCloseTo(expectedResidue, 0);
      expect(step.lossMg).toBeCloseTo(step.lossPct / 10, 10);
    });
  });

  it('finds T5, T10, T50 and the mass at a chosen temperature', () => {
    const only: SyntheticStep[] = [{ loss: 40, peak: 300, sigma: 20 }];
    const m = syntheticMass(T, only);
    // 5 % lost: 100 − 40·Φ(z) = 95 → Φ(z) = 0.125 → z = −1.1503494; 50 % lost never reached.
    expect(temperatureAtMass(T, m, 95)).toBeCloseTo(300 - 1.1503494 * 20, 1);
    expect(temperatureAtMass(T, m, 90)).toBeCloseTo(300 + -0.6744898 * 20, 1);
    expect(temperatureAtMass(T, m, 50)).toBeNull();
    expect(massAtTemperature(T, m, 300)).toBeCloseTo(80, 3);
    expect(massAtTemperature(T, m, 900)).toBeNull();
  });

  it('keeps the numbers close with 0.05 % mass noise', () => {
    const noisy = syntheticMass(T, truth, 0.05, 7);
    const d = dtg(T, noisy, 20);
    const limits = detectSteps(T, d, DEFAULT_DETECT);
    expect(limits).toHaveLength(3);
    const { steps } = analyseSteps(T, noisy, d, limits, null);
    steps.forEach((step, k) => {
      const t = truth[k] as SyntheticStep;
      expect(Math.abs(step.peakC - t.peak)).toBeLessThan(3);
      expect(Math.abs(step.lossPct - t.loss)).toBeLessThan(0.6);
      expect(step.lossMg).toBeNull();
    });
  });

  it('reports two steps that run into each other as one region', () => {
    const close: SyntheticStep[] = [
      { loss: 20, peak: 300, sigma: 20 },
      { loss: 20, peak: 350, sigma: 20 },
    ];
    const m = syntheticMass(T, close);
    const d = dtg(T, m, 10);
    const limits = detectSteps(T, d, { prominencePercent: 3, minSeparationC: 20 });
    const { regions } = analyseSteps(T, m, d, limits, 10);
    expect(limits).toHaveLength(2);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.lossPct).toBeGreaterThan(39);
    expect(regions[0]?.note).toContain('overlap');
  });

  it('merges peaks closer than the minimum separation', () => {
    const close: SyntheticStep[] = [
      { loss: 20, peak: 300, sigma: 8 },
      { loss: 10, peak: 312, sigma: 8 },
    ];
    const m = syntheticMass(T, close);
    const d = dtg(T, m, 5);
    expect(detectSteps(T, d, { prominencePercent: 2, minSeparationC: 40 })).toHaveLength(1);
  });

  it('stays fast for 10,000 points', () => {
    const big = grid(30, 800, 10000);
    const m = syntheticMass(big, truth, 0.02);
    const start = performance.now();
    const d = dtg(big, m, 15);
    const limits = detectSteps(big, d, DEFAULT_DETECT);
    analyseSteps(big, m, d, limits, 10);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe('cleaning', () => {
  it('keeps only the heating ramp and drops holds and cooling', () => {
    const T = Float64Array.from([25, 25, 30, 40, 50, 60, 60, 60, 50, 40]);
    expect(rampIndices(T)).toEqual([0, 2, 3, 4, 5]);
    expect(rampIndices(T, 35, 55)).toEqual([3, 4]);
  });

  it('converts mg to % of the entered initial mass and mg back', () => {
    const T = grid(30, 130, 21);
    const mg = T.map((t) => 8 - 0.01 * (t - 30)); // 8 mg falling to 7 mg
    const result = cleanRun(runOf(T, mg, 'mg'), null, { initialMassMg: 10 }, DEFAULT_CLEAN);
    if (!result.ok) throw new Error(result.error);
    expect(result.curve.massPct[0]).toBeCloseTo(80, 10);
    expect(result.curve.massMg?.[20]).toBeCloseTo(7, 10);
    expect(result.curve.referenceMg).toBe(10);
  });

  it('uses the first mass as 100 % and says so when no initial mass is given', () => {
    const T = grid(30, 130, 21);
    const result = cleanRun(
      runOf(
        T,
        T.map((t) => 5 - 0.01 * (t - 30)),
        'mg',
      ),
      null,
      { initialMassMg: null },
      DEFAULT_CLEAN,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.curve.massPct[0]).toBeCloseTo(100, 10);
    expect(result.curve.notes.some((n) => n.text.includes('first mass value'))).toBe(true);
  });

  it('normalises to the mass at a chosen temperature and rescales the reference mass', () => {
    const T = grid(30, 330, 301);
    const pct = T.map((t) => (t < 130 ? 100 - 0.05 * (t - 30) : 95));
    const result = cleanRun(
      runOf(T, pct),
      null,
      { initialMassMg: 10 },
      { ...DEFAULT_CLEAN, normaliseAtC: 130 },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.curve.massPct[0]).toBeCloseTo(100 / 0.95, 8);
    expect(result.curve.massPct[300]).toBeCloseTo(100, 8);
    expect(result.curve.referenceMg).toBeCloseTo(9.5, 10);
  });

  it('subtracts a blank interpolated to the sample temperatures', () => {
    const T = grid(30, 230, 201);
    const drift = (t: number) => -0.002 * (t - 30);
    const sample = runOf(
      T,
      T.map((t) => 10 + drift(t) - (t > 130 ? 1 : 0)),
      'mg',
    );
    const blankT = grid(30, 230, 41);
    const blank = runOf(blankT, blankT.map(drift), 'mg');
    const result = cleanRun(
      sample,
      blank,
      { initialMassMg: 10 },
      { ...DEFAULT_CLEAN, useBlank: true },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.curve.massPct[0]).toBeCloseTo(100, 8);
    expect(result.curve.massPct[100]).toBeCloseTo(100, 8);
    expect(result.curve.massPct[200]).toBeCloseTo(90, 8);
  });

  it('refuses a blank in a different mass unit', () => {
    const T = grid(30, 130, 21);
    const result = cleanRun(
      runOf(
        T,
        T.map(() => 5),
        'mg',
      ),
      runOf(
        T,
        T.map(() => 5),
        'percent',
      ),
      { initialMassMg: 5 },
      { ...DEFAULT_CLEAN, useBlank: true },
    );
    expect(result.ok).toBe(false);
  });

  it('estimates the heating rate from time and temperature', () => {
    const t = grid(0, 100, 101);
    const run: ThermalRun = {
      ...runOf(
        t.map((v) => 25 + 10 * v),
        t.map(() => 1),
      ),
      timeMin: t,
    };
    expect(estimateHeatingRate(run)).toBeCloseTo(10, 8);
  });
});

describe('import', () => {
  const rows = (n: number, sep: string, decimal: string) =>
    Array.from({ length: n }, (_, i) =>
      [30 + i, i / 6, 10 - i * 0.01].map((v) => String(v).replace('.', decimal)).join(sep),
    ).join('\n');

  it('reads a tab-separated export with a header block and names/units rows', () => {
    const text = `Sample\tmy powder\nCrucible\tAl2O3\nTemp\tTime\tMass\n°C\tmin\tmg\n${rows(20, '\t', '.')}`;
    const result = importThermalText(text);
    if (!result.ok) throw new Error(result.error);
    expect(result.table.names).toEqual(['Temp °C', 'Time min', 'Mass mg']);
    expect(result.table.columns[0]).toHaveLength(20);
    expect(guessMapping(result.table)).toMatchObject({
      temperature: 0,
      temperatureUnit: 'C',
      time: 1,
      timeUnit: 'min',
      mass: 2,
      massUnit: 'mg',
    });
  });

  it('reads semicolons with decimal commas and commented header lines', () => {
    const text = `## Temp./°C;Time/s;Mass/%\n${rows(20, ';', ',')}`;
    const result = importThermalText(text);
    if (!result.ok) throw new Error(result.error);
    expect(result.table.notes.some((n) => n.text.includes('decimal comma'))).toBe(true);
    expect(result.table.columns[2]?.[1]).toBeCloseTo(9.99, 10);
    expect(guessMapping(result.table)).toMatchObject({
      timeUnit: 's',
      massUnit: 'percent',
      mass: 2,
    });
  });

  it('guesses temperature then mass for a file without header', () => {
    const result = importThermalText(rows(20, ',', '.').replace(/^(.*?),.*?,/gm, '$1,'));
    if (!result.ok) throw new Error(result.error);
    expect(guessMapping(result.table)).toMatchObject({ temperature: 0, mass: 1 });
  });

  it('does not take heat flow in mW for the mass column', () => {
    const text = `Temp/°C,Time/min,DSC/(mW/mg),Mass/%\n${Array.from({ length: 12 }, (_, i) => `${i},${i},0.${i},${100 - i}`).join('\n')}`;
    const result = importThermalText(text);
    if (!result.ok) throw new Error(result.error);
    expect(guessMapping(result.table)).toMatchObject({ heatFlow: 2, mass: 3 });
  });

  it('refuses binary files and tells the user to export text', () => {
    const result = importThermalFile(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('export');
    expect(importThermalFile(new Uint8Array(0)).ok).toBe(false);
  });

  it('reports a file without numbers in plain language', () => {
    const result = importThermalText('just words\nand more words');
    expect(!result.ok && result.error).toContain('No rows of numbers');
  });

  it('converts kelvin and seconds and warns when °C looks like kelvin', () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `${298.15 + i * 10}\t${i * 60}\t${10 - i * 0.1}`,
    ).join('\n');
    const result = importThermalText(text);
    if (!result.ok) throw new Error(result.error);
    const mapping = { ...guessMapping(result.table), temperature: 0, mass: 2, time: 1 };
    const kelvin = buildRun('a.txt', result.table, {
      ...mapping,
      temperatureUnit: 'K',
      timeUnit: 's',
    });
    if (!kelvin.ok) throw new Error(kelvin.error);
    expect(kelvin.run.temperatureC[0]).toBeCloseTo(25, 8);
    expect(kelvin.run.timeMin?.[1]).toBeCloseTo(1, 8);
    expect(kelvin.run.name).toBe('a');
    const celsius = buildRun('a.txt', result.table, { ...mapping, temperatureUnit: 'C' });
    if (!celsius.ok) throw new Error(celsius.error);
    expect(celsius.run.notes.some((n) => n.text.includes('kelvin'))).toBe(true);
  });

  it('rejects mappings that reuse a column or have no signal', () => {
    const result = importThermalText(rows(12, '\t', '.'));
    if (!result.ok) throw new Error(result.error);
    const base = guessMapping(result.table);
    expect(buildRun('a', result.table, { ...base, mass: base.temperature }).ok).toBe(false);
    expect(buildRun('a', result.table, { ...base, mass: null, heatFlow: null }).ok).toBe(false);
  });
});

describe('DTG deconvolution', () => {
  it('splits two overlapping Gaussian steps into their known losses', () => {
    const T = grid(30, 800, 3851);
    const close: SyntheticStep[] = [
      { loss: 25, peak: 300, sigma: 20 },
      { loss: 15, peak: 360, sigma: 20 },
    ];
    const m = syntheticMass(T, close, 0.01, 3);
    const d = dtg(T, m, 10);
    const limits = detectSteps(T, d, { prominencePercent: 3, minSeparationC: 20 });
    const { steps, regions } = analyseSteps(T, m, d, limits, null);
    const region = regions[0];
    if (!region) throw new Error('expected an overlap region');
    const result = deconvolveSteps(T, d, steps, region.fromC, region.toC);
    if (!result) throw new Error('no fit');
    expect(result.components).toHaveLength(2);
    result.components.forEach((c, k) => {
      const t = close[k] as SyntheticStep;
      expect(Math.abs(c.centerC - t.peak)).toBeLessThan(2);
      expect(Math.abs(c.lossPct - t.loss)).toBeLessThan(t.loss * 0.05);
      expect(c.fwhmC).toBeCloseTo(t.sigma * 2.3548, 0);
    });
    expect(result.rSquared).toBeGreaterThan(0.99);
  });
});

describe('example run', () => {
  it('goes through import, mapping, cleaning and detection and finds its three steps', () => {
    const table = exampleTgaTable();
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ temperature: 0, time: 1, mass: 2, massUnit: 'mg' });
    const built = buildRun('example', table, mapping);
    if (!built.ok) throw new Error(built.error);
    expect(estimateHeatingRate(built.run)).toBeCloseTo(10, 6);
    const cleaned = cleanRun(built.run, null, { initialMassMg: 10 }, DEFAULT_CLEAN);
    if (!cleaned.ok) throw new Error(cleaned.error);
    const { temperatureC, massPct } = cleaned.curve;
    expect(temperatureC[temperatureC.length - 1]).toBeCloseTo(800, 6);
    const d = dtg(temperatureC, massPct, 20);
    const { steps } = analyseSteps(
      temperatureC,
      massPct,
      d,
      detectSteps(temperatureC, d, DEFAULT_DETECT),
      10,
    );
    expect(steps).toHaveLength(EXAMPLE_STEPS.length);
    steps.forEach((s, k) => {
      expect(Math.abs(s.lossPct - (EXAMPLE_STEPS[k]?.loss as number))).toBeLessThan(0.5);
    });
  });
});
