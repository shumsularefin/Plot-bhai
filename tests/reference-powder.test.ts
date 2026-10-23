// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cifNumber, parseCif } from '../src/core/xrd/reference/cif';
import {
  cellComposition,
  crystalFromCif,
  dSpacing,
  expandAtoms,
  lorentzPolarisation,
  patternFor,
  reciprocalMetric,
  reflections,
  type FormFactors,
} from '../src/core/xrd/reference/powder';
import {
  isSystematicAbsence,
  orbitRepresentative,
  parseSymop,
} from '../src/core/xrd/reference/symmetry';

/** Constant "scattering factors" (all Gaussian terms zero, c = Z-like number) for exact hand calculations. */
const flat = (values: Record<string, number>): FormFactors =>
  Object.fromEntries(
    Object.entries(values).map(([el, c]) => [el, [0, 0, 0, 0, 1, 1, 1, 1, c]]),
  ) as FormFactors;

const FCC = ['x,y,z', 'x,y+1/2,z+1/2', 'x+1/2,y,z+1/2', 'x+1/2,y+1/2,z'];

function cifText(a: number, ops: string[], atoms: string[][]): string {
  return `data_test
_cell_length_a ${a}
_cell_length_b ${a}
_cell_length_c ${a}
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_space_group_symop_operation_xyz
${ops.map((o) => `'${o}'`).join('\n')}
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${atoms.map((row) => row.join(' ')).join('\n')}
`;
}

const build = (a: number, ops: string[], atoms: string[][], factors: FormFactors) =>
  crystalFromCif(parseCif(cifText(a, ops, atoms)), factors);

describe('CIF reader', () => {
  it('reads items, quoted strings, text fields, comments and loops', () => {
    const block = parseCif(`# comment
data_x
_a 5.4309(3)
_b 'two words'
_c ?
_text
;
line one
line two
;
loop_
_t _u
1 'a b'
2 .
`);
    expect(block.name).toBe('x');
    expect(cifNumber(block.items.get('_a'))).toBe(5.4309);
    expect(block.items.get('_b')).toBe('two words');
    expect(block.items.get('_c')).toBeNull();
    expect(block.items.get('_text')).toBe('line one\nline two');
    expect(block.loops[0]?.map((r) => [r.get('_t'), r.get('_u')])).toEqual([
      ['1', 'a b'],
      ['2', null],
    ]);
  });
});

