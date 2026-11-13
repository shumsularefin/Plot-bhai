// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instprm, phaseCif, refinedStructure, tchExact } from '../src/core/xrd/export/gsas';
import { countingSigma, patternXye } from '../src/core/xrd/patternFile';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, StoredStructure } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

/*
 * The GSAS-II starting set of the Export step, loaded into GSAS-II itself.
 *
 * This site refines tests/fixtures/validation/anatase-tch.xy (a pattern simulated by GSAS-II, see
 * validation-gsas2.test.ts) and writes the three files of the Export step: .xye, .instprm and the
 * CIF with the refined cell and atoms. scripts/validation/gsas2/load_export.py loads exactly those
 * files into GSAS-II, records what GSAS-II read from them, and calculates the pattern with only
 * the scale and background refined. Its record is tests/fixtures/validation/gsas-export.json.
 * The same check first showed that GSAS-II could not read an .instprm with two comment lines.
 *
 * To write the files for that script: GSAS_EXPORT_DIR=<dir> npx vitest run tests/validation-gsas-export.test.ts
 */
interface Fixture {
  points: number;
  firstSigma: number;
  instrument: Record<string, number>;
  spaceGroup: string;
  cell: number[];
  atoms: { label: string; element: string; x: number[]; occupancy: number; uiso: number }[];
  rwpAsExported: number;
  rwpContinued: number;
  cellContinued: number[];
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const WAVELENGTHS = { kAlpha1: 1.5405929, kAlpha2: 1.5444274, ratio: 0.5 };

function exported() {
  const rows = read('tests/fixtures/validation/anatase-tch.xy')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const x = Float64Array.from(rows, (r) => r[0] as number);
  const y = Float64Array.from(rows, (r) => r[1] as number);
  const ref = (json('tests/fixtures/cod-reference/tio2.json') as ReferenceFamilyFile).phases.find(
    (p) => p.id === 'anatase',
  );
  if (!ref?.structure) throw new Error('anatase missing');
  const structure: StoredStructure = {
    ...ref.structure,
    atoms: ref.structure.atoms.map((a) => ({ ...a, uIso: 0.01, uAniso: null })),
  };
  const result = refineRietveld({
    x,
    y,
    wavelengths: WAVELENGTHS,
    phases: [
      {
        id: ref.id,
        name: ref.name,
        crystalSystem: ref.crystalSystem,
        cell: ref.cell,
        peaks: ref.peaks,
        orientation: null,
        structure,
      },
    ],
    choices: { ...DEFAULT_CHOICES, tch: true, positions: true, biso: true },
    backgroundTerms: 6,
    atomicWeights: Object.fromEntries(
      (
        json('data/thermal/atomic-weights.json') as {
          elements: { symbol: string; weight: number }[];
        }
      ).elements.map((e) => [e.symbol, e.weight]),
    ),
    factors: (json('data/reference/scattering-factors.json') as { factors: FormFactors }).factors,
  });
  if (!result.ok) throw new Error(result.error);
  const fit = result.phases[0];
  if (!fit) throw new Error('no phase');
  const sigma = countingSigma({ intensity: y, intensityUnit: 'counts' });
  if (!sigma.ok) throw new Error(sigma.reason);
  const profile = tchExact({
    u: fit.u.value,
    v: fit.v.value,
    w: fit.w.value,
    x: fit.x.value,
    y: fit.y.value,
  });
  const cell = {
    a: fit.cell.a.value,
    b: fit.cell.b.value,
    c: fit.cell.c.value,
    alpha: fit.cell.alpha.value,
    beta: fit.cell.beta.value,
    gamma: fit.cell.gamma.value,
  };
  const refined = refinedStructure(structure, fit);
  return {
    result,
    profile,
    cell,
    refined,
    sigma: sigma.sigma,
    points: x.length,
    files: {
      'anatase.xye': patternXye(x, y, sigma.sigma, {
        header: ['anatase-tch.xy', sigma.how],
        wavelengthA: WAVELENGTHS.kAlpha1,
        intensityLabel: 'intensity (counts)',
      }),
      'anatase.instprm': instprm({
        ...WAVELENGTHS,
        zero: result.zero.value,
        profile,
        comments: ['Profile from the Rietveld step (exact)'],
      }),
      'anatase.cif': phaseCif({
        name: ref.name,
        formula: ref.formula,
        spaceGroup: ref.spaceGroup,
        cell,
        structure: refined,
        comments: ['Cell and atoms from the Rietveld step (estimates)'],
      }),
    },
  };
}

describe('the exported GSAS-II starting set, loaded into GSAS-II', () => {
  const out = exported();
  const dir = process.env.GSAS_EXPORT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(out.files)) writeFileSync(join(dir, name), text);
    writeFileSync(join(dir, 'site.json'), JSON.stringify({ rwp: out.result.stats.rwp * 100 }));
  }
  const gsas = json('tests/fixtures/validation/gsas-export.json') as Fixture;

