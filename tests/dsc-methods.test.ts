import { describe, expect, it } from 'vitest';
import { heatCapacityBySapphire, sapphireCp } from '../src/core/thermal/heatCapacity';
import { oxidationInductionTime } from '../src/core/thermal/oit';
import { vantHoffPurity } from '../src/core/thermal/purity';
import {
  EXAMPLE_CP,
  EXAMPLE_OIT,
  EXAMPLE_PURITY,
  SAPPHIRE,
  exampleCpRuns,
  exampleOitRun,
  examplePurityRun,
} from '../src/modules/thermal/dscMethods/example';
import type { LoadedTable } from '../src/modules/thermal/data';

const col = (l: LoadedTable, i: number) => l.table.columns[i] as Float64Array;
const curve = (l: LoadedTable) => ({ temperatureC: col(l, 0), heatFlow: col(l, 1) });

describe('sapphire table', () => {
  it('returns the tabulated value divided by the molar mass, interpolated between rows', () => {
    expect(sapphireCp(SAPPHIRE, 300)).toBeCloseTo(79.41 / 101.9613, 10);
    expect(sapphireCp(SAPPHIRE, 305)).toBeCloseTo((79.41 + 81.51) / 2 / 101.9613, 10);
    expect(sapphireCp(SAPPHIRE, 150)).toBeNull();
    expect(sapphireCp(SAPPHIRE, 1200)).toBeNull();
  });

  it("agrees with the paper's own smoothing polynomials (Ditmars et al. 1982, eqs. 1c and 2)", () => {
    // Coefficients as printed in the paper; Cp in J/(mol·K), T in K.
    const A = [0.21993e2, 0.38853, 0.13955e-2, -0.83967e-4, 0.19133e-5, -0.31778e-7, 0.29562e-9];
    const factorial = [1, 1, 2, 6, 24, 120, 720];
    const low = (t: number) =>
      A.reduce((s, a, i) => s + (a / (factorial[i] as number)) * (t - 125) ** i, 0);
    const [a, b, c, d, e, f, g, h] = [
      6.6253e7, -4.54238e6, -5.475599e4, 2.574076e2, -8.57516e-2, 4.299063e-5, -1.15192e-8,
      1.26351e-12,
    ] as const;
    // Cp = dH/dT of H(T) = a/T² + b/T + c ln T + k + d T + e T² + f T³ + g T⁴ + h T⁵.
    const high = (t: number) =>
      -2 * a * t ** -3 -
      b * t ** -2 +
      c / t +
      d +
      2 * e * t +
      3 * f * t ** 2 +
      4 * g * t ** 3 +
      5 * h * t ** 4;
    for (const [t, cp] of SAPPHIRE.rows) {
      // Table values are rounded to 0.01; 273.15 K is the join of the two fits.
      expect(Math.abs(cp - (t < 273.15 ? low(t) : high(t)))).toBeLessThan(0.015);
    }
  });

  it('increases with temperature over the whole table', () => {
    const cp = SAPPHIRE.rows.map((r) => r[1]);
    for (let i = 1; i < cp.length; i++) expect(cp[i]).toBeGreaterThan(cp[i - 1] as number);
  });
});

