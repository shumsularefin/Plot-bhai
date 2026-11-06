/*
 * GSAS-II starting set: an instrument parameter file (.instprm) and a CIF per phase, so a
 * refinement made here can be checked or continued in GSAS-II (with the .xye of patternFile.ts).
 *
 * .instprm format, as read by GSAS-II's ReadInstprm (GSASIIfiles.py) and written in its
 * defaultIparms.py: a first line containing "GSAS-II", then name:value pairs separated by ";"
 * or new lines (Type, Bank, Lam1, Lam2, I(L2)/I(L1) or Lam, Zero, Polariz., Azimuth, U, V, W, X,
 * Y, Z, SH/L). Comment lines (#) may only come before the first value: the reader stops at a
 * # line once it has read values. Checked against the GSAS-II source on GitHub (AdvancedPhotonSource/
 * GSAS-II, main branch, November 2026).
 *
 * GSAS-II conventions (from GSASIIpwd.py): 2θ_obs = 2θ_calc + Zero (degrees), the same sign as
 * here; Polariz. 0.5 is an unpolarised beam, as in this site's Lorentz–polarisation factor; the
 * profile is the Thompson–Cox–Hastings pseudo-Voigt (J. Appl. Cryst. 20 (1987) 79):
 *   Gaussian variance σ² = U tan²θ + V tanθ + W   (centidegrees², FWHM_G = √(8 ln 2) σ)
 *   Lorentzian FWHM   γ  = X / cosθ + Y tanθ + Z  (centidegrees)
 *   H⁵ = H_G⁵ + 2.69269 H_G⁴H_L + 2.42843 H_G³H_L² + 4.47163 H_G²H_L³ + 0.07842 H_G H_L⁴ + H_L⁵
 *   η  = 1.36603 q − 0.47719 q² + 0.11116 q³,  q = H_L / H.
 *
 * This site's profile is one pseudo-Voigt with FWHM² = U tan²θ + V tanθ + W (degrees²) and a
 * constant η. Converting it: a constant η fixes q (solve the cubic) and so H_G/H = r (solve the
 * quintic with H = 1); then σ² = r² H²/(8 ln 2) is exactly of the Caglioti form, and γ = q H is
 * fitted by least squares to X/cosθ + Y tanθ over the refined range. The result is a starting
 * point for GSAS-II, not the same model: refine it there.
 */

import type { Cell } from '../reference/powder';
import { tchEta, tchFwhm } from '../rietveld/tch';
import type { StoredStructure } from '../reference/types';

const RAD = Math.PI / 180;
const LN2_8 = 8 * Math.LN2;

export { tchEta, tchFwhm };

