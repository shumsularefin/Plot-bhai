// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import { rietveldMethods } from '../src/core/xrd/rietveld/report';
import { structureFactorSquared, structureModel } from '../src/core/xrd/rietveld/structure';
import {
  crystalAngles,
  crystalHarmonic,
  plmpsi,
  sampleHarmonic,
  textureBasis,
  textureCorrection,
  textureName,
  textureSymmetry,
  textureTerms,
  type TextureLaue,
  type TextureSymmetry,
} from '../src/core/xrd/rietveld/texture';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/texture.py (run on GitHub by
 * .github/workflows/validation.yml) wrote GSAS-II's Legendre functions (the Fortran PLMPSI), its
 * CrsAng angles, coefficient names (GenSHCoeffT) and crystal harmonics (GetKcl) for every Laue
 * class, its sample harmonics (GetKsl), the per-reflection preferred-orientation correction
 * (SHPOcal, reflection list column 12) of seven phases, and a ZnO pattern simulated with order-4
 * texture that it then refined.
 *
 * Where this site deliberately differs from GSAS-II (texture.ts): the azimuth of monoclinic and
 * triclinic cells whose angles are not 90°, the polar axis [111] of rhombohedral axes, the 3mR
 * harmonics, and the 31m terms with n = 3, 9, …. Each is checked here to differ as stated and
 * nowhere else; tests/texture.test.ts shows that this site's form gives equivalent reflections
 * the same correction.
 */
