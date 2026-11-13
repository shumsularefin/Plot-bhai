// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reciprocalMetric, type FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import {
  cosAngle,
  laueClass,
  stephensNames,
  stephensStrain,
  stephensTerms,
  uniaxialInverseSize,
  uniaxialStrain,
  type LaueClass,
} from '../src/core/xrd/rietveld/broadening';
import { fcjNodes } from '../src/core/xrd/rietveld/fcj';
import { cellKind } from '../src/core/xrd/rietveld/cell';
import { addProfiles, type PlacedPeak } from '../src/core/xrd/rietveld/model';
import { refinementReflections } from '../src/core/xrd/rietveld/reflections';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import { rietveldMethods } from '../src/core/xrd/rietveld/report';
import { sampleWidths } from '../src/core/xrd/rietveld/sample';
import { structureFactorSquared, structureModel } from '../src/core/xrd/rietveld/structure';
import { tchEta, tchFwhm } from '../src/core/xrd/rietveld/tch';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/anisotropic.py (run on GitHub by
 * .github/workflows/validation.yml) wrote GSAS-II's Finger–Cox–Jephcoat profile (getFCJVoigt3, the
 * Fortran PSVFCJO) on a grid, its Stephens terms (MustrainCoeff) for every Laue class, its
 * per-reflection widths of ZnO (COD 1577381) under uniaxial size, uniaxial microstrain and
 * generalized microstrain, and a ZnO pattern simulated with SH/L, uniaxial size and Stephens
 * microstrain that it then refined. GSAS-II units: widths in centidegrees, sig a Gaussian variance
 * (centideg²), gam a Lorentzian FWHM (centideg), size in µm, Shkl as here.
 */
