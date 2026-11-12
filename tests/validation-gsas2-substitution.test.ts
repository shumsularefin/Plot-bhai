// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import { structureFactorSquared, structureModel } from '../src/core/xrd/rietveld/structure';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/substitution.py (run on GitHub by
 * .github/workflows/validation.yml) simulated Zn0.85Mg0.15O from the ZnO CIF (COD 1577381) with Mg
 * as a second atom on the Zn site, added Poisson noise, and refined the two fractions in GSAS-II
 * under the constraint Frac(Zn) + Frac(Mg) = 1. Here the site refines the same data with Mg placed
 * on the Zn site as a substitution (structure.ts) and the same fixed instrument.
 */
interface Fixture {
  wavelengths?: never;
  instrument: Record<'U' | 'V' | 'W' | 'X' | 'Y' | 'Lam1' | 'Lam2' | 'I(L2)/I(L1)', number>;
  truth: { xMg: number; uZn: number; uO: number; cell: { length_a: number; length_c: number } };
  reflections: [number, number, number, number, number, number][];
  gsas2: {
    Rwp: number;
    atoms: { label: string; frac: number }[];
    dependentEsd: Record<string, number>;
  };
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/znmgo-substitution.json') as Fixture;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
  (p) => p.id === 'zno-wurtzite',
) as ReferencePhase;
// Isotropic, with the values GSAS-II was given (the CIF also lists U_ij).
const stored = zno.structure as NonNullable<ReferencePhase['structure']>;
const structure = {
  ...stored,
  atoms: stored.atoms.map((a) => ({
    ...a,
    uIso: a.element === 'Zn' ? fixture.truth.uZn : fixture.truth.uO,
    uAniso: null,
  })),
};
const G = 8 * Math.LN2 * 1e-4;
const ip = fixture.instrument;
const xMgGsas = fixture.gsas2.atoms.find((a) => a.label === 'Mg1')?.frac ?? NaN;
const esdGsas = fixture.gsas2.dependentEsd['0::Afrac:2'] as number;

describe('Shared-site substitution against GSAS-II (Zn0.85Mg0.15O)', () => {
  it('gives GSAS-II’s |F|² for every reflection of the mixed site', () => {
    // The CIF gives Zn at 0.3333, 0.6667; both programs place it exactly at 1/3, 2/3.
    const model = structureModel(zno.cell, structure, factors, {}, false, [
      { site: 'Zn', element: 'Mg', fraction: fixture.truth.xMg, refine: false },
    ]);
    const states = model.atoms.map((a) => ({
      x: a.x0,
      occupancy: a.occupancy0,
      b: a.b0,
      fraction: a.substitute ? fixture.truth.xMg : 0,
    }));
    // Relative to each reflection, or to 10⁻³ of the strongest for reflections that are zero by
    // symmetry (GSAS-II keeps round-off values of about 10⁻¹² there).
    const strongest = Math.max(...fixture.reflections.map((r) => r[5]));
    for (const [h, k, l, , d, f2] of fixture.reflections) {
      const ours = structureFactorSquared(model, states, [h, k, l], d);
      expect(Math.abs(ours - f2)).toBeLessThan(5e-5 * Math.max(f2, 1e-3 * strongest));
    }
    expect(fixture.reflections.length).toBeGreaterThan(20);
  });

  it('refines x as GSAS-II does and recovers the true fraction', () => {
    const rows = read('tests/fixtures/validation/znmgo-substitution.xy')
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
    const result = refineRietveld({
      x: Float64Array.from(rows, (r) => r[0] as number),
      y: Float64Array.from(rows, (r) => r[1] as number),
      wavelengths: { kAlpha1: ip.Lam1, kAlpha2: ip.Lam2, ratio: ip['I(L2)/I(L1)'] },
      phases: [
        {
          id: zno.id,
          name: zno.name,
          crystalSystem: zno.crystalSystem,
          cell: zno.cell,
          peaks: zno.peaks,
          orientation: null,
          structure,
          substitutions: [{ site: 'Zn', element: 'Mg', fraction: 0.05, refine: true }],
        },
      ],
      choices: { ...DEFAULT_CHOICES, zero: false },
      backgroundTerms: 6,
      atomicWeights,
      factors,
      instrument: { u: ip.U * G, v: ip.V * G, w: ip.W * G, x: ip.X / 100, y: ip.Y / 100 },
    });
    if (!result.ok) throw new Error(result.error);
    const x = result.phases[0]?.atoms?.find((a) => a.label === 'Zn')?.substitute?.fraction;
    if (!x) throw new Error('no fraction');
    // Within 3 s.u. of the truth and of GSAS-II; uncertainty as GSAS-II's within 25 %.
    expect(Math.abs(x.value - fixture.truth.xMg)).toBeLessThan(3 * x.esd);
    expect(Math.abs(x.value - xMgGsas)).toBeLessThan(3 * Math.hypot(x.esd, esdGsas));
    expect(x.esd / esdGsas).toBeGreaterThan(0.75);
    expect(x.esd / esdGsas).toBeLessThan(1.25);
    expect(Math.abs(result.stats.rwp * 100 - fixture.gsas2.Rwp) / fixture.gsas2.Rwp).toBeLessThan(
      0.03,
    );
  }, 120_000);
});
