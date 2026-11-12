// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  instprm,
  readInstprm,
  tchExact,
  phaseCif,
  tchEta,
  tchFromPseudoVoigt,
  tchFwhm,
} from '../src/core/xrd/export/gsas';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';

const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const phase = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;

describe('Thompson–Cox–Hastings conversion for GSAS-II', () => {
  it('has the TCH limits: pure Gaussian and pure Lorentzian', () => {
    expect(tchEta(0)).toBe(0);
    expect(tchEta(1)).toBeCloseTo(1, 5);
    expect(tchFwhm(1, 0)).toBe(1);
    expect(tchFwhm(0, 1)).toBe(1);
  });

  it.each([0, 0.2, 0.5, 0.8, 1])('reproduces the FWHM and η of the profile (η = %s)', (eta) => {
    const p = tchFromPseudoVoigt({ u: 0.004, v: -0.002, w: 0.006, eta }, 20, 90);
    // FWHM exact up to the Lorentzian fit; η within 0.02 over 20–90° 2θ.
    expect(p.fwhmError).toBeLessThan(0.02);
    expect(p.etaError).toBeLessThan(0.02);
  });

  it('gives a pure Gaussian exactly as σ² = FWHM²/(8 ln 2) in centidegrees²', () => {
    const p = tchFromPseudoVoigt({ u: 0.004, v: -0.002, w: 0.006, eta: 0 }, 20, 90);
    const k = 1e4 / (8 * Math.LN2);
    expect(p.u).toBeCloseTo(0.004 * k, 6);
    expect(p.v).toBeCloseTo(-0.002 * k, 6);
    expect(p.w).toBeCloseTo(0.006 * k, 6);
    expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it('writes the GSAS-II name:value layout with comments only before the values', () => {
    const text = instprm({
      kAlpha1: 1.5405929,
      kAlpha2: 1.5444274,
      ratio: 0.5,
      zero: 0.012,
      profile: tchFromPseudoVoigt({ u: 0.004, v: -0.002, w: 0.006, eta: 0.5 }, 20, 90),
      comments: ['From the Rietveld step'],
    });
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('GSAS-II');
    const first = lines.findIndex((l) => !l.startsWith('#'));
    expect(lines.slice(first).every((l) => !l.startsWith('#'))).toBe(true);
    // Parse as GSAS-II's ReadInstprm does: split on ';' and ':' once.
    const items = Object.fromEntries(
      lines
        .slice(first)
        .flatMap((l) => l.split(';'))
        .map((s) => s.split(/:(.*)/s).slice(0, 2)),
    );
    for (const key of [
      'Type',
      'Bank',
      'Lam1',
      'Lam2',
      'I(L2)/I(L1)',
      'Zero',
      'Polariz.',
      'Azimuth',
      'U',
      'V',
      'W',
      'X',
      'Y',
      'Z',
      'SH/L',
    ])
      expect(items).toHaveProperty([key]);
    expect(items['Type']).toBe('PXC');
    expect(Number(items['Zero'])).toBe(0.012);
    expect(
      instprm({
        kAlpha1: 0.7093171,
        kAlpha2: 0,
        ratio: 0,
        zero: 0,
        profile: tchFromPseudoVoigt({ u: 0, v: 0, w: 0.01, eta: 0.3 }, 10, 60),
        comments: [],
      }),
    ).toContain('Lam:0.7093171;');
  });
});

describe('CIF of each phase', () => {
  it.each([
    ['tio2', 'rutile'],
    ['tio2', 'anatase'],
    ['tio2', 'brookite'],
    ['ceo2', 'ceo2'],
    ['zno', 'zno-wurtzite'],
    ['caco3', 'calcite'],
  ])('round-trips %s %s through the CIF reader (same structure and pattern)', (file, id) => {
    const ref = phase(file, id);
    if (!ref.structure) throw new Error('no structure');
    const text = phaseCif({
      name: ref.name,
      formula: ref.formula,
      spaceGroup: ref.spaceGroup,
      cell: ref.cell,
      structure: ref.structure,
      comments: ['test'],
    });
    const back = phaseFromCif(text, `${id}.cif`, factors, id);
    if (!back.ok) throw new Error(back.error);
    expect(back.phase.cell).toEqual(ref.cell);
    expect(back.phase.structure).toEqual(ref.structure);
    expect(back.phase.spaceGroup).toEqual(ref.spaceGroup);
    // The same powder pattern (invariance: nothing lost in the file).
    expect(back.phase.peaks.length).toBe(ref.peaks.length);
    back.phase.peaks.forEach((p, i) => {
      expect(p.d).toBeCloseTo(ref.peaks[i]?.d ?? 0, 4);
      expect(Math.abs(p.mf2 - (ref.peaks[i]?.mf2 ?? 0)) / p.mf2).toBeLessThan(1e-3);
    });
  });
});

describe('Reading a GSAS-II .instprm file', () => {
  it('reads the validation instrument file and converts it to this site’s units', () => {
    const read = readInstprm(
      readFileSync(join(process.cwd(), 'scripts/validation/rietveld/cu.instprm'), 'utf8'),
    );
    if ('error' in read) throw new Error(read.error);
    // U, V, W are σ² in centideg²: FWHM² = 8 ln 2 σ² / 10⁴ deg²; X, Y in centideg.
    expect(read.profile.u).toBeCloseTo((2.0 * 8 * Math.LN2) / 1e4, 14);
    expect(read.profile.v).toBeCloseTo((-2.0 * 8 * Math.LN2) / 1e4, 14);
    expect(read.profile.w).toBeCloseTo((5.0 * 8 * Math.LN2) / 1e4, 14);
    expect(read.profile.x).toBeCloseTo(0.02, 14);
    expect(read.profile.y).toBeCloseTo(0.03, 14);
    expect(read.polarisation).toBe(0.5);
    expect(read.kAlpha1).toBe(1.5405929);
    expect(read.ratio).toBe(0.5);
    // SH/L = 0.002 is reported as not carried over.
    expect(read.notes.some((n) => n.includes('SH/L'))).toBe(true);
  });

  it('round-trips the file this site writes', () => {
    const profile = { u: 0.0041, v: -0.0023, w: 0.0035, x: 0.021, y: 0.012 };
    const text = instprm({
      kAlpha1: 1.5405929,
      kAlpha2: 1.5444274,
      ratio: 0.5,
      zero: 0.012,
      polarisation: 0.5563,
      profile: tchExact(profile),
      comments: ['test'],
    });
    const read = readInstprm(text);
    if ('error' in read) throw new Error(read.error);
    for (const key of ['u', 'v', 'w', 'x', 'y'] as const)
      expect(read.profile[key]).toBeCloseTo(profile[key], 9);
    expect(read.polarisation).toBeCloseTo(0.5563, 12);
    expect(read.zero).toBeCloseTo(0.012, 12);
  });

  it('refuses files that are not laboratory X-ray instrument files', () => {
    expect(readInstprm('hello')).toEqual({
      error: 'This does not look like a GSAS-II .instprm file (no Type line).',
    });
    expect('error' in readInstprm('#GSAS-II\nType:PNC\nU:1')).toBe(true);
    expect('error' in readInstprm('#GSAS-II\nType:PXC\nU:1;V:1')).toBe(true);
  });
});