type Cell = { length_a: number; length_b: number; length_c: number; angle_gamma: number };
interface WidthCase {
  name: string;
  size: [string, [number, number, number], [number, number, number]];
  mustrain: [string, number[] | null, [number, number, number], number?];
  cell: Cell;
  /** h, k, l, d (Å), 2θ (deg), sig (centideg²), gam (centideg). */
  reflections: [number, number, number, number, number, number, number][];
}
interface Fixture {
  source: string;
  wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  instrument: Record<'Zero' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Polariz.', number>;
  fcj: {
    pos: number;
    sig: number;
    gam: number;
    shl: number;
    x0: number;
    step: number;
    y: number[];
  }[];
  hkls: [number, number, number][];
  coefficients: { laue: string; unique: string; names: string[]; values: number[][] }[];
  widths: WidthCase[];
  truth: { 'SH/L': number; 'Size;i': number; 'Size;a': number; Shkl: number[]; cell: Cell };
  start: { 'SH/L': number; size: number; Shkl: number[] };
  /** h, k, l, multiplicity, d (Å), |F|². */
  reflections: [number, number, number, number, number, number][];
  gsas2: {
    Rwp: number;
    cell: Cell;
    'SH/L': number;
    'Size;i': number;
    'Size;a': number;
    Shkl: number[];
    esd: Record<string, number>;
  };
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/zno-anisotropic.json') as Fixture;
const rows = read('tests/fixtures/validation/zno-anisotropic.xy')
  .trim()
  .split('\n')
  .map((line) => line.trim().split(/\s+/).map(Number));
const zno = (json('tests/fixtures/cod-reference/zno.json') as ReferenceFamilyFile).phases.find(
  (p) => p.id === 'zno-wurtzite',
) as ReferencePhase;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
// GSAS-II was given U = 0 for both atoms (the stored reference keeps the CIF's displacements).
const stored = zno.structure as NonNullable<ReferencePhase['structure']>;
const structure = {
  ...stored,
  atoms: stored.atoms.map((a) => ({ ...a, uIso: 0, uAniso: null })),
};
const model = structureModel(zno.cell, structure, factors, {}, false);
const states = model.atoms.map((a) => ({ x: a.x0, occupancy: a.occupancy0, b: a.b0, fraction: 0 }));
/**
 * The stored lines with Σ|F|² recomputed for U = 0 by this site's structure factor (without a
 * structure refinement the refinement uses the stored Σ|F|², which keep the CIF's displacements).
 */
const peaks = zno.peaks.map((peak) => ({
  ...peak,
  mf2: refinementReflections([peak], zno.cell, cellKind(zno.crystalSystem, zno.cell), 0.5)
    .flatMap((r) => r.members)
    .reduce((sum, hkl) => sum + structureFactorSquared(model, states, hkl, peak.d), 0),
}));
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const G = 8 * Math.LN2 * 1e-4;
const ip = fixture.instrument;
const instrument = { u: ip.U * G, v: ip.V * G, w: ip.W * G, x: ip.X / 100, y: ip.Y / 100 };
const RAD = Math.PI / 180;
const hexCell = (c: Cell) => ({
  a: c.length_a,
  b: c.length_a,
  c: c.length_c,
  alpha: 90,
  beta: 90,
  gamma: 120,
});

/** GSAS-II's Laue symbols and unique axes, mapped to broadening.ts. */
const LAUE: Record<string, LaueClass> = {
  m3m: 'm3m',
  '6/mmm': '6/mmm',
  '3m1': '6/mmm',
  '31m': '31m',
  '3R': '3R',
  '4/mmm': '4/mmm',
  mmm: 'mmm',
  '2/ma': '2/m-a',
  '2/mb': '2/m-b',
  '2/mc': '2/m-c',
  '-1': '-1',
};

describe('Axial divergence (FCJ) against GSAS-II’s getFCJVoigt3', () => {
  it.each(fixture.fcj.map((c) => [c.pos, c.shl, c.sig, c.gam, c] as const))(
    '2θ %s°, SH/L %s, sig %s, gam %s: the same profile point by point',
    (_pos, _shl, _sig, _gam, c) => {
      // GSAS-II's pseudo-Voigt: TCH FWHM and η from the Gaussian FWHM √(8 ln2 sig) and gam.
      const hg = Math.sqrt(8 * Math.LN2 * c.sig) / 100;
      const hl = c.gam / 100;
      const fwhm = tchFwhm(hg, hl);
      const fcj = fcjNodes(c.pos, c.shl, hl);
      if (!fcj) throw new Error('no FCJ nodes');
      const peak: PlacedPeak = {
        phase: 0,
        reflection: 0,
        twoTheta: c.pos,
        area: 1,
        fwhm,
        eta: tchEta(hl / fwhm),
        asymmetry: [0, 0],
        line: 0,
        d: 1,
        mf2: 1,
        fcj,
        fcjReach: 2,
        reach: 2,
      };
      const x = Float64Array.from(c.y, (_, i) => c.x0 + i * c.step);
      const ours = new Float64Array(x.length);
      addProfiles(x, [peak], ours);
      // GSAS-II's profile is per centidegree; ours per degree.
      const top = Math.max(...c.y);
      let worst = 0;
      c.y.forEach((v, i) => (worst = Math.max(worst, Math.abs((ours[i] as number) / 100 - v))));
      expect(worst / top).toBeLessThan(2e-3);
    },
  );
});

describe('Stephens terms against GSAS-II’s MustrainNames and MustrainCoeff', () => {
  it.each(fixture.coefficients.map((c) => [c.laue + c.unique, c] as const))(
    'Laue class %s',
    (key, c) => {
      const laue = LAUE[key];
      if (!laue) throw new Error(`unknown Laue class ${key}`);
      expect(stephensNames(laue)).toEqual(c.names);
      fixture.hkls.forEach((hkl, i) => expect(stephensTerms(laue, hkl)).toEqual(c.values[i]));
    },
  );

  it('picks the Laue class from the crystal system and space group', () => {
    expect(laueClass('hexagonal', 186)).toBe('6/mmm'); // P6₃mc (ZnO)
    expect(laueClass('hexagonal', 162)).toBe('31m'); // P−31m
    expect(laueClass('hexagonal', 164)).toBe('6/mmm'); // P−3m1
    expect(laueClass('rhombohedral')).toBe('3R');
  });
});

describe('Per-reflection widths of ZnO against GSAS-II', () => {
  it.each(fixture.widths.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const gStar = reciprocalMetric(hexCell(c.cell));
    const lambda = fixture.wavelengths.kAlpha1;
    const [sizeType, [si, sa, sizeMix], sizeAxis] = c.size;
    const [strainType, strainValues, strainAxis, generalMix] = c.mustrain;
    const strainMix =
      strainType === 'generalized' ? (generalMix as number) : (strainValues?.[2] as number);
    let compared = 0;
    for (const [h, k, l, d, pos, sig, gam] of c.reflections) {
      const hkl: [number, number, number] = [h, k, l];
      const inverseSize =
        sizeType === 'uniaxial'
          ? uniaxialInverseSize(1 / (1000 * si), 1 / (1000 * sa), cosAngle(gStar, hkl, sizeAxis))
          : 1 / (1000 * si);
      const strain =
        strainType === 'generalized'
          ? stephensStrain('6/mmm', strainValues as number[], hkl, d)
          : uniaxialStrain(
              strainValues?.[0] as number,
              strainValues?.[1] as number,
              cosAngle(gStar, hkl, strainAxis),
            );
      const theta = (pos / 2) * RAD;
      const tan = Math.tan(theta);
      const sample = sampleWidths(inverseSize, strain, sizeMix, strainMix, lambda, theta);
      // Back to GSAS-II's units: variance in centideg², Lorentzian FWHM in centideg.
      const oursSig =
        ip.U * tan * tan + ip.V * tan + ip.W + (sample.gaussian2 * 1e4) / (8 * Math.LN2);
      const oursGam = ip.X / Math.cos(theta) + ip.Y * tan + 100 * sample.lorentzian;
      expect(Math.abs(oursSig - sig) / sig).toBeLessThan(1e-6);
      expect(Math.abs(oursGam - gam) / gam).toBeLessThan(1e-6);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('Refinement with SH/L, uniaxial size and Stephens microstrain against GSAS-II (ZnO)', () => {
  it('has the same |F|² as GSAS-II for every reflection (U = 0)', () => {
    const strongest = Math.max(...fixture.reflections.map((r) => r[5]));
    for (const [h, k, l, , d, f2] of fixture.reflections) {
      const ours = structureFactorSquared(model, states, [h, k, l], d);
      expect(Math.abs(ours - f2)).toBeLessThan(5e-5 * Math.max(f2, 1e-3 * strongest));
    }
    expect(fixture.reflections.length).toBeGreaterThan(20);
    // And so the lines given to the refinement below: Σ m|F|² of GSAS-II's reflections at each d.
    let compared = 0;
    for (const peak of peaks) {
      const gsas = fixture.reflections
        .filter((r) => Math.abs(r[4] - peak.d) < 1e-3)
        .reduce((sum, r) => sum + r[3] * r[5], 0);
      if (gsas === 0) continue;
      expect(Math.abs(peak.mf2 - gsas) / gsas).toBeLessThan(5e-5);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('recovers what GSAS-II was given and agrees with GSAS-II’s refinement', () => {
    const choices = {
      ...DEFAULT_CHOICES,
      zero: false,
      size: true,
      strain: true,
      sizeModel: 'uniaxial' as const,
      strainModel: 'generalized' as const,
      axialDivergence: true,
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
          sizeAxis: [0, 0, 1],
        },
      ],
      choices,
      backgroundTerms: 6,
      atomicWeights,
      instrument,
    });
    if (!result.ok) throw new Error(result.error);
    const fit = result.phases[0];
    if (!fit?.size || !fit.sizeAxial || !fit.stephens) throw new Error('no anisotropic result');
    const g = fixture.gsas2;
    const t = fixture.truth;
    const near = (ours: { value: number; esd: number }, theirs: number, theirsEsd: number, k = 3) =>
      expect(Math.abs(ours.value - theirs)).toBeLessThan(k * Math.hypot(ours.esd, theirsEsd));
    // SH/L: GSAS-II's value within 3 combined s.u., and the truth within 3 of ours.
    near(result.axial, g['SH/L'], g.esd[':0:SH/L'] as number);
    expect(Math.abs(result.axial.value - t['SH/L'])).toBeLessThan(3 * result.axial.esd);
    // Size across and along [0 0 1] (nm here, µm in GSAS-II).
    near(fit.size, 1000 * g['Size;i'], 1000 * (g.esd['0:0:Size;i'] as number));
    near(fit.sizeAxial, 1000 * g['Size;a'], 1000 * (g.esd['0:0:Size;a'] as number));
    // Stephens S400, S004, S202.
    expect(fit.stephens.map((s) => s.name)).toEqual(['S400', 'S004', 'S202']);
    fit.stephens.forEach((s, i) =>
      near(s.value, g.Shkl[i] as number, g.esd[`0:0:Mustrain;${i}`] as number),
    );
    // Uncertainties of the same size as GSAS-II's (within 25 %).
    const ratio = fit.size.esd / (1000 * (g.esd['0:0:Size;i'] as number));
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
    expect(Math.abs(result.stats.rwp * 100 - g.Rwp) / g.Rwp).toBeLessThan(0.02);
    // The methods text names the models, the axis, the coefficients and SH/L with its source.
    const text = rietveldMethods({
      result,
      choices,
      backgroundTerms: 6,
      phases: [{ name: 'ZnO', reference: 'COD 1577381' }],
      radiation: 'Cu Kα1/Kα2',
    });
    expect(text).toContain('Finger–Cox–Jephcoat');
    expect(text).toMatch(
      /uniaxial crystallite size [\d.]+\(\d+\) nm across and [\d.]+\(\d+\) nm along \[0 0 1\]/,
    );
    expect(text).toContain('Stephens, J. Appl. Cryst. 32 (1999) 281');
    expect(text).toMatch(/S400 = /);
    expect(text).not.toContain('Isotropic sample broadening');
    expect(text).not.toContain('Caglioti');
  }, 240_000);
});
