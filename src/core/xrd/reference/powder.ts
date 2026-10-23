/*
 * Kinematic X-ray powder pattern of a crystal structure.
 *
 * Structure factor of reflection h = (h k l):
 *   F(h) = Σ_j  occ_j · f_j(s) · T_j(h) · exp(2πi h·x_j)
 * with the sum over every atom in the unit cell, where
 *   s = sin θ / λ = 1 / (2d)   (Å⁻¹)
 *   f_j(s) = Σ_i a_i exp(−b_i s²) + c   (four-Gaussian fit of the neutral-atom scattering factor,
 *            Cromer–Mann form; coefficients from International Tables Vol. C, 1992, see
 *            data/reference/scattering-factors.json)
 *   T_j = exp(−8π² U_iso s²) = exp(−2π² U_iso / d²)  for an isotropic displacement U_iso (Å²), or
 *   T_j = exp(−2π² Σ_kl U_kl h_k h_l a*_k a*_l)       for an anisotropic one (CIF convention).
 * Anomalous dispersion (f′, f″) is ignored.
 *
 * Intensity of a powder line (Bragg–Brentano, no monochromator, unpolarised beam):
 *   I ∝ Σ_{h in line} |F(h)|² · LP(θ),     LP(θ) = (1 + cos² 2θ) / (sin² θ cos θ)
 * where the sum over all reflections that share one d-spacing replaces "multiplicity × |F|²".
 * Bragg's law: λ = 2 d sin θ.
 */

import { isSystematicAbsence, orbitRepresentative, parseSymop, type Symop } from './symmetry.ts';
import { cifNumber, loopWith, type CifBlock } from './cif.ts';

export interface Cell {
  /** Edge lengths in Å. */
  a: number;
  b: number;
  c: number;
  /** Angles in degrees. */
  alpha: number;
  beta: number;
  gamma: number;
}

export interface Atom {
  label: string;
  /** Element symbol, for example "Ti". */
  element: string;
  /** Fractional coordinates. */
  x: [number, number, number];
  occupancy: number;
  /** Isotropic displacement U (Å²), or null when the file gives none. */
  uIso: number | null;
  /** Anisotropic U in the order U11, U22, U33, U12, U13, U23 (Å²), or null. */
  uAniso: [number, number, number, number, number, number] | null;
}

export interface Crystal {
  cell: Cell;
  ops: Symop[];
  atoms: Atom[];
}

/** Gaussian coefficients a1..a4, b1..b4, c. */
export type FormFactor = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type FormFactors = Readonly<Record<string, FormFactor>>;

const ELEMENT = /^([A-Z][a-z]?)/;

/** Element symbol from a CIF type symbol ("Ti4+", "O2-") or, failing that, an atom label ("O1"). */
function elementOf(typeSymbol: string | null, label: string, known: FormFactors): string | null {
  for (const text of [typeSymbol, label]) {
    if (!text) continue;
    const letters = ELEMENT.exec(text.trim().replace(/^([a-z])/, (c) => c.toUpperCase()))?.[1];
    if (!letters) continue;
    if (known[letters]) return letters;
    if (known[letters[0] as string]) return letters[0] as string;
  }
  return null;
}