describe('heat capacity by the sapphire method', () => {
  it('recovers the specific heat capacity of the synthetic sample', () => {
    const runs = exampleCpRuns();
    const out = heatCapacityBySapphire(
      SAPPHIRE,
      curve(runs.blank),
      curve(runs.sapphire),
      curve(runs.sample),
      { sapphireMg: EXAMPLE_CP.sapphireMg, sampleMg: EXAMPLE_CP.sampleMg },
      { fromC: 50, toC: 250, stepC: 10 },
    );
    expect(out.points).toHaveLength(21);
    for (const p of out.points) expect(p.cp).toBeCloseTo(EXAMPLE_CP.sampleCp(p.temperatureC), 3);
    expect(out.notes).toEqual([]);
  });

  it('gives the same answer with the opposite sign convention', () => {
    const runs = exampleCpRuns();
    const flip = (l: LoadedTable) => ({
      temperatureC: col(l, 0),
      heatFlow: col(l, 1).map((v) => -v),
    });
    const out = heatCapacityBySapphire(
      SAPPHIRE,
      flip(runs.blank),
      flip(runs.sapphire),
      flip(runs.sample),
      { sapphireMg: 25, sampleMg: 10 },
      { fromC: 100, toC: 100, stepC: 10 },
    );
    expect(out.points[0]?.cp).toBeCloseTo(EXAMPLE_CP.sampleCp(100), 3);
  });

  it('cuts the range to the overlap and says so', () => {
    const runs = exampleCpRuns();
    const out = heatCapacityBySapphire(
      SAPPHIRE,
      curve(runs.blank),
      curve(runs.sapphire),
      curve(runs.sample),
      { sapphireMg: 25, sampleMg: 10 },
      { fromC: 0, toC: 400, stepC: 20 },
    );
    expect(out.points[0]?.temperatureC).toBe(20);
    expect(out.notes[0]).toContain('only overlap from 20.0 to 300.0 °C');
  });
});

describe('van ’t Hoff purity', () => {
  const run = examplePurityRun();
  const T = col(run, 0);
  const endo = col(run, 1);
  const { x2, t0C, fusionKJ, molarMass, rateKPerMin } = EXAMPLE_PURITY;

  it('recovers the impurity, the pure melting point and the heat of fusion', () => {
    const out = vantHoffPurity({
      temperatureC: T,
      endo,
      fromC: T[0] as number,
      toC: t0C + 2,
      rateKPerMin,
      molarMass,
      fMin: 0.1,
      fMax: 0.5,
    });
    if (!out.ok) throw new Error(out.error);
    const r = out.result;
    // The ideal peak starts at F = 0.002 and ends with a jump between two grid points, so a little
    // of the area is missed; a few per cent is the expected accuracy here.
    expect(Math.abs(r.x2 / x2 - 1)).toBeLessThan(0.05);
    expect(Math.abs(r.t0C - t0C)).toBeLessThan(0.05);
    expect(Math.abs(r.fusionKJPerMol / fusionKJ - 1)).toBeLessThan(0.02);
    expect(r.purityMolPct).toBeCloseTo(99.5, 1);
    expect(r.rSquared).toBeGreaterThan(0.999);
  });

  it('refuses a range without a peak and an impossible fraction range', () => {
    const flat = vantHoffPurity({
      temperatureC: T,
      endo: endo.map(() => 0),
      fromC: 20,
      toC: 120,
      rateKPerMin,
      molarMass,
      fMin: 0.1,
      fMax: 0.5,
    });
    expect(flat.ok).toBe(false);
    const bad = vantHoffPurity({
      temperatureC: T,
      endo,
      fromC: 20,
      toC: 124,
      rateKPerMin,
      molarMass,
      fMin: 0.5,
      fMax: 0.1,
    });
    expect(bad.ok).toBe(false);
  });
});

describe('oxidation induction time', () => {
  const run = exampleOitRun();
  const time = col(run, 1);
  const exo = col(run, 2).map((v) => -v);

  it('finds the onset by the tangent and baseline intersection', () => {
    const out = oxidationInductionTime({
      timeMin: time,
      exo,
      switchMin: EXAMPLE_OIT.switchMin,
      baselineFromMin: null,
      baselineToMin: null,
    });
    if (!out.ok) throw new Error(out.error);
    expect(out.result.onsetMin).toBeCloseTo(EXAMPLE_OIT.onsetMin, 6);
    expect(out.result.oitMin).toBeCloseTo(27, 6);
    expect(out.result.notes).toEqual([]);
  });

  it('says so when no exotherm follows the switch', () => {
    const out = oxidationInductionTime({
      timeMin: time,
      exo: exo.map((v) => -v),
      switchMin: 5,
      baselineFromMin: null,
      baselineToMin: null,
    });
    expect(out.ok).toBe(false);
  });
});
