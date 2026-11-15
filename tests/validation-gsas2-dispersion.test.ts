// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferencePhase } from '../src/core/xrd/reference/types';
import { dispersionFor, type DispersionFile } from '../src/core/xrd/rietveld/dispersion';
import {
  DEFAULT_CHOICES,
  refineRietveld,
  type RietveldInput,
} from '../src/core/xrd/rietveld/refine';
import { rietveldMethods } from '../src/core/xrd/rietveld/report';
import {
  capillaryDegrees,
  capillaryShift,
  cylinderAbsorption,
} from '../src/core/xrd/rietveld/sample';
import type { Hkl } from '../src/core/xrd/rietveld/reflections';
import {
  structureFactorSquared,
  structureModel,
  type StructureModel,
} from '../src/core/xrd/rietveld/structure';
import { applySymop } from '../src/core/xrd/structure/geometry';

/*
 * Independent check against GSAS-II (scripts/validation/gsas2/dispersion.py, run on GitHub by
 * .github/workflows/validation.yml): the f′, f″ table it wrote, its |F|² with anomalous dispersion
 * on for ZnS wurtzite (COD 1100044, non-centrosymmetric) and CoFe₂O₄ (COD 1533163), its cylinder
 * absorption Absorb('Cylinder') on a grid, and a CoFe₂O₄ capillary pattern it simulated (μR = 1.5,
 * DisplaceX = 30 µm, DisplaceY = −20 µm) and refined. The Henke tables (CXRO) are a second,
 * independent calculation of f′ = f1 − Z and f″ = f2.
 */
