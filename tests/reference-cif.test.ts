// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import { referenceLines } from '../src/core/xrd/reference/match';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import { fitScales, simulateProfile } from '../src/core/xrd/reference/simulate';
import { phaseReference } from '../src/core/xrd/reference/source';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';
import { ANODES } from '../src/core/xrd/radiation';
import { kAlpha2Position } from '../src/core/xrd/process/kAlpha2';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, root), 'utf8');
const factors = (
  JSON.parse(text('data/reference/scattering-factors.json')) as {
    factors: FormFactors;
  }
).factors;
const library = (file: string) =>
  (JSON.parse(text(`tests/fixtures/cod-reference/${file}`)) as ReferenceFamilyFile).phases;

describe('a CIF loaded by the user', () => {
  it('gives exactly the library pattern for the same COD file (anatase)', () => {
    const anatase = library('tio2.json').find((p) => p.id === 'anatase');
    if (!anatase) throw new Error('missing');
    const result = phaseFromCif(
      text(`scripts/cif-cache/${anatase.codId}.cif`),
      'anatase.cif',
      factors,
      'cif-1',
    );
    if (!result.ok) throw new Error(result.error);
    const { phase } = result;
    expect(phase.codId).toBe(anatase.codId);
    expect(phase.spaceGroup.number).toBe(141);
    expect(phase.crystalSystem).toBe('tetragonal');
    expect(phase.formula).toBe('O2Ti');
    expect(phase.peaks).toEqual(anatase.peaks);
    expect(phaseReference(phase)).toBe(`CIF file anatase.cif (COD ${anatase.codId})`);
  });

  it('warns about a negative displacement parameter (COD 9013437, monoclinic BiVO4)', () => {
    const result = phaseFromCif(
      text('scripts/cif-cache/9013437.cif'),
      'BiVO4.cif',
      factors,
      'cif-2',
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.phase.spaceGroup.number).toBe(15);
    expect(result.phase.crystalSystem).toBe('monoclinic');
    expect(result.notes.map((n) => n.text).join(' ')).toContain('negative displacement');
    // The strongest line of clinobisvanite is the (112)/(-112)-type doublet near 28.9° (Cu Kα1).
    const lines = referenceLines(result.phase, ANODES.Cu.kAlpha1);
    const strongest = lines.reduce((a, b) => (b.intensity > a.intensity ? b : a));
    expect(strongest.twoTheta).toBeGreaterThan(28.7);
    expect(strongest.twoTheta).toBeLessThan(29.1);
  });

  it('explains files it cannot use', () => {
    expect(phaseFromCif('just some text', 'x.cif', factors, 'a')).toMatchObject({ ok: false });
    const noAtoms =
      'data_x\n_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_symmetry_equiv_pos_as_xyz\nx,y,z\n';
    const result = phaseFromCif(noAtoms, 'x.cif', factors, 'a');
    expect(result.ok ? '' : result.error).toContain('no atom coordinates');
  });
});

describe('calculated profile', () => {
  const lines = [
    { twoTheta: 30, d: 0, intensity: 100, multiplicity: 1, mf2: 1, hkl: [] },
    { twoTheta: 40, d: 0, intensity: 50, multiplicity: 1, mf2: 1, hkl: [] },
  ];
  const x = Float64Array.from({ length: 3001 }, (_, i) => 20 + 0.01 * i);

  it('puts each line at its position with its relative height, plus the zero shift', () => {
    const p = simulateProfile(lines, x, { fwhmDeg: 0.1, eta: 0.5, shiftDeg: 0.05, kAlpha2: null });
    expect(p[1005]).toBeCloseTo(100, 6); // 30.05°
    expect(p[2005]).toBeCloseTo(50, 6); // 40.05°
    // Half height at ± FWHM / 2.
    expect(p[1010]).toBeCloseTo(50, 1);
  });

  it('adds Kα2 copies at the Bragg-law angle with the given ratio', () => {
    const k2 = { lambda1: ANODES.Cu.kAlpha1, lambda2: ANODES.Cu.kAlpha2, ratio: 0.5 };
    const p = simulateProfile(lines, x, { fwhmDeg: 0.02, eta: 0, shiftDeg: 0, kAlpha2: k2 });
    const at = kAlpha2Position(40, k2.lambda1, k2.lambda2);
    const i = Math.round((at - 20) / 0.01);
    expect(Math.max(p[i - 1] as number, p[i] as number, p[i + 1] as number)).toBeGreaterThan(20);
  });

  it('recovers known scales of two phases and drops a phase that is not there', () => {
    const a = simulateProfile([lines[0] as never], x, {
      fwhmDeg: 0.1,
      eta: 0.5,
      shiftDeg: 0,
      kAlpha2: null,
    });
    const b = simulateProfile([lines[1] as never], x, {
      fwhmDeg: 0.1,
      eta: 0.5,
      shiftDeg: 0,
      kAlpha2: null,
    });
    const c = simulateProfile([{ ...(lines[0] as never as object), twoTheta: 25 } as never], x, {
      fwhmDeg: 0.1,
      eta: 0.5,
      shiftDeg: 0,
      kAlpha2: null,
    });
    const y = a.map((v, i) => 3 * v + 0.5 * (b[i] as number));
    const [sa, sb] = fitScales(y, [a, b]);
    expect(sa).toBeCloseTo(3, 9);
    expect(sb).toBeCloseTo(0.5, 9);
    // The 25° phase would need a negative scale to help, so it gets 0.
    const withC = y.map((v, i) => v - 0.2 * (c[i] as number));
    expect(fitScales(withC, [a, b, c])[2]).toBe(0);
  });
});
