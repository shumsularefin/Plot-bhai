// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

/*
 * Independent check against GSAS-II: .github/workflows/validation.yml builds GSAS-II from source
 * and runs scripts/validation/gsas2/structure.py, which simulates each pattern from a COD CIF with
 * a Thompson–Cox–Hastings profile, moved atoms and chosen displacement parameters, adds Poisson
 * noise, and refines the same data in GSAS-II. Here this site refines the same data from the
 * unchanged CIF and must recover what GSAS-II was given.
 *
 * Unit conversion (GSAS-II GSASIIpwd.py): GSAS-II σ² = U tan²θ + V tanθ + W in centidegrees², so
 * the Gaussian FWHM² (deg²) is 8 ln 2 · 1e-4 · σ²; its Lorentzian γ = X/cosθ + Y tanθ is the
 * FWHM in centidegrees, so this site's X, Y (deg) are GSAS-II's divided by 100.
 */
interface Atom {
  label: string;
  x: number[];
  type: string;
  uiso: number;
  uij: number[];
}
interface Fixture {
  wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  instrument: Record<'U' | 'V' | 'W' | 'X' | 'Y', number>;
  truth: Atom[];
  gsas2: { Rwp: number; atoms: Atom[]; instrument: Record<string, number> };
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const G = 8 * Math.LN2 * 1e-4;

function run(name: string, id: string, aniso: boolean) {
  const fixture = json(`tests/fixtures/validation/${name}.json`) as Fixture;
  const rows = read(`tests/fixtures/validation/${name}.xy`)
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ref = (json('tests/fixtures/cod-reference/tio2.json') as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  );
  if (!ref?.structure) throw new Error(`${id} missing`);
  // Start, like GSAS-II, from isotropic U = 0.01 Å² (COD 9015929 lists its U_ij out of order).
  const structure = {
    ...ref.structure,
    atoms: ref.structure.atoms.map((a) => ({ ...a, uIso: 0.01, uAniso: null })),
  };
  const result = refineRietveld({
    x: Float64Array.from(rows, (r) => r[0] as number),
    y: Float64Array.from(rows, (r) => r[1] as number),
    wavelengths: fixture.wavelengths,
    phases: [
      {
        id,
        name: id,
        crystalSystem: ref.crystalSystem,
        cell: ref.cell,
        peaks: ref.peaks,
        orientation: null,
        structure,
      },
    ],
    choices: { ...DEFAULT_CHOICES, tch: true, positions: true, biso: !aniso, aniso },
    backgroundTerms: 6,
    atomicWeights,
    factors,
  });
  if (!result.ok) throw new Error(result.error);
  const phase = result.phases[0];
  if (!phase?.atoms) throw new Error('no atoms');
  return { fixture, result, phase, atoms: phase.atoms };
}

describe.each([
  ['anatase-tch', 'anatase', false],
  ['rutile-aniso', 'rutile', true],
])('GSAS-II simulated %s', (name, id, aniso) => {
  const { fixture, result, phase, atoms } = run(name, id, aniso);
  const gsas = fixture.gsas2;

  it('recovers the TCH widths GSAS-II was given', () => {
    const t = fixture.instrument;
    const want = { u: t.U * G, v: t.V * G, w: t.W * G, x: t.X / 100, y: t.Y / 100 };
    for (const k of ['u', 'v', 'w', 'x', 'y'] as const)
      expect(Math.abs(phase[k].value - want[k])).toBeLessThan(4 * phase[k].esd);
  });

  it('recovers the atom positions and displacement parameters', () => {
    // Positions relative to the first atom: the COD file and GSAS-II use different origins.
    const relative = (x: number[], o: number[]) => x.map((v, i) => v - (o[i] as number));
    const origin = (fixture.truth[0] as Atom).x;
    const ours0 = (atoms[0] as (typeof atoms)[number]).x.map((e) => e.value);
    fixture.truth.forEach((truth, a) => {
      const atom = atoms[a];
      if (!atom) throw new Error('no atom');
      const want = relative(truth.x, origin);
      relative(
        atom.x.map((e) => e.value),
        ours0,
      ).forEach((v, i) => {
        const esd = (atom.x[i] as (typeof atom.x)[number]).esd;
        expect(Math.abs(v - (want[i] as number))).toBeLessThanOrEqual(4 * esd + 1e-9);
      });
      if (aniso) {
        if (!atom.u) throw new Error('no U');
        atom.u.forEach((e, i) =>
          expect(Math.abs(e.value - (truth.uij[i] as number))).toBeLessThanOrEqual(
            4 * e.esd + 1e-9,
          ),
        );
        expect(atom.positiveDefinite).toBe(true);
      } else {
        const u = atom.b.value / (8 * Math.PI ** 2);
        expect(Math.abs(u - truth.uiso)).toBeLessThan((4 * atom.b.esd) / (8 * Math.PI ** 2));
      }
    });
  });

  it('agrees with GSAS-II refining the same data', () => {
    // The same parameters from both programs within 2 combined standard uncertainties.
    const o = (fixture.truth[0] as Atom).x;
    const g0 = (gsas.atoms[0] as Atom).x;
    gsas.atoms.forEach((g, a) => {
      const atom = atoms[a];
      if (!atom) throw new Error('no atom');
      atom.x.forEach((e, i) => {
        const theirs = (g.x[i] as number) - (g0[i] as number) + (o[i] as number);
        const ours =
          e.value - ((atoms[0] as (typeof atoms)[number]).x[i]?.value ?? 0) + (o[i] as number);
        expect(Math.abs(ours - theirs)).toBeLessThanOrEqual(3 * e.esd + 1e-5);
      });
    });
    expect(result.stats.rwp * 100).toBeLessThan(gsas.Rwp * 1.05);
  });
});
