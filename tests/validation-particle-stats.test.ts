// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanSizes, summarise } from '../src/core/particles/distribution';
import {
  andersonDarlingNormal,
  coefficientOfVariation,
  logNormalCdfs,
  meanConfidenceInterval,
  momentMeans,
  studentTQuantile,
  volumePercentiles,
} from '../src/core/particles/statistics';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing value');
  return value;
}

/*
 * The particle size statistics of sub-stage 19f against NumPy and SciPy (docs/validation.md,
 * "19f"). The samples and the expected numbers are written by
 * scripts/validation/particles/distribution_stats.py.
 */

interface Ad {
  a2: number;
  critical5: number;
}
interface Case {
  sizes: number[];
  t975: number;
  sem: number;
  lower: number;
  upper: number;
  cv: number;
  d10: number;
  d32: number;
  d43: number;
  dv10: number;
  dv50: number;
  dv90: number;
  adNormal: Ad;
  adLognormal: Ad;
}
interface Fixture {
  cases: Record<string, Case>;
  tQuantiles: { nu: number; t975: number }[];
  normalTails: { z: number; logCdf: number; logSf: number }[];
}

const fixture = JSON.parse(
  readFileSync('tests/fixtures/validation/particle-stats-reference.json', 'utf8'),
) as Fixture;

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('Student t quantile against scipy.stats.t.ppf', () => {
  it.each(fixture.tQuantiles)('ν = $nu', ({ nu, t975 }) => {
    expect(rel(studentTQuantile(0.975, nu), t975)).toBeLessThan(1e-7);
  });
});

describe('Normal tails against scipy.stats.norm.logcdf and logsf', () => {
  it.each(fixture.normalTails)('z = $z', ({ z, logCdf, logSf }) => {
    const r = logNormalCdfs(z);
    expect(Math.abs(r.logCdf - logCdf)).toBeLessThan(1e-9 * Math.max(1, Math.abs(logCdf)));
    expect(Math.abs(r.logSf - logSf)).toBeLessThan(1e-9 * Math.max(1, Math.abs(logSf)));
  });
});

describe.each(Object.entries(fixture.cases))('sample %s', (_name, c) => {
  const sorted = cleanSizes(c.sizes);
  const summary = must(summarise(sorted));

  it('SEM and the 95 % interval of the mean', () => {
    const ci = must(meanConfidenceInterval(summary.mean, summary.sd, summary.count));
    expect(rel(ci.t, c.t975)).toBeLessThan(1e-7);
    expect(rel(ci.sem, c.sem)).toBeLessThan(1e-10);
    expect(rel(ci.lower, c.lower)).toBeLessThan(1e-9);
    expect(rel(ci.upper, c.upper)).toBeLessThan(1e-9);
  });

  it('CV and the moment means', () => {
    expect(rel(coefficientOfVariation(summary.sd, summary.mean), c.cv)).toBeLessThan(1e-10);
    const m = must(momentMeans(sorted));
    expect(rel(m.d10, c.d10)).toBeLessThan(1e-12);
    expect(rel(m.d32, c.d32)).toBeLessThan(1e-12);
    expect(rel(m.d43, c.d43)).toBeLessThan(1e-12);
  });

  it('volume-weighted D10, D50 and D90 match numpy.percentile (inverted_cdf, weights d³)', () => {
    const v = must(volumePercentiles(sorted));
    expect(v.dv10).toBe(c.dv10);
    expect(v.dv50).toBe(c.dv50);
    expect(v.dv90).toBe(c.dv90);
  });

  it('Anderson–Darling A² and the 5 % critical value match scipy.stats.anderson', () => {
    const normal = must(andersonDarlingNormal(sorted));
    const lognormal = must(andersonDarlingNormal(Array.from(sorted, Math.log)));
    expect(rel(normal.a2, c.adNormal.a2)).toBeLessThan(1e-7);
    expect(rel(lognormal.a2, c.adLognormal.a2)).toBeLessThan(1e-7);
    // SciPy rounds the critical values to three decimals.
    expect(Math.abs(normal.critical5 - c.adNormal.critical5)).toBeLessThanOrEqual(0.0005 + 1e-12);
    expect(normal.rejected).toBe(c.adNormal.a2 > c.adNormal.critical5);
    expect(lognormal.rejected).toBe(c.adLognormal.a2 > c.adLognormal.critical5);
  });
});