describe('symmetry operators', () => {
  it('parses fractions, signs and mixed axes', () => {
    expect(parseSymop('-x+1/2, y, z+1/4')).toEqual({
      rot: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      trans: [0.5, 0, 0.25],
    });
    expect(parseSymop('x-y,x,z+1/6').rot).toEqual([1, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(parseSymop('3/4+z,-y,+x').rot).toEqual([0, 0, 1, 0, -1, 0, 1, 0, 0]);
  });

  it('finds a screw-axis absence and keeps the allowed reflection', () => {
    const screw = [parseSymop('x,y,z'), parseSymop('-x,-y,z+1/2')];
    expect(isSystematicAbsence(screw, [0, 0, 1])).toBe(true);
    expect(isSystematicAbsence(screw, [0, 0, 2])).toBe(false);
    expect(isSystematicAbsence(screw, [1, 0, 1])).toBe(false);
  });

  it('picks one representative per orbit', () => {
    // Three-fold rotation about [111] plus inversion.
    const ops = ['x,y,z', 'z,x,y', 'y,z,x', '-x,-y,-z'].map(parseSymop);
    expect(orbitRepresentative(ops, [0, 1, 1])).toEqual(orbitRepresentative(ops, [1, 1, 0]));
    expect(orbitRepresentative(ops, [0, 1, 1])).toEqual(orbitRepresentative(ops, [-1, 0, -1]));
    expect(orbitRepresentative(ops, [0, 1, 1])).not.toEqual(orbitRepresentative(ops, [2, 0, 0]));
  });
});

describe('powder pattern, known answers', () => {
  it('primitive cubic: d = a/√(h²+k²+l²) and multiplicities 6, 12, 8', () => {
    const factors = flat({ Cs: 10 });
    const crystal = build(4, ['x,y,z'], [['Cs1', 'Cs', '0', '0', '0', '1']], factors);
    const lines = reflections(crystal, factors, 1.2);
    const near = (d: number) => lines.find((l) => Math.abs(l.d - d) < 1e-9);
    // Point-group symmetry is not applied by a P1 operator list, so build the cubic group's
    // rotation part explicitly for the multiplicity check.
    expect(near(4)?.multiplicity).toBe(6);
    expect(near(4 / Math.SQRT2)?.multiplicity).toBe(12);
    expect(near(4 / Math.sqrt(3))?.multiplicity).toBe(8);
  });

  it('rock salt: F(111) = 4(fA − fB) and F(200) = 4(fA + fB) exactly', () => {
    const factors = flat({ Na: 10, Cl: 20 });
    const crystal = build(
      5,
      FCC,
      [
        ['Na1', 'Na', '0', '0', '0', '1'],
        ['Cl1', 'Cl', '0.5', '0.5', '0.5', '1'],
      ],
      factors,
    );
    expect(cellComposition(expandAtoms(crystal))).toEqual({ Na: 4, Cl: 4 });
    const lines = reflections(crystal, factors, 1.5);
    const at = (h: number, k: number, l: number) =>
      lines.find((line) => Math.abs(line.d - 5 / Math.sqrt(h * h + k * k + l * l)) < 1e-9);
    // 8 reflections of {111}, each |F|² = (4 × 10)² = 1600; 6 of {200}, each (4 × 30)² = 14400.
    expect(at(1, 1, 1)?.mf2).toBeCloseTo(8 * 1600, 6);
    expect(at(2, 0, 0)?.mf2).toBeCloseTo(6 * 14400, 6);
  });

  it('face-centred: mixed-parity reflections are absent', () => {
    const factors = flat({ Au: 79 });
    const crystal = build(4, FCC, [['Au1', 'Au', '0', '0', '0', '1']], factors);
    const dSet = new Set(reflections(crystal, factors, 1.0).map((l) => l.d.toFixed(6)));
    expect(dSet.has((4 / Math.sqrt(3)).toFixed(6))).toBe(true); // 111
    expect(dSet.has((4 / 2).toFixed(6))).toBe(true); // 200
    expect(dSet.has((4 / 1).toFixed(6))).toBe(false); // 100
    expect(dSet.has((4 / Math.SQRT2).toFixed(6))).toBe(false); // 110
  });

  it('body-centred: h + k + l odd is absent', () => {
    const factors = flat({ Fe: 26 });
    const ops = ['x,y,z', 'x+1/2,y+1/2,z+1/2'];
    const crystal = build(3, ops, [['Fe1', 'Fe', '0', '0', '0', '1']], factors);
    const dSet = new Set(reflections(crystal, factors, 1.0).map((l) => l.d.toFixed(6)));
    expect(dSet.has((3 / Math.SQRT2).toFixed(6))).toBe(true); // 110
    expect(dSet.has((3 / 1).toFixed(6))).toBe(false); // 100
    expect(dSet.has((3 / Math.sqrt(3)).toFixed(6))).toBe(false); // 111
  });

  it('diamond structure: 200 and 222 vanish, 111 and 220 stay', () => {
    const factors = flat({ Si: 14 });
    const crystal = build(
      5.43,
      FCC,
      [
        ['Si1', 'Si', '0', '0', '0', '1'],
        ['Si2', 'Si', '0.25', '0.25', '0.25', '1'],
      ],
      factors,
    );
    const dSet = new Set(reflections(crystal, factors, 1.0).map((l) => l.d.toFixed(5)));
    const d = (n: number) => (5.43 / Math.sqrt(n)).toFixed(5);
    expect(dSet.has(d(3))).toBe(true);
    expect(dSet.has(d(8))).toBe(true);
    expect(dSet.has(d(4))).toBe(false);
    expect(dSet.has(d(12))).toBe(false);
  });

  it('displacement parameter lowers the intensity by exp(−4π² U / d²) in |F|²', () => {
    const factors = flat({ Au: 79 });
    const withU = (u: string) =>
      `${cifText(4, FCC, [['Au1', 'Au', '0', '0', '0', '1', u]]).replace(
        '_atom_site_occupancy',
        '_atom_site_occupancy\n_atom_site_U_iso_or_equiv',
      )}`;
    const make = (u: string) => crystalFromCif(parseCif(withU(u)), factors);
    const [cold] = reflections(make('0'), factors, 1.5);
    const [hot] = reflections(make('0.02'), factors, 1.5);
    const d = (cold as { d: number }).d;
    expect((hot as { mf2: number }).mf2 / (cold as { mf2: number }).mf2).toBeCloseTo(
      Math.exp((-4 * Math.PI ** 2 * 0.02) / (d * d)),
      10,
    );
  });

  it('Lorentz-polarisation factor at θ = 45° is 1/(sin²45° cos45°) = 2√2', () => {
    expect(lorentzPolarisation(Math.PI / 4)).toBeCloseTo(2 * Math.SQRT2, 12);
  });

  it('Bragg angle from d and scaling of the strongest line to 100', () => {
    const factors = flat({ Au: 79 });
    const crystal = build(4, FCC, [['Au1', 'Au', '0', '0', '0', '1']], factors);
    const peaks = patternFor(reflections(crystal, factors, 0.8), 1.5405929);
    const first = peaks[0] as (typeof peaks)[number];
    expect(first.twoTheta).toBeCloseTo(
      (2 * Math.asin(1.5405929 / (2 * (4 / Math.sqrt(3)))) * 180) / Math.PI,
      10,
    );
    expect(Math.max(...peaks.map((p) => p.intensity))).toBeCloseTo(100, 10);
  });

  it('reciprocal metric of a triclinic cell reproduces the cubic d-spacing for 90° angles', () => {
    const g = reciprocalMetric({ a: 3, b: 3, c: 3, alpha: 90, beta: 90, gamma: 90 });
    expect(dSpacing(g, 1, 2, 2)).toBeCloseTo(1, 12);
  });
});
