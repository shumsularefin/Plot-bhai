// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import { parseCif } from '../src/core/xrd/reference/cif';
import {
  crystalFromCif,
  patternFor,
  reflections,
  type FormFactors,
} from '../src/core/xrd/reference/powder';
import { applySymop, distance, type Vec3 } from '../src/core/xrd/structure/geometry';

/*
 * Independent check against pymatgen: .github/workflows/validation.yml runs
 * scripts/validation/pymatgen/check.py on the same COD CIFs and stores, per asymmetric-unit site,
 * every interatomic distance up to 3.2 Å (Structure.get_neighbors) and the Cu Kα1 powder pattern
 * from 10 to 100° 2θ without displacement factors (XRDCalculator). pymatgen uses its own
 * scattering-factor table, so intensities are compared with a tolerance, positions exactly.
 */
interface Case {
  cod: string;
  sites: { label: string; distances: number[] }[];
  peaks: { twoTheta: number; i: number; d: number }[];
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/validation/pymatgen.json')) as {
  source: string;
  cases: Case[];
};
const factors = (
  JSON.parse(read('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;
const RANGE = 3.2;

describe.each(fixture.cases)(`${fixture.source}: COD $cod`, (c) => {
  const crystal = crystalFromCif(parseCif(read(`scripts/cif-cache/${c.cod}.cif`)), factors);

  it('gives the same interatomic distances from each site', () => {
    for (const site of c.sites) {
      const atom = crystal.atoms.find((a) => a.label === site.label);
      if (!atom) throw new Error(`no ${site.label}`);
      // One distance per distinct image position (several operators can give the same one).
      const unique = dedupe(crystal, atom.x);
      expect(unique.length).toBe(site.distances.length);
      unique.forEach((d, i) => expect(d).toBeCloseTo(site.distances[i] as number, 4));
    }
  });

  it('gives the same powder lines and similar intensities', () => {
    const ours = patternFor(
      reflections(crystal, factors, ANODES.Cu.kAlpha1 / 2),
      ANODES.Cu.kAlpha1,
    ).filter((p) => p.twoTheta >= 10 && p.twoTheta <= 100);
    const match = (d: number) => ours.find((p) => Math.abs(p.d - d) < 1e-5);
    for (const q of c.peaks) {
      const p = match(q.d);
      expect(p).toBeDefined();
      // Different scattering-factor tables (pymatgen's own fit; here International Tables Vol. C,
      // four Gaussians): within 5 % of the strongest line. Worst seen: rutile 4.0,
      // baddeleyite 2.0, tenorite 1.7, anatase 0.6.
      expect(Math.abs((p?.intensity ?? 0) - q.i)).toBeLessThan(5);
    }
    // pymatgen leaves out the weakest lines (below about 0.03 % of the strongest), nothing else.
    for (const p of ours)
      if (!c.peaks.some((q) => Math.abs(p.d - q.d) < 1e-5)) expect(p.intensity).toBeLessThan(0.05);
  });
});

/** Distances (Å, ascending) from x to every atom image within RANGE, one per distinct position. */
function dedupe(crystal: ReturnType<typeof crystalFromCif>, x: Vec3): number[] {
  const positions = new Map<string, number>();
  for (const other of crystal.atoms)
    for (const op of crystal.ops) {
      const y = applySymop(op, other.x);
      for (let i = -3; i <= 3; i++)
        for (let j = -3; j <= 3; j++)
          for (let k = -3; k <= 3; k++) {
            const z: Vec3 = [y[0] + i, y[1] + j, y[2] + k];
            const d = distance(crystal.cell, x, z);
            if (d > 1e-3 && d <= RANGE) positions.set(z.map((v) => v.toFixed(3)).join(), d);
          }
    }
  return [...positions.values()].sort((a, b) => a - b);
}