/** Reads cell, symmetry operators and atoms from a parsed CIF. Throws with a plain reason. */
export function crystalFromCif(block: CifBlock, factors: FormFactors): Crystal {
  const num = (tag: string) => cifNumber(block.items.get(tag));
  const cell = {
    a: num('_cell_length_a'),
    b: num('_cell_length_b'),
    c: num('_cell_length_c'),
    alpha: num('_cell_angle_alpha'),
    beta: num('_cell_angle_beta'),
    gamma: num('_cell_angle_gamma'),
  };
  if (Object.values(cell).some((v) => v === null || v <= 0))
    throw new Error('missing cell parameters');

  const opRows = loopWith(block, '_space_group_symop_operation_xyz');
  const legacy = loopWith(block, '_symmetry_equiv_pos_as_xyz');
  const opTexts = (opRows.length > 0 ? opRows : legacy).map(
    (row) =>
      row.get('_space_group_symop_operation_xyz') ?? row.get('_symmetry_equiv_pos_as_xyz') ?? '',
  );
  if (opTexts.length === 0) throw new Error('no symmetry operators listed');
  const ops = opTexts.map(parseSymop);

  const siteRows = loopWith(block, '_atom_site_fract_x');
  if (siteRows.length === 0) throw new Error('no atom coordinates');
  const aniso = new Map<string, Atom['uAniso']>();
  for (const row of loopWith(block, '_atom_site_aniso_label')) {
    const label = row.get('_atom_site_aniso_label') ?? '';
    const read = (prefix: 'u' | 'b', i: string) =>
      cifNumber(row.get(`_atom_site_aniso_${prefix}_${i}`));
    for (const prefix of ['u', 'b'] as const) {
      const values = ['11', '22', '33', '12', '13', '23'].map((i) => read(prefix, i));
      if (values.every((v) => v !== null)) {
        const scale = prefix === 'b' ? 1 / (8 * Math.PI ** 2) : 1;
        aniso.set(label, values.map((v) => (v as number) * scale) as NonNullable<Atom['uAniso']>);
        break;
      }
    }
  }
  const atoms: Atom[] = [];
  for (const row of siteRows) {
    const label = row.get('_atom_site_label') ?? '';
    const element = elementOf(row.get('_atom_site_type_symbol') ?? null, label, factors);
    if (!element) throw new Error(`unknown element for atom "${label}"`);
    const coords = ['x', 'y', 'z'].map((k) => cifNumber(row.get(`_atom_site_fract_${k}`)));
    if (coords.some((v) => v === null)) throw new Error(`atom "${label}" has no coordinates`);
    const u = cifNumber(row.get('_atom_site_u_iso_or_equiv'));
    const b = cifNumber(row.get('_atom_site_b_iso_or_equiv'));
    atoms.push({
      label,
      element,
      x: coords as [number, number, number],
      occupancy: cifNumber(row.get('_atom_site_occupancy')) ?? 1,
      uIso: u ?? (b === null ? null : b / (8 * Math.PI ** 2)),
      uAniso: aniso.get(label) ?? null,
    });
  }
  return { cell: cell as Cell, ops, atoms };
}

type Matrix3 = [number, number, number, number, number, number, number, number, number];

/** Reciprocal metric tensor G* (Å⁻²), row-major, so that 1/d² = h·G*·h. */
export function reciprocalMetric(cell: Cell): Matrix3 {
  const rad = Math.PI / 180;
  const ca = Math.cos(cell.alpha * rad);
  const cb = Math.cos(cell.beta * rad);
  const cg = Math.cos(cell.gamma * rad);
  const { a, b, c } = cell;
  const g: Matrix3 = [
    a * a,
    a * b * cg,
    a * c * cb,
    a * b * cg,
    b * b,
    b * c * ca,
    a * c * cb,
    b * c * ca,
    c * c,
  ];
  const det =
    g[0] * (g[4] * g[8] - g[5] * g[7]) -
    g[1] * (g[3] * g[8] - g[5] * g[6]) +
    g[2] * (g[3] * g[7] - g[4] * g[6]);
  return [
    (g[4] * g[8] - g[5] * g[7]) / det,
    (g[2] * g[7] - g[1] * g[8]) / det,
    (g[1] * g[5] - g[2] * g[4]) / det,
    (g[5] * g[6] - g[3] * g[8]) / det,
    (g[0] * g[8] - g[2] * g[6]) / det,
    (g[2] * g[3] - g[0] * g[5]) / det,
    (g[3] * g[7] - g[4] * g[6]) / det,
    (g[1] * g[6] - g[0] * g[7]) / det,
    (g[0] * g[4] - g[1] * g[3]) / det,
  ];
}

/** d-spacing (Å) of reflection (h k l) for the given reciprocal metric. */
export function dSpacing(gStar: readonly number[], h: number, k: number, l: number): number {
  const inv =
    h * h * (gStar[0] as number) +
    k * k * (gStar[4] as number) +
    l * l * (gStar[8] as number) +
    2 * h * k * (gStar[1] as number) +
    2 * h * l * (gStar[2] as number) +
    2 * k * l * (gStar[5] as number);
  return 1 / Math.sqrt(inv);
}

