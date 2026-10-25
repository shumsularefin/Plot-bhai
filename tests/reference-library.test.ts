// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types';

const dir = new URL('../data/reference/', import.meta.url);
const read = <T>(name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;

const index = read<ReferenceIndex>('index.json');
const phases: ReferencePhase[] = index.families.flatMap(
  (f) => read<ReferenceFamilyFile>(f.file).phases,
);
const phase = (id: string) => phases.find((p) => p.id === id) as ReferencePhase;

describe('reference library files', () => {
  it('has an index entry for every family file and no stray files', () => {
    const files = readdirSync(dir).filter(
      (n) => n.endsWith('.json') && !['index.json', 'scattering-factors.json'].includes(n),
    );
    expect(files.sort()).toEqual(index.families.map((f) => f.file).sort());
  });

  it('matches the schema: types, sorted lines, intensity 0–100 with a maximum of 100', () => {
    expect(index.intensityWavelength).toBe(ANODES.Cu.kAlpha1);
    for (const family of index.families) {
      const file = read<ReferenceFamilyFile>(family.file);
      expect(file.family).toBe(family.id);
      expect(file.phases.map((p) => p.id)).toEqual(family.phases.map((p) => p.id));
      for (const p of file.phases) {
        expect(Number.isInteger(p.codId) && (p.codId ?? 0) > 0, p.id).toBe(true);
        expect(p.spaceGroup.hm.length, p.id).toBeGreaterThan(0);
        expect(
          Object.values(p.cell).every((v) => v > 0),
          p.id,
        ).toBe(true);
        expect(p.peaks.length, p.id).toBeGreaterThan(0);
        expect(Math.max(...p.peaks.map((k) => k.i)), p.id).toBeCloseTo(100, 2);
        p.peaks.forEach((k, i) => {
          expect(k.d).toBeGreaterThanOrEqual(0.8);
          expect(k.m).toBeGreaterThan(0);
          expect(k.mf2).toBeGreaterThan(0);
          expect(k.i).toBeGreaterThan(0);
          expect(k.i).toBeLessThanOrEqual(100);
          expect(k.hkl.length).toBeGreaterThan(0);
          expect(k.hkl.every((h) => h.length === 3 && h.every(Number.isInteger))).toBe(true);
          if (i > 0) expect(k.d, p.id).toBeLessThanOrEqual((p.peaks[i - 1] as { d: number }).d);
        });
      }
    }
  });

  it('lists, for searching, each phase with its formula, elements, space group and cell', () => {
    for (const family of index.families) {
      const file = read<ReferenceFamilyFile>(family.file);
      for (const listed of family.phases) {
        const full = file.phases.find((p) => p.id === listed.id) as ReferencePhase;
        expect(listed.formula, listed.id).toBe(full.formula);
        expect(listed.spaceGroupNumber, listed.id).toBe(full.spaceGroup.number);
        expect(listed.elements.length, listed.id).toBeGreaterThan(0);
        expect([...listed.elements].sort(), listed.id).toEqual(listed.elements);
        for (const el of listed.elements) expect(full.formula, listed.id).toContain(el);
        expect(listed.cell.a, listed.id).toBeCloseTo(full.cell.a, 4);
        expect(listed.cell.beta, listed.id).toBeCloseTo(full.cell.beta, 3);
      }
    }
  });

  it('ships scattering factors with their source', () => {
    const file = read<{ url: string; factors: Record<string, number[]> }>(
      'scattering-factors.json',
    );
    expect(file.url).toContain('it92');
    expect(Object.keys(file.factors)).toHaveLength(98);
    expect(file.factors['Ti']).toHaveLength(9);
  });
});

describe('cubic phases follow d = a / √(h² + k² + l²)', () => {
  it.each(['si', 'lab6', 'au', 'nio'])('%s', (id) => {
    const p = phase(id);
    for (const peak of p.peaks) {
      for (const [h, k, l] of peak.hkl) {
        const expected = p.cell.a / Math.sqrt(h * h + k * k + l * l);
        // d is stored with five decimals.
        expect(Math.abs(peak.d - expected), `${id} ${h}${k}${l}`).toBeLessThan(2e-5);
      }
    }
  });

  it('fcc lines (Au) have unmixed parity; NiO has the 111, 200 and 220 lines', () => {
    for (const peak of phase('au').peaks) {
      for (const [h, k, l] of peak.hkl) {
        const parity = [h, k, l].map((v) => Math.abs(v) % 2);
        expect(new Set(parity).size, `${h}${k}${l}`).toBe(1);
      }
    }
    const nio = phase('nio');
    for (const n of [3, 4, 8]) {
      const d = nio.cell.a / Math.sqrt(n);
      expect(
        nio.peaks.some((p) => Math.abs(p.d - d) < 2e-5),
        `NiO d for h²+k²+l² = ${n}`,
      ).toBe(true);
    }
  });

  it('multiplicities of cubic {100}, {110}, {111} are 6, 12, 8 (LaB6, primitive cubic)', () => {
    const lab6 = phase('lab6');
    const m = (h: number, k: number, l: number) =>
      lab6.peaks.find((p) => Math.abs(p.d - lab6.cell.a / Math.sqrt(h * h + k * k + l * l)) < 1e-4)
        ?.m;
    expect(m(1, 0, 0)).toBe(6);
    expect(m(1, 1, 0)).toBe(12);
    expect(m(1, 1, 1)).toBe(8);
  });
});

describe('strongest lines at Cu Kα1', () => {
  const twoTheta = (d: number) => (2 * Math.asin(ANODES.Cu.kAlpha1 / (2 * d)) * 180) / Math.PI;
  const strongest = (id: string) =>
    [...phase(id).peaks].sort((a, b) => b.i - a.i)[0] as ReferencePhase['peaks'][number];

  it('anatase: (101) near 25.3°', () => {
    expect(strongest('anatase').hkl[0]).toEqual([1, 0, 1]);
    expect(twoTheta(strongest('anatase').d)).toBeCloseTo(25.3, 1);
  });

  it('rutile: (110) near 27.4°', () => {
    expect(strongest('rutile').hkl[0]).toEqual([1, 1, 0]);
    expect(twoTheta(strongest('rutile').d)).toBeCloseTo(27.4, 1);
  });
});

describe('screened library (sub-stage 6a-fix)', () => {
  it('has 70 phases, including maghemite and gamma-Al2O3', () => {
    expect(phases).toHaveLength(70);
    expect(phase('maghemite')).toBeDefined();
    expect(phase('gamma-al2o3')).toBeDefined();
  });

  it('ZnO is the ambient-pressure cell: (100), (002), (101) near 31.8, 34.4, 36.2 degrees', () => {
    const twoTheta = (d: number) => (2 * Math.asin(ANODES.Cu.kAlpha1 / (2 * d)) * 180) / Math.PI;
    const line = (h: number[]) =>
      (
        phase('zno-wurtzite').peaks.find((p) =>
          p.hkl.some((x) => x.join() === h.join()),
        ) as ReferencePhase['peaks'][number]
      ).d;
    expect(twoTheta(line([1, 0, 0]))).toBeCloseTo(31.76, 1);
    expect(twoTheta(line([0, 0, 2]))).toBeCloseTo(34.41, 1);
    expect(twoTheta(line([1, 0, 1]))).toBeCloseTo(36.24, 1);
  });
});