type G2Cell = {
  length_a: number;
  length_b: number;
  length_c: number;
  angle_alpha: number;
  angle_beta: number;
  angle_gamma: number;
};
interface Fixture {
  wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  instrument: Record<'Zero' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'SH/L' | 'Polariz.', number>;
  plm: { l: number; m: number; psi: number[]; p: number[] }[];
  functions: {
    laue: TextureLaue;
    unique: '' | 'a' | 'b' | 'c';
    cell: number[];
    order: number;
    names: string[];
    hkls: [number, number, number][];
    angles: [number, number][];
    kcl: number[][];
  }[];
  ksl: { l: number; psi: number[]; k: number[] }[];
  lnorm: Record<string, number>;
  patterns: {
    name: string;
    geometry: string;
    laue: TextureLaue;
    unique: string;
    cell: G2Cell;
    order: number;
    names: string[];
    coefficients: Record<string, number>;
    /** h, k, l, multiplicity, d (Å), 2θ (deg), correction. */
    reflections: [number, number, number, number, number, number, number][];
  }[];
  truth: { order: number; 'C(2,0)': number; 'C(4,0)': number };
  /** h, k, l, multiplicity, d, |F|², correction. */
  reflections: [number, number, number, number, number, number, number][];
  gsas2: {
    Rwp: number;
    coefficients: Record<string, number>;
    textureIndex: number;
    esd: Record<string, number>;
  };
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/texture.json') as Fixture;
const toCell = (c: number[]) => ({
  a: c[0] as number,
  b: c[1] as number,
  c: c[2] as number,
  alpha: c[3] as number,
  beta: c[4] as number,
  gamma: c[5] as number,
});
const fromG2 = (c: G2Cell) =>
  toCell([c.length_a, c.length_b, c.length_c, c.angle_alpha, c.angle_beta, c.angle_gamma]);
const symmetryOf = (laue: TextureLaue, unique: string): TextureSymmetry => ({
  laue,
  unique: unique === 'a' || unique === 'b' ? unique : 'c',
});
const termOf = (name: string) => name.slice(2, -1).split(',').map(Number) as [number, number];
/** Terms where this site's harmonic is not GSAS-II's (see the header). */
const differs = (laue: TextureLaue, n: number) =>
  laue === '3mR' ? n !== 0 : laue === '31m' && n % 6 === 3;
const right = (c: number[]) => c.slice(3).every((angle) => angle === 90);
/** Classes whose angles follow GSAS-II's formulas exactly. */
const sameAngles = (f: Fixture['functions'][number]) =>
  !(f.laue === '3R' || f.laue === '3mR') &&
  ((f.laue !== '-1' && f.laue !== '2/m') || right(f.cell));

describe('spherical-harmonic texture against GSAS-II', () => {
  it('has GSAS-II’s normalised Legendre functions (PLMPSI, single precision) for l ≤ 16', () => {
    expect(fixture.plm.length).toBe(152);
    for (const { l, m, psi, p } of fixture.plm)
      psi.forEach((angle, i) =>
        expect(Math.abs(plmpsi(l, m, angle) - (p[i] as number))).toBeLessThan(2e-5),
      );
  });

  it('has GSAS-II’s sample harmonics and normalisation', () => {
    for (const { l, psi, k } of fixture.ksl)
      psi.forEach((angle, i) =>
        expect(Math.abs(sampleHarmonic(l, angle) - (k[i] as number))).toBeLessThan(1e-5),
      );
    for (const [l, value] of Object.entries(fixture.lnorm))
      expect((4 * Math.PI) / (2 * Number(l) + 1)).toBeCloseTo(value, 12);
  });

  it('lists GSAS-II’s coefficients for every Laue class', () => {
    expect(fixture.functions.length).toBe(20);
    for (const f of fixture.functions)
      expect(textureTerms(f.laue, f.order).map(textureName), f.laue).toEqual(f.names);
  });

  it('has GSAS-II’s crystal angles where it follows GSAS-II, and differs only where stated', () => {
    let same = 0;
    let other = 0;
    for (const f of fixture.functions) {
      const cell = toCell(f.cell);
      f.hkls.forEach((hkl, i) => {
        const [phi, beta] = crystalAngles(hkl, cell, symmetryOf(f.laue, f.unique));
        const [gPhi, gBeta] = f.angles[i] as [number, number];
        if (sameAngles(f)) {
          expect(phi, `${f.laue} ${hkl.join(' ')} φ`).toBeCloseTo(gPhi, 4);
          // β only matters modulo 360° (and is undefined along the polar axis).
          if (Math.abs(Math.sin(phi * (Math.PI / 180))) > 1e-6)
            expect(Math.cos((beta - gBeta) * (Math.PI / 180)), `${f.laue} β`).toBeCloseTo(1, 8);
          same++;
        } else if (f.laue === '-1' || f.laue === '2/m') {
          // Same polar angle; the azimuth differs (exact here, GSAS-II's formula there).
          expect(phi).toBeCloseTo(gPhi, 4);
          other++;
        } else other++;
      });
    }
    expect(same).toBeGreaterThan(80);
    expect(other).toBeGreaterThan(20);
  });

  it('has GSAS-II’s crystal harmonics at GSAS-II’s angles (except the stated terms)', () => {
    let compared = 0;
    let deliberate = 0;
    for (const f of fixture.functions)
      f.hkls.forEach((_, i) => {
        const [phi, beta] = f.angles[i] as [number, number];
        f.names.forEach((name, t) => {
          const [l, n] = termOf(name);
          const ours = crystalHarmonic(l, n, f.laue, phi, beta);
          const theirs = (f.kcl[i] as number[])[t] as number;
          if (!differs(f.laue, n)) {
            expect(Math.abs(ours - theirs), `${f.laue} ${name}`).toBeLessThan(3e-5);
            compared++;
          } else deliberate++;
        });
      });
    expect(compared).toBeGreaterThan(1500);
    expect(deliberate).toBeGreaterThan(20);
  });

  it('gives GSAS-II’s correction of every reflection of seven phases, flat plate and capillary', () => {
    const spaceGroups: Record<string, [Parameters<typeof textureSymmetry>[0], number]> = {
      'zno-flat': ['hexagonal', 186],
      'zno-capillary': ['hexagonal', 186],
      ceo2: ['cubic', 225],
      corundum: ['hexagonal', 167],
      moo3: ['orthorhombic', 62],
      rutile: ['tetragonal', 136],
      wo3: ['monoclinic-beta', 14],
    };
    for (const pattern of fixture.patterns) {
      const [kind, sg] = spaceGroups[pattern.name] as [
        Parameters<typeof textureSymmetry>[0],
        number,
      ];
      const symmetry = textureSymmetry(kind, sg);
      // The site picks GSAS-II's Laue class from the crystal system and space group.
      expect(symmetry.laue, pattern.name).toBe(pattern.laue);
      const terms = textureTerms(symmetry.laue, pattern.order);
      expect(terms.map(textureName)).toEqual(pattern.names);
      const coefficients = pattern.names.map((n) => pattern.coefficients[n] as number);
      const cell = fromG2(pattern.cell);
      let worst = 0;
      for (const [h, k, l, , , twoTheta, theirs] of pattern.reflections) {
        const psi = pattern.geometry === 'Debye-Scherrer' ? twoTheta / 2 : 90;
        const ours = textureCorrection(
          coefficients,
          textureBasis(terms, [h, k, l], cell, symmetry, psi),
        );
        worst = Math.max(worst, Math.abs(ours - theirs));
      }
      // WO3 (β = 90.9°): GSAS-II's approximate monoclinic azimuth (see the header) moves its
      // correction by up to a few 10⁻³; every other phase agrees to single precision.
      expect(worst, pattern.name).toBeLessThan(pattern.name === 'wo3' ? 1e-2 : 2e-5);
    }
    // The capillary corrections differ from the flat-plate ones (ψ = θ, not 90°).
    const flat = fixture.patterns.find((p) => p.name === 'zno-flat');
    const capillary = fixture.patterns.find((p) => p.name === 'zno-capillary');
    expect(
      Math.max(
        ...(capillary?.reflections ?? []).map((r, i) =>
          Math.abs(r[6] - (flat?.reflections[i]?.[6] ?? 0)),
        ),
      ),
    ).toBeGreaterThan(0.05);
  });

  it('recovers the texture GSAS-II was given and agrees with GSAS-II’s refinement', () => {
    const rows = read('tests/fixtures/validation/zno-texture.xy')
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
    const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
      (p) => p.id === 'zno-wurtzite',
    ) as ReferencePhase;
    const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
      .factors;
    const stored = zno.structure as NonNullable<ReferencePhase['structure']>;
    const model = structureModel(
      zno.cell,
      { ...stored, atoms: stored.atoms.map((a) => ({ ...a, uIso: 0, uAniso: null })) },
      factors,
      {},
      false,
    );
    const states = model.atoms.map((a) => ({
      x: a.x0,
      occupancy: a.occupancy0,
      b: a.b0,
      fraction: 0,
    }));
    const peaks = zno.peaks.map((peak) => ({
      ...peak,
      mf2: refinementReflections([peak], zno.cell, cellKind(zno.crystalSystem, zno.cell), 0.5)
        .flatMap((r) => r.members)
        .reduce((sum, hkl) => sum + structureFactorSquared(model, states, hkl, peak.d), 0),
    }));
    const atomicWeights = Object.fromEntries(
      (
        json('data/thermal/atomic-weights.json') as {
          elements: { symbol: string; weight: number }[];
        }
      ).elements.map((e) => [e.symbol, e.weight]),
    );
    const G = 8 * Math.LN2 * 1e-4;
    const ip = fixture.instrument;
    const choices = {
      ...DEFAULT_CHOICES,
      zero: false,
      orientation: true,
      size: true,
      strain: true,
    };
    const result = refineRietveld({
      x: Float64Array.from(rows, (r) => r[0] as number),
      y: Float64Array.from(rows, (r) => r[1] as number),
      wavelengths: { ...fixture.wavelengths, polarisation: ip['Polariz.'] },
      phases: [
        {
          id: zno.id,
          name: zno.name,
          crystalSystem: zno.crystalSystem,
          cell: zno.cell,
          peaks,
          orientation: null,
          spaceGroupNumber: 186,
          textureOrder: fixture.truth.order,
        },
      ],
      choices,
      backgroundTerms: 6,
      atomicWeights,
      instrument: {
        u: ip.U * G,
        v: ip.V * G,
        w: ip.W * G,
        x: ip.X / 100,
        y: ip.Y / 100,
        shl: ip['SH/L'],
      },
    });
    if (!result.ok) throw new Error(result.error);
    const texture = result.phases[0]?.texture;
    if (!texture) throw new Error('no texture result');
    expect(texture.laue).toBe('6/mmm');
    expect(texture.coefficients.map((c) => c.name)).toEqual(['C(2,0)', 'C(4,0)']);
    const g = fixture.gsas2;
    for (const { name, value } of texture.coefficients) {
      const theirs = g.coefficients[name] as number;
      const theirsEsd = g.esd[`0:0:${name}`] as number;
      // GSAS-II's value within 3 combined s.u., the truth within 3 s.u. of ours.
      expect(Math.abs(value.value - theirs)).toBeLessThan(3 * Math.hypot(value.esd, theirsEsd));
      const truth = fixture.truth[name as 'C(2,0)' | 'C(4,0)'];
      expect(Math.abs(value.value - truth)).toBeLessThan(3 * value.esd);
      // Uncertainties of the same size as GSAS-II's (within 25 %).
      expect(value.esd / theirsEsd).toBeGreaterThan(0.75);
      expect(value.esd / theirsEsd).toBeLessThan(1.25);
    }
    expect(Math.abs(texture.index.value - g.textureIndex)).toBeLessThan(3 * texture.index.esd);
    expect(Math.abs(result.stats.rwp * 100 - g.Rwp) / g.Rwp).toBeLessThan(0.02);
    expect(texture.range[0]).toBeGreaterThan(0);
    // The reflection list carries each correction; the methods text names the model.
    const row002 = result.phases[0]?.reflections.find((r) => r.hkl[0] === 0 && r.hkl[1] === 0);
    const gsas002 = fixture.reflections.find(
      (r) => r[0] === 0 && r[1] === 0 && Math.abs(r[2]) === 2,
    );
    expect(row002?.hkl.map(Math.abs)).toEqual([0, 0, 2]);
    expect(Math.abs((row002?.orientation ?? 0) - (gsas002?.[6] as number))).toBeLessThan(0.01);
    const text = rietveldMethods({
      result,
      choices,
      backgroundTerms: 6,
      phases: [{ name: 'ZnO', reference: 'COD 1577381' }],
      radiation: 'Cu Kα1/Kα2',
    });
    expect(text).toMatch(/spherical-harmonic/);
    expect(text).toMatch(/texture index J = 1\.0\d+\(\d+\)/);
    expect(text).not.toContain('March–Dollase');
  }, 240_000);
});