/** An atom at one position in the cell, with its displacement tensor in the symmetry-rotated setting. */
interface Site {
  element: string;
  occupancy: number;
  x: [number, number, number];
  uIso: number;
  /** Dimensionless tensor u_kl = U_kl a*_k a*_l rotated to this site, or null for isotropic atoms. */
  u: Matrix3 | null;
}

const wrap = (v: number) => v - Math.floor(v);
const close = (a: number, b: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 1 - d) < 1e-3;
};

/** Every atom of the unit cell: the asymmetric-unit atoms moved by all symmetry operators. */
export function expandAtoms(crystal: Crystal): Site[] {
  const gStar = reciprocalMetric(crystal.cell);
  const aStar = [Math.sqrt(gStar[0]), Math.sqrt(gStar[4]), Math.sqrt(gStar[8])];
  const sites: Site[] = [];
  for (const atom of crystal.atoms) {
    let u0: Matrix3 | null = null;
    if (atom.uAniso) {
      const [u11, u22, u33, u12, u13, u23] = atom.uAniso;
      const [s1, s2, s3] = aStar as [number, number, number];
      u0 = [
        u11 * s1 * s1,
        u12 * s1 * s2,
        u13 * s1 * s3,
        u12 * s1 * s2,
        u22 * s2 * s2,
        u23 * s2 * s3,
        u13 * s1 * s3,
        u23 * s2 * s3,
        u33 * s3 * s3,
      ];
    }
    const images: Site[] = [];
    for (const op of crystal.ops) {
      const r = op.rot as number[];
      const x: [number, number, number] = [0, 1, 2].map((i) =>
        wrap(
          (r[i * 3] as number) * atom.x[0] +
            (r[i * 3 + 1] as number) * atom.x[1] +
            (r[i * 3 + 2] as number) * atom.x[2] +
            op.trans[i as 0 | 1 | 2],
        ),
      ) as [number, number, number];
      if (images.some((s) => s.x.every((v, i) => close(v, x[i] as number)))) continue;
      let u: Matrix3 | null = null;
      if (u0) {
        // u' = R u Rᵀ
        const ru = new Array<number>(9).fill(0);
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++)
            for (let k = 0; k < 3; k++)
              ru[i * 3 + j] =
                (ru[i * 3 + j] as number) + (r[i * 3 + k] as number) * (u0[k * 3 + j] as number);
        u = new Array<number>(9).fill(0) as Matrix3;
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++)
            for (let k = 0; k < 3; k++)
              u[i * 3 + j] =
                (u[i * 3 + j] as number) + (ru[i * 3 + k] as number) * (r[j * 3 + k] as number);
      }
      images.push({ element: atom.element, occupancy: atom.occupancy, x, uIso: atom.uIso ?? 0, u });
    }
    sites.push(...images);
  }
  return sites;
}

/** Atoms per element in the unit cell, summing occupancies. */
export function cellComposition(sites: readonly Site[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) out[s.element] = (out[s.element] ?? 0) + s.occupancy;
  return out;
}

export interface Reflection {
  /** d-spacing, Å. */
  d: number;
  /** Number of reflections (h k l, both signs) sharing this d-spacing. */
  multiplicity: number;
  /** Σ |F|² over those reflections. */
  mf2: number;
  /** One (h k l) per symmetry-distinct family in this line. */
  hkl: [number, number, number][];
}

/**
 * All allowed reflections with d ≥ dMin (Å), grouped into powder lines by d-spacing
 * (relative difference below 1e-6), sorted from the largest d.
 */
