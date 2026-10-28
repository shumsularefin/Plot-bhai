import { describe, expect, it } from 'vitest';
import { dtg } from '../src/core/thermal/smooth';
import {
  coatsRedfern,
  friedman,
  GAS_CONSTANT,
  isoconversional,
  REACTION_MODELS,
  kissinger,
  peakTemperature,
  rateWarnings,
  resultWarnings,
  temperaturesAtConversion,
  type MassRun,
} from '../src/core/thermal/kinetics';
import { syntheticFirstOrderMass, type KineticModel } from '../src/core/thermal/synthetic';

// Made-up reaction: Ea = 150 kJ/mol, A = 1e14 per minute. Not a real material.
const MODEL: KineticModel = { eaKJ: 150, aPerMin: 1e14, lossPct: 40 };
const RATES = [2, 5, 10, 20, 40];

function runAt(beta: number): MassRun {
  const { temperatureC, massPct } = syntheticFirstOrderMass(
    MODEL,
    beta,
    GAS_CONSTANT,
    100,
    600,
    0.1,
  );
  return { betaKPerMin: beta, temperatureC, massPct };
}
const runs = RATES.map(runAt);

describe('peakTemperature', () => {
  it('finds a Gaussian peak centre between grid points', () => {
    const t = Float64Array.from({ length: 400 }, (_, i) => 100 + i * 0.5);
    const s = t.map((x) => 5 * Math.exp(-0.5 * ((x - 250.3) / 8) ** 2) + 0.01 * x);
    const peak = peakTemperature(t, s, 150, 350, 'max');
    expect(peak?.tpC).toBeCloseTo(250.3, 1);
    expect(peak?.atEdge).toBe(false);
  });
  it('finds a downward peak and flags a peak cut by the window', () => {
    const t = Float64Array.from({ length: 400 }, (_, i) => 100 + i * 0.5);
    const s = t.map((x) => -3 * Math.exp(-0.5 * ((x - 200) / 6) ** 2));
    expect(peakTemperature(t, s, 150, 250, 'min')?.tpC).toBeCloseTo(200, 1);
    expect(peakTemperature(t, s, 201, 260, 'min')?.atEdge).toBe(true);
  });
});

describe('Kissinger', () => {
  it('recovers the activation energy of a first-order reaction within 3 %', () => {
    const peaks = runs.map((r) => {
      const d = dtg(r.temperatureC, r.massPct, 3);
      const p = peakTemperature(r.temperatureC, d, 100, 600, 'max');
      return { betaKPerMin: r.betaKPerMin, tpC: p?.tpC as number };
    });
    const result = kissinger(peaks);
    expect(result?.eaKJ).toBeGreaterThan(150 * 0.97);
    expect(result?.eaKJ).toBeLessThan(150 * 1.03);
    expect(result?.rSquared).toBeGreaterThan(0.999);
  });
  it('is exact for peaks placed on a straight Kissinger line', () => {
    const ea = 120; // kJ/mol
    const peaks = [3, 6, 12, 24].map((beta) => {
      // Choose Tp, then it is consistent by construction: ln(β/Tp²) = c − Ea/(R Tp).
      const tp = 400 + 10 * Math.log2(beta);
      return { betaKPerMin: beta, tpC: tp - 273.15 };
    });
    // Rebuild β from a chosen line to make the answer known exactly.
    const exact = peaks.map((p) => {
      const tp = p.tpC + 273.15;
      const lnBetaOverT2 = 5 - (ea * 1000) / (GAS_CONSTANT * tp);
      return { betaKPerMin: Math.exp(lnBetaOverT2) * tp * tp, tpC: p.tpC };
    });
    const result = kissinger(exact);
    expect(result?.eaKJ).toBeCloseTo(ea, 6);
    expect(result?.rSquared).toBeCloseTo(1, 10);
  });
  it('needs three runs', () => {
    expect(
      kissinger([
        { betaKPerMin: 5, tpC: 300 },
        { betaKPerMin: 10, tpC: 310 },
      ]),
    ).toBeNull();
  });
});