/** Bisection for an increasing function on [0, 1]. */
function solve(f: (t: number) => number, target: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TchProfile {
  /** centideg² */
  u: number;
  v: number;
  w: number;
  /** centideg */
  x: number;
  y: number;
  /** Largest relative difference of the TCH FWHM and of η from this site's profile in the range. */
  fwhmError: number;
  etaError: number;
}

/**
 * GSAS-II TCH parameters for this site's profile (U, V, W in degrees², 0 ≤ η ≤ 1) over 2θ from
 * `from` to `to` (degrees).
 */
export function tchFromPseudoVoigt(
  p: { u: number; v: number; w: number; eta: number },
  from: number,
  to: number,
): TchProfile {
  const eta = Math.min(1, Math.max(0, p.eta));
  const q = solve(tchEta, eta);
  const r = solve((t) => tchFwhm(t, q), 1);
  const g = (r * r * 1e4) / LN2_8; // deg² of FWHM² → centideg² of σ²
  const fwhm = (theta: number) =>
    Math.sqrt(Math.max(0, p.u * Math.tan(theta) ** 2 + p.v * Math.tan(theta) + p.w));
  // Least squares γ(θ) = X/cosθ + Y tanθ to γ = 100 q H(θ) on 50 points.
  const thetas = Array.from({ length: 50 }, (_, i) => ((from + ((to - from) * i) / 49) * RAD) / 2);
  let saa = 0;
  let sab = 0;
  let sbb = 0;
  let sat = 0;
  let sbt = 0;
  for (const t of thetas) {
    const a = 1 / Math.cos(t);
    const b = Math.tan(t);
    const target = 100 * q * fwhm(t);
    saa += a * a;
    sab += a * b;
    sbb += b * b;
    sat += a * target;
    sbt += b * target;
  }
  const det = saa * sbb - sab * sab;
  const x = (sat * sbb - sbt * sab) / det;
  const y = (saa * sbt - sab * sat) / det;
  const out = { u: g * p.u, v: g * p.v, w: g * p.w, x, y };
  let fwhmError = 0;
  let etaError = 0;
  for (const t of thetas) {
    const hg = Math.sqrt(
      LN2_8 * Math.max(0, out.u * Math.tan(t) ** 2 + out.v * Math.tan(t) + out.w),
    );
    const hl = out.x / Math.cos(t) + out.y * Math.tan(t);
    const h = tchFwhm(hg, hl) / 100;
    fwhmError = Math.max(fwhmError, Math.abs(h - fwhm(t)) / fwhm(t));
    etaError = Math.max(etaError, Math.abs(tchEta(hl / 100 / h) - eta));
  }
  return { ...out, fwhmError, etaError };
}

/**
 * Exact GSAS-II parameters for a refinement made with the TCH profile here, where H_G² =
 * U tan²θ + V tanθ + W (deg²) and H_L = X/cosθ + Y tanθ (deg): σ² = H_G²/(8 ln 2) in centideg²
 * and γ = H_L in centideg.
 */
export function tchExact(p: { u: number; v: number; w: number; x: number; y: number }): TchProfile {
  const g = 1e4 / LN2_8;
  return {
    u: g * p.u,
    v: g * p.v,
    w: g * p.w,
    x: 100 * p.x,
    y: 100 * p.y,
    fwhmError: 0,
    etaError: 0,
  };
}

export interface InstprmInput {
  kAlpha1: number;
  /** Kα2 wavelength and intensity ratio; ratio 0 writes a single wavelength. */
  kAlpha2: number;
  ratio: number;
  /** Zero shift, degrees 2θ. */
  zero: number;
  profile: TchProfile;
  /** Header lines, written as comments. */
  comments: string[];
}

const n = (v: number) => Number(v.toPrecision(8)).toString();

/** The .instprm text (Bragg–Brentano lab data, SH/L left at GSAS-II's default 0.002). */
export function instprm(input: InstprmInput): string {
  const { profile: p } = input;
  const wave =
    input.ratio > 0
      ? `Lam1:${n(input.kAlpha1)};Lam2:${n(input.kAlpha2)};I(L2)/I(L1):${n(input.ratio)}`
      : `Lam:${n(input.kAlpha1)}`;
  return [
    '#GSAS-II instrument parameter file; written by Plot Bhai as a starting point',
    ...input.comments.map((c) => `# ${c}`),
    'Type:PXC;Bank:1',
    `${wave};Zero:${n(input.zero)};Polariz.:0.5;Azimuth:0.0`,
    `U:${n(p.u)};V:${n(p.v)};W:${n(p.w)};X:${n(p.x)};Y:${n(p.y)};Z:0.0;SH/L:0.002`,
    'Diff-type:Bragg-Brentano',
    '',
  ].join('\n');
}

/** A CIF value: quoted when it has spaces or starts with a character CIF reserves. */
const quote = (s: string) => (/^[^\s'"_#$;[\]]+$/.test(s) ? s : `'${s.replace(/'/g, '’')}'`);

export interface CifPhaseInput {
  name: string;
  formula: string;
  spaceGroup: { hm: string; number: number };
  cell: Cell;
  structure: StoredStructure;
  /** Where the structure came from and what was refined, as comments. */
  comments: string[];
}

/**
 * A CIF 1.1 data block of one phase: cell, symmetry operators, atom sites (fractional x, y, z,
 * occupancy, U_iso in Å²) and anisotropic U where the source had them (U_iso is then '?').
 */
export function phaseCif(input: CifPhaseInput): string {
  const { cell, structure } = input;
  const f = (v: number) => Number(v.toPrecision(7)).toString();
  const lines = [
    ...input.comments.map((c) => `# ${c}`),
    `data_${input.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'phase'}`,
    `_chemical_name_common ${quote(input.name)}`,
    `_chemical_formula_sum ${quote(input.formula)}`,
    `_space_group_name_H-M_alt ${quote(input.spaceGroup.hm)}`,
    `_space_group_IT_number ${input.spaceGroup.number}`,
    `_cell_length_a ${f(cell.a)}`,
    `_cell_length_b ${f(cell.b)}`,
    `_cell_length_c ${f(cell.c)}`,
    `_cell_angle_alpha ${f(cell.alpha)}`,
    `_cell_angle_beta ${f(cell.beta)}`,
    `_cell_angle_gamma ${f(cell.gamma)}`,
    'loop_',
    '_space_group_symop_operation_xyz',
    ...structure.ops.map((op) => `'${op}'`),
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    '_atom_site_occupancy',
    '_atom_site_U_iso_or_equiv',
    ...structure.atoms.map((a) =>
      [
        quote(a.label),
        a.element,
        ...a.x.map(f),
        f(a.occupancy),
        // Atoms with anisotropic U only: '?' here, the values are in the aniso loop below.
        a.uIso === null ? '?' : f(a.uIso),
      ].join(' '),
    ),
  ];
  const aniso = structure.atoms.filter((a) => a.uAniso);
  if (aniso.length > 0)
    lines.push(
      'loop_',
      '_atom_site_aniso_label',
      ...['11', '22', '33', '12', '13', '23'].map((k) => `_atom_site_aniso_U_${k}`),
      ...aniso.map((a) => [quote(a.label), ...(a.uAniso ?? []).map(f)].join(' ')),
    );
  return `${lines.join('\n')}\n`;
}