export function reflections(crystal: Crystal, factors: FormFactors, dMin: number): Reflection[] {
  const gStar = reciprocalMetric(crystal.cell);
  const sites = expandAtoms(crystal);
  const { a, b, c } = crystal.cell;
  const hMax = Math.floor(a / dMin);
  const kMax = Math.floor(b / dMin);
  const lMax = Math.floor(c / dMin);
  const raw: { d: number; f2: number; h: [number, number, number] }[] = [];
  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const d = dSpacing(gStar, h, k, l);
        if (d < dMin) continue;
        if (isSystematicAbsence(crystal.ops, [h, k, l])) continue;
        const s2 = 1 / (4 * d * d);
        let re = 0;
        let im = 0;
        for (const site of sites) {
          const f = factors[site.element] as FormFactor;
          let scatter = f[8];
          for (let i = 0; i < 4; i++)
            scatter += (f[i] as number) * Math.exp(-(f[i + 4] as number) * s2);
          let t: number;
          if (site.u) {
            const u = site.u;
            const q =
              h * h * u[0] +
              k * k * u[4] +
              l * l * u[8] +
              2 * (h * k * u[1] + h * l * u[2] + k * l * u[5]);
            t = Math.exp(-2 * Math.PI ** 2 * q);
          } else {
            t = Math.exp((-2 * Math.PI ** 2 * site.uIso) / (d * d));
          }
          const phase = 2 * Math.PI * (h * site.x[0] + k * site.x[1] + l * site.x[2]);
          const amplitude = site.occupancy * scatter * t;
          re += amplitude * Math.cos(phase);
          im += amplitude * Math.sin(phase);
        }
        raw.push({ d, f2: re * re + im * im, h: [h, k, l] });
      }
    }
  }
  // Numerically zero amplitudes (cancellation not caught by the symmetry rule) are not lines.
  const strongest = raw.reduce((m, r) => Math.max(m, r.f2), 0);
  const kept = raw.filter((r) => r.f2 > strongest * 1e-10).sort((p, q) => q.d - p.d);

  const lines: Reflection[] = [];
  let members: typeof kept = [];
  const flush = () => {
    if (members.length === 0) return;
    const reps = new Map<string, [number, number, number]>();
    for (const m of members) {
      const rep = orbitRepresentative(crystal.ops, m.h);
      reps.set(rep.join(','), rep);
    }
    lines.push({
      d: members.reduce((s, m) => s + m.d, 0) / members.length,
      multiplicity: members.length,
      mf2: members.reduce((s, m) => s + m.f2, 0),
      hkl: [...reps.values()].sort((p, q) => q[0] - p[0] || q[1] - p[1] || q[2] - p[2]),
    });
    members = [];
  };
  for (const r of kept) {
    const first = members[0];
    if (first && Math.abs(r.d - first.d) / first.d > 1e-6) flush();
    members.push(r);
  }
  flush();
  return lines;
}

/** Lorentz-polarisation factor for the Bragg angle θ (radians): (1 + cos²2θ) / (sin²θ cosθ). */
export function lorentzPolarisation(theta: number): number {
  const s = Math.sin(theta);
  return (1 + Math.cos(2 * theta) ** 2) / (s * s * Math.cos(theta));
}

export interface PatternPeak {
  /** Diffraction angle 2θ in degrees. */
  twoTheta: number;
  d: number;
  /** Intensity relative to the strongest line (= 100). */
  intensity: number;
  multiplicity: number;
  /** Σ|F|² of the line (see Reflection). */
  mf2: number;
  hkl: [number, number, number][];
}

/** Powder pattern for a wavelength λ (Å): lines with d > λ/2, intensities scaled so the maximum is 100. */
export function patternFor(lines: readonly Reflection[], wavelength: number): PatternPeak[] {
  const peaks = lines
    .filter((l) => wavelength / (2 * l.d) < 1)
    .map((l) => {
      const theta = Math.asin(wavelength / (2 * l.d));
      return {
        twoTheta: (2 * theta * 180) / Math.PI,
        d: l.d,
        raw: l.mf2 * lorentzPolarisation(theta),
        multiplicity: l.multiplicity,
        mf2: l.mf2,
        hkl: l.hkl,
      };
    });
  const max = peaks.reduce((m, p) => Math.max(m, p.raw), 0);
  return peaks.map(({ raw, ...p }) => ({ ...p, intensity: (100 * raw) / max }));
}