describe('isoconversional methods', () => {
  const alphas = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  it('finds the right conversion temperatures', () => {
    const temps = temperaturesAtConversion(runs[2] as MassRun, 100, 600, [0.5]);
    // At α = 0.5 the mass is 80 %; check it directly on the curve.
    const r = runs[2] as MassRun;
    const i = r.temperatureC.findIndex((t) => t >= (temps?.[0] as number));
    expect(r.massPct[i]).toBeCloseTo(80, 0);
  });
  it('KAS recovers Ea within 3 % at every conversion', () => {
    const result = isoconversional(runs, 100, 600, alphas, 'kas');
    expect(result).toHaveLength(alphas.length);
    for (const p of result) {
      expect(p.eaKJ).toBeGreaterThan(150 * 0.97);
      expect(p.eaKJ).toBeLessThan(150 * 1.03);
      expect(p.rSquared).toBeGreaterThan(0.999);
    }
  });
  it('FWO recovers Ea within 3 % at every conversion', () => {
    for (const p of isoconversional(runs, 100, 600, alphas, 'fwo')) {
      expect(p.eaKJ).toBeGreaterThan(150 * 0.97);
      expect(p.eaKJ).toBeLessThan(150 * 1.03);
    }
  });
  it('gives nothing with only two runs', () => {
    expect(isoconversional(runs.slice(0, 2), 100, 600, alphas, 'kas')).toEqual([]);
  });
  it('Starink recovers Ea within 1 % at every conversion', () => {
    const result = isoconversional(runs, 100, 600, alphas, 'starink');
    expect(result).toHaveLength(alphas.length);
    for (const p of result) expect(Math.abs(p.eaKJ - 150) / 150).toBeLessThan(0.01);
  });
  it('Friedman recovers Ea within 1 % from the DTG, with no temperature-integral approximation', () => {
    const withDtg = runs.map((r) => ({ ...r, dtg: dtg(r.temperatureC, r.massPct, 2) }));
    const result = friedman(withDtg, 100, 600, alphas);
    expect(result).toHaveLength(alphas.length);
    for (const p of result) {
      expect(Math.abs(p.eaKJ - 150) / 150).toBeLessThan(0.01);
      expect(p.rSquared).toBeGreaterThan(0.9999);
    }
  });
});

describe('Coats–Redfern', () => {
  it('ranks the true first-order model first and recovers Ea and A', () => {
    const result = coatsRedfern(runs[2] as MassRun, 100, 600, 0.1, 0.9);
    expect(result).toHaveLength(Object.keys(REACTION_MODELS).length);
    const best = result[0];
    expect(best?.model).toBe('F1');
    expect(best?.rSquared).toBeGreaterThan(0.9999);
    expect(Math.abs((best?.eaKJ as number) - 150) / 150).toBeLessThan(0.02);
    // The 1 − 2RT/E factor is dropped, so A is only approximate: within a factor of 3 of 1e14.
    expect(Math.abs(Math.log10(best?.aPerMin as number) - 14)).toBeLessThan(0.5);
  });
  it('has the g(α) expressions of the cited table', () => {
    expect(REACTION_MODELS.D1.g(0.5)).toBeCloseTo(0.25, 12);
    expect(REACTION_MODELS.R2.g(0.75)).toBeCloseTo(0.5, 12);
    expect(REACTION_MODELS.F2.g(0.5)).toBeCloseTo(1, 12);
    expect(REACTION_MODELS.A2.g(1 - Math.exp(-4))).toBeCloseTo(2, 12);
    expect(REACTION_MODELS.D3.g(1 - 0.125)).toBeCloseTo(0.25, 12);
    expect(REACTION_MODELS.D4.g(1 - 0.125)).toBeCloseTo(1 - 0.875 * (2 / 3) - 0.25, 12);
  });
  it('needs a mass loss in the window', () => {
    const t = Float64Array.from({ length: 50 }, (_, i) => 100 + i);
    const flat = { betaKPerMin: 10, temperatureC: t, massPct: t.map(() => 100) };
    expect(coatsRedfern(flat, 100, 150, 0.1, 0.9)).toEqual([]);
  });
});

describe('warnings', () => {
  it('asks for more runs, a wider range, and flags a varying Ea', () => {
    expect(rateWarnings([5, 10]).some((n) => n.level === 'warning')).toBe(true);
    expect(rateWarnings([5, 6, 7, 8, 9]).some((n) => /times the slowest/.test(n.text))).toBe(true);
    expect(rateWarnings([2, 5, 10, 20, 40])).toEqual([]);
    expect(resultWarnings([100, 200], [0.99, 0.99]).some((n) => /several steps/.test(n.text))).toBe(
      true,
    );
    expect(resultWarnings([150, 151], [0.99, 0.99]).some((n) => /several steps/.test(n.text))).toBe(
      false,
    );
    expect(resultWarnings([150], [0.9]).some((n) => /R²/.test(n.text))).toBe(true);
  });
});