type GCell = { length_a: number };
interface Fixture {
  source: string;
  henke: { element: string; anode: string; eV: number; fp: number; fpp: number }[];
  structure: {
    name: string;
    cif: string;
    /** h, k, l, multiplicity, d (Å), |F|². */
    reflections: [number, number, number, number, number, number][];
  }[];
  absorb: { muR: number[]; twoTheta: number[]; values: number[][] };
  capillary: {
    cif: string;
    goniometerRadius: number;
    truth: { Absorption: number; DisplaceX: number; DisplaceY: number; cell: GCell };
    start: { Absorption: number };
    /** h, k, l, multiplicity, d (Å), 2θ (deg, Kα1, with the displacements), |F|². */
    reflections: [number, number, number, number, number, number, number][];
    gsas2: {
      Rwp: number;
      cell: GCell;
      Absorption: number;
      DisplaceX: number;
      DisplaceY: number;
      esd: Record<string, number>;
    };
  };
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/dispersion.json') as Fixture;
const table = json('data/reference/anomalous-dispersion.json') as DispersionFile;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const cu = dispersionFor(table, 'Cu') as NonNullable<ReturnType<typeof dispersionFor>>;
const RAD = Math.PI / 180;

/** The phase of a cached CIF with U = 0 for every atom, as GSAS-II was given. */
function phaseOf(cif: string): ReferencePhase {
  const read_ = phaseFromCif(read(`scripts/cif-cache/${cif}`), cif, factors, cif);
  if (!read_.ok) throw new Error(read_.error);
  const phase = read_.phase;
  const s = phase.structure as NonNullable<ReferencePhase['structure']>;
  return {
    ...phase,
    structure: { ...s, atoms: s.atoms.map((a) => ({ ...a, uIso: 0, uAniso: null })) },
  };
}

describe('The f′, f″ table (GSAS-II Cromer–Liberman)', () => {
  it('has every element with scattering factors at every anode’s Kα1 energy', () => {
    const elements = Object.keys(factors);
    expect(table.source).toContain('2c62562');
    expect(table.missing).toEqual(['H', 'He']);
    for (const [anode, lines] of Object.entries(ANODES)) {
      const entry = table.anodes[anode] as DispersionFile['anodes'][string];
      expect(entry.wavelength).toBe(lines.kAlpha1);
      expect(entry.keV).toBeCloseTo(12.397639 / lines.kAlpha1, 5);
      const filled = dispersionFor(table, anode) as Record<string, unknown>;
      for (const el of elements) expect(filled[el], `${anode} ${el}`).toBeDefined();
    }
  });

  it.each(fixture.henke.map((h) => [h.element, h.anode, h] as const))(
    '%s at %s Kα1 agrees with the Henke tables (|Δf′| ≤ 0.2 e, f″ within 5 %)',
    (element, anode, h) => {
      const [fp, fpp] = (dispersionFor(table, anode) as Record<string, [number, number]>)[
        element
      ] as [number, number];
      expect(Math.abs(fp - h.fp)).toBeLessThan(0.2);
      expect(Math.abs(fpp - h.fpp)).toBeLessThan(0.05 * h.fpp + 0.005);
    },
  );
});

/** F(h) summed directly with complex f = f0 + f′ + i f″ on the atoms of the site's model. */
function complexF(m: StructureModel, [h, k, l]: Hkl, d: number): [number, number] {
  const s2 = 1 / (4 * d * d);
  let re = 0;
  let im = 0;
  for (const atom of m.atoms) {
    let f0 = atom.factor[8];
    for (let i = 0; i < 4; i++)
      f0 += (atom.factor[i] as number) * Math.exp(-(atom.factor[i + 4] as number) * s2);
    const fr = f0 + atom.dispersion[0];
    const fi = atom.dispersion[1];
    for (const image of atom.images) {
      const x = applySymop(image.op, atom.x0);
      const p = 2 * Math.PI * (h * x[0] + k * x[1] + l * x[2]);
      re += atom.occupancy0 * (fr * Math.cos(p) - fi * Math.sin(p));
      im += atom.occupancy0 * (fr * Math.sin(p) + fi * Math.cos(p));
    }
  }
  return [re, im];
}
const abs2 = ([re, im]: [number, number]) => re * re + im * im;

describe('|F|² with anomalous dispersion against GSAS-II', () => {
  /*
   * GSAS-II's reflection list holds |F(h)|² of the h it lists. In a powder h and −h fall at the same
   * 2θ and both count in the multiplicity, so the site uses the mean of |F(h)|² and |F(−h)|²; the
   * two agree when the structure is centrosymmetric (CoFe₂O₄) and differ by up to a few per cent for
   * ZnS, where f″ breaks Friedel's law.
   */
  it.each(fixture.structure.map((s) => [s.name, s] as const))(
    '%s: |F(h)|² to 2 × 10⁻⁴, the site’s value is the Friedel mean, and f′, f″ matter',
    (name, s) => {
      const phase = phaseOf(s.cif);
      const structure = phase.structure as NonNullable<ReferencePhase['structure']>;
      const withF = structureModel(phase.cell, structure, factors, {}, false, [], cu);
      const without = structureModel(phase.cell, structure, factors, {}, false);
      const states = withF.atoms.map((a) => ({ x: a.x0, occupancy: a.occupancy0, b: 0 }));
      let largest = 0;
      let friedel = 0;
      // Relative to each reflection, or to 10⁻³ of the strongest for those zero by symmetry.
      const strongest = Math.max(...s.reflections.map((r) => r[5]));
      for (const [h, k, l, , d, f2] of s.reflections) {
        const floor = Math.max(f2, 1e-3 * strongest);
        const plus = abs2(complexF(withF, [h, k, l], d));
        const minus = abs2(complexF(withF, [-h, -k, -l], d));
        expect(Math.abs(plus - f2) / floor, `${h} ${k} ${l}`).toBeLessThan(2e-4);
        const ours = structureFactorSquared(withF, states, [h, k, l], d);
        expect(Math.abs(ours - (plus + minus) / 2) / floor).toBeLessThan(1e-10);
        friedel = Math.max(friedel, Math.abs(ours - f2) / floor);
        const plain = structureFactorSquared(without, states, [h, k, l], d);
        largest = Math.max(largest, Math.abs(plain - f2) / floor);
      }
      expect(largest).toBeGreaterThan(0.02);
      if (name === 'cofe2o4') expect(friedel).toBeLessThan(2e-4);
      else expect(friedel).toBeGreaterThan(0.01);
    },
  );
});

describe('Cylinder absorption against GSAS-II’s Absorb', () => {
  const { muR, twoTheta, values } = fixture.absorb;
  it.each(muR.map((m, i) => [m, i] as const))('μR = %s on the 2θ grid, to 10⁻¹²', (m, i) => {
    twoTheta.forEach((t, j) => {
      const expected = (values[i] as number[])[j] as number;
      expect(Math.abs(cylinderAbsorption(m, (t / 2) * RAD) - expected)).toBeLessThan(
        1e-12 * Math.max(1, expected),
      );
    });
  });
});

describe('Capillary refinement against GSAS-II', () => {
  const cap = fixture.capillary;
  const radius = cap.goniometerRadius;
  // Cu Kα1 only (see the script: GSAS-II places Kα2 by a first-order step, the site exactly).
  const ip = { kAlpha1: 1.5405929, kAlpha2: 1.5405929, ratio: 0 };

  it('places the reflections where GSAS-II put them (capillary displacement)', () => {
    const dx = capillaryDegrees(cap.truth.DisplaceX, radius);
    const dy = capillaryDegrees(cap.truth.DisplaceY, radius);
    for (const [, , , , d, pos] of cap.reflections) {
      const theta = Math.asin(ip.kAlpha1 / (2 * d));
      expect((2 * theta) / RAD + capillaryShift(dx, dy, theta)).toBeCloseTo(pos, 9);
    }
  });

  const rows = read('tests/fixtures/validation/cofe2o4-capillary.xy')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const phase = phaseOf(cap.cif);
  const atomicWeights = Object.fromEntries(
    (
      json('data/thermal/atomic-weights.json') as {
        elements: { symbol: string; weight: number }[];
      }
    ).elements.map((e) => [e.symbol, e.weight]),
  );
  const G = 8 * Math.LN2 * 1e-4;
  const input: RietveldInput = {
    x: Float64Array.from(rows, (r) => r[0] as number),
    y: Float64Array.from(rows, (r) => r[1] as number),
    wavelengths: { ...ip, polarisation: 0.5, correctionsAtKAlpha1: true, capillary: true },
    muR: cap.start.Absorption,
    dispersion: cu,
    phases: [
      {
        id: phase.id,
        name: 'CoFe2O4',
        crystalSystem: phase.crystalSystem,
        cell: phase.cell,
        peaks: phase.peaks,
        orientation: null,
        ...(phase.cellContents && { cellContents: phase.cellContents }),
        structure: phase.structure as NonNullable<ReferencePhase['structure']>,
      },
    ],
    choices: {
      ...DEFAULT_CHOICES,
      zero: false,
      displacement: true,
      transparency: true,
      width: false,
      widthSlope: false,
      absorption: true,
    },
    backgroundTerms: 6,
    atomicWeights,
    factors,
    radii: {},
    instrument: { u: 2 * G, v: -2 * G, w: 5 * G, x: 0.02, y: 0.03, shl: 0.002 },
  };
  const result = refineRietveld(input);
  if (!result.ok) throw new Error(result.error);
  const g = cap.gsas2;

  it('recovers μR, Dx and Dy as GSAS-II does, within 3 of GSAS-II’s s.u.', () => {
    const mu = result.absorption as NonNullable<typeof result.absorption>;
    expect(mu.refined).toBe(true);
    expect(Math.abs(mu.value - g.Absorption)).toBeLessThan(3 * (g.esd[':0:Absorption'] as number));
    expect(Math.abs(mu.value - cap.truth.Absorption)).toBeLessThan(0.01);
    const dx = capillaryDegrees(g.DisplaceX, radius);
    const dy = capillaryDegrees(g.DisplaceY, radius);
    const sx = Math.abs(capillaryDegrees(g.esd[':0:DisplaceX'] as number, radius));
    const sy = Math.abs(capillaryDegrees(g.esd[':0:DisplaceY'] as number, radius));
    expect(Math.abs(result.displacement.value - dx)).toBeLessThan(3 * sx);
    expect(Math.abs(result.transparency.value - dy)).toBeLessThan(3 * sy);
    expect(result.phases[0]?.cell.a.value).toBeCloseTo(g.cell.length_a, 4);
  });

  it('holds μR at 10, where the absorption formula ends, and says so', () => {
    expect(result.warnings.some((w) => w.includes('valid only up to μR'))).toBe(false);
    const high = refineRietveld({
      ...input,
      muR: 25,
      choices: { ...input.choices, absorption: false },
    });
    if (!high.ok) throw new Error(high.error);
    expect(high.absorption?.value).toBe(10);
    expect(high.warnings.some((w) => w.includes('valid only up to μR = 10'))).toBe(true);
  });

  it('fits to the noise (R_wp within 2 % of R_exp, not above GSAS-II’s) and reports μR, f′, f″', () => {
    // GSAS-II's own refit ends at R_wp 2.85 % against R_exp 2.89 % (validation.md, section 20).
    expect(result.converged).toBe(true);
    expect(Math.abs(result.stats.rwp / result.stats.rexp - 1)).toBeLessThan(0.02);
    expect(100 * result.stats.rwp).toBeLessThan(g.Rwp + 0.05);
    expect(result.anomalous).toBe(true);
    const text = rietveldMethods({
      result,
      choices: { ...DEFAULT_CHOICES, displacement: true, transparency: true, absorption: true },
      backgroundTerms: 6,
      phases: [{ name: 'CoFe2O4', reference: 'COD 1533163' }],
      radiation: 'Cu Kα1 radiation',
      capillary: true,
    });
    expect(text).toContain('capillary in Debye–Scherrer geometry');
    expect(text).toContain('μR = ');
    expect(text).toContain('Cromer–Liberman');
    expect(text).toContain('Dx cos 2θ');
  });
});