  it('GSAS-II reads every point and its σ from the .xye', () => {
    expect(gsas.points).toBe(out.points);
    expect(gsas.firstSigma).toBeCloseTo(out.sigma[0] as number, 6);
  });

  it('GSAS-II reads the wavelengths, zero and profile as written in the .instprm', () => {
    const want: Record<string, number> = {
      Lam1: WAVELENGTHS.kAlpha1,
      Lam2: WAVELENGTHS.kAlpha2,
      'I(L2)/I(L1)': WAVELENGTHS.ratio,
      Zero: out.result.zero.value,
      'Polariz.': 0.5,
      U: out.profile.u,
      V: out.profile.v,
      W: out.profile.w,
      X: out.profile.x,
      Y: out.profile.y,
    };
    // The writer keeps 8 significant figures.
    for (const [key, value] of Object.entries(want))
      expect(Math.abs((gsas.instrument[key] as number) - value)).toBeLessThanOrEqual(
        1e-7 * Math.abs(value) + 1e-12,
      );
  });

  it('GSAS-II reads the space group, cell and atoms as written in the CIF', () => {
    expect(gsas.spaceGroup.replace(/\s+/g, '')).toBe('I41/amd');
    const c = out.cell;
    [c.a, c.b, c.c, c.alpha, c.beta, c.gamma].forEach((v, i) =>
      expect(Math.abs((gsas.cell[i] as number) - v)).toBeLessThan(1e-6 * v),
    );
    expect(gsas.atoms).toHaveLength(out.refined.atoms.length);
    // GSAS-II moves the atoms from origin choice 1 (the CIF) to its own origin choice 2, so the
    // positions are compared relative to the first atom.
    const ours0 = (out.refined.atoms[0] as (typeof out.refined.atoms)[number]).x;
    const theirs0 = (gsas.atoms[0] as Fixture['atoms'][number]).x;
    out.refined.atoms.forEach((atom, i) => {
      const g = gsas.atoms[i];
      if (!g) throw new Error('no atom');
      expect(g.element).toBe(atom.element);
      atom.x.forEach((v, k) =>
        expect(
          Math.abs((g.x[k] as number) - (theirs0[k] as number) - (v - (ours0[k] as number))),
        ).toBeLessThan(1e-6),
      );
      expect(g.occupancy).toBeCloseTo(atom.occupancy, 6);
      expect(g.uiso).toBeCloseTo(atom.uIso as number, 6);
    });
  });

  it('GSAS-II fits the data with the exported model as well as this site does', () => {
    // Only scale and background refined in GSAS-II: R_wp within 5 % (relative) of this site's.
    const ours = out.result.stats.rwp * 100;
    expect(gsas.rwpAsExported).toBeLessThan(ours * 1.05);
    // Continuing the refinement in GSAS-II (cell, zero, profile, atoms) barely changes it.
    expect(gsas.rwpContinued).toBeGreaterThan(gsas.rwpAsExported * 0.95);
    [out.cell.a, out.cell.b, out.cell.c].forEach((v, i) =>
      expect(Math.abs((gsas.cellContinued[i] as number) - v)).toBeLessThan(2e-5 * v),
    );
  });
});
