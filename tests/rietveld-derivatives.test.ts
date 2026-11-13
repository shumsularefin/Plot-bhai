// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import { dSpacing, reciprocalMetric, type FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferenceFamilyFile, ReferencePhase } from '../src/core/xrd/reference/types';
import { laueClass, stephensFromIsotropic } from '../src/core/xrd/rietveld/broadening';
import { cellKind, cellParameterNames } from '../src/core/xrd/rietveld/cell';
import { fillJacobian } from '../src/core/xrd/rietveld/derivatives';
import { dispersionFor, type DispersionFile } from '../src/core/xrd/rietveld/dispersion';
import {
  atomStates,
  makeLayout,
  peakWindows,
  phaseCurve,
  placePeaks,
  type Layout,
  type PhaseModel,
  type Wavelengths,
} from '../src/core/xrd/rietveld/model';
import { refinementReflections, type Hkl } from '../src/core/xrd/rietveld/reflections';
import {
  structureFactorGradient,
  structureFactorSquared,
  structureModel,
  type Substitution,
} from '../src/core/xrd/rietveld/structure';

/*
 * The peak-by-peak Jacobian (derivatives.ts) against central differences of the whole calculated
 * pattern, for every option of the model, and the exact Σ|F|² gradient (structure.ts) against
 * central differences and symmetry invariances.
 */
const json = (path: string) =>
  JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const cu = dispersionFor(
  json('data/reference/anomalous-dispersion.json') as DispersionFile,
  'Cu',
) as NonNullable<ReturnType<typeof dispersionFor>>;
const reference = (file: string, id: string) =>
  (json(`tests/fixtures/cod-reference/${file}.json`) as ReferenceFamilyFile).phases.find(
    (p) => p.id === id,
  ) as ReferencePhase;
const ZNO = reference('zno', 'zno-wurtzite');
const WO3 = reference('wo3', 'wo3-monoclinic');
const CEO2 = reference('ceo2', 'ceo2');
const CU2: Wavelengths = { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 };

interface PhaseOptions {
  structure?: boolean;
  isotropic?: boolean;
  /** Every atom made anisotropic from its U_iso (u = U_iso G*, exactly symmetric). */
  anisotropic?: boolean;
  dispersion?: boolean;
  substitution?: Substitution[];
  extra?: Partial<PhaseModel>;
}

function phaseModel(ref: ReferencePhase, o: PhaseOptions): PhaseModel {
  const kind = cellKind(ref.crystalSystem, ref.cell);
  const stored = ref.structure as NonNullable<ReferencePhase['structure']>;
  const s =
    o.isotropic || o.anisotropic
      ? { ...stored, atoms: stored.atoms.map((a) => ({ ...a, uAniso: null })) }
      : stored;
  return {
    id: ref.id,
    name: ref.name,
    kind,
    cell: ref.cell,
    reflections: refinementReflections(ref.peaks, ref.cell, kind, 0.8),
    orientation: null,
    ...(o.structure && {
      structure: structureModel(
        ref.cell,
        s,
        factors,
        {},
        o.anisotropic === true,
        o.substitution ?? [],
        o.dispersion ? cu : undefined,
      ),
    }),
    ...o.extra,
  };
}

/** Parameters with every term away from its special value, so each derivative is exercised. */
function parameters(phases: PhaseModel[], layout: Layout, set: (p: Float64Array) => void) {
  const p = new Float64Array(layout.size);
  p[layout.roughness[0]] = 1;
  phases.forEach((phase, k) => {
    const pl = layout.phases[k] as Layout['phases'][number];
    const c = phase.cell;
    const values: Record<string, number> = {
      a: c.a,
      b: c.b,
      c: c.c,
      alpha: c.alpha,
      beta: c.beta,
      gamma: c.gamma,
    };
    cellParameterNames(phase.kind).forEach(
      (name, i) => (p[pl.cell[i] as number] = values[name] as number),
    );
    p[pl.scale] = phase.structure ? 1e-3 : 1e-1;
    p[pl.u] = 0.004;
    p[pl.v] = -0.002;
    p[pl.w] = 0.006;
    p[pl.eta] = 0.4;
    p[pl.lx] = 0.02;
    p[pl.ly] = 0.01;
    p[pl.orientation] = 1;
    p[pl.b] = 0.3;
    p[pl.inverseSize] = 0.01;
    p[pl.inverseSizeAxial] = 0.02;
    p[pl.microstrain] = 800;
    p[pl.microstrainAxial] = 1200;
    p[pl.sizeMix] = 0.7;
    p[pl.strainMix] = 0.4;
    if (phase.laue) {
      const g = reciprocalMetric(phase.cell);
      stephensFromIsotropic(
        phase.laue,
        900,
        g,
        phase.reflections.map((r) => r.hkl),
      ).forEach((v, i) => (p[pl.stephens[i] as number] = v * (1 + 0.1 * i)));
    }
    let s = 0;
    phase.structure?.atoms.forEach((atom, a) => {
      const al = pl.atoms[a] as Layout['phases'][number]['atoms'][number];
      for (const j of al.coords) p[j] = 0.004 * Math.sin(++s);
      p[al.occupancy] = 0.93;
      p[al.b] = 0.5 + 0.1 * a;
      al.aniso.forEach((j, i) => (p[j] = 0.001 * Math.cos(++s + i)));
      p[al.fraction] = atom.substitute ? 0.15 : 0;
    });
  });
  set(p);
  return p;
}

interface Case {
  name: string;
  phases: PhaseModel[];
  wavelengths: Wavelengths;
  set?: (p: Float64Array, layout: Layout) => void;
  /** Parameters left out of the comparison (no effect or a clamp at the current value). */
  skip?: (layout: Layout) => number[];
}

const CASES: Case[] = [
  {
    name: 'ZnO, anisotropic U, f′ f″, Mg on the Zn site, asymmetry, orientation, flat-plate terms',
    phases: [
      phaseModel(ZNO, {
        structure: true,
        dispersion: true,
        substitution: [{ site: 'Zn', element: 'Mg', fraction: 0.15, refine: true }],
        extra: { orientation: [0, 0, 1] },
      }),
    ],
    wavelengths: { ...CU2, polarisation: 0.45, variableSlit: true },
    set: (p, layout) => {
      const pl = layout.phases[0] as Layout['phases'][number];
      p[layout.zero] = 0.03;
      p[layout.displacement] = -0.05;
      p[layout.transparency] = 0.02;
      p[layout.roughness[0]] = 0.9;
      p[layout.roughness[1]] = 0.3;
      p[pl.orientation] = 0.85;
      p[pl.asymmetry[0]] = 0.03;
      p[pl.asymmetry[1]] = -0.01;
    },
  },
  {
    name: 'WO₃ monoclinic, isotropic atoms, TCH, uniaxial size and generalized microstrain',
    phases: [
      phaseModel(WO3, {
        structure: true,
        isotropic: true,
        extra: {
          tch: true,
          sample: true,
          laue: laueClass(cellKind(WO3.crystalSystem, WO3.cell)),
          sizeModel: 'uniaxial',
          sizeAxis: [0, 1, 0],
          strainModel: 'generalized',
        },
      }),
    ],
    wavelengths: CU2,
    set: (p, layout) => {
      p[layout.zero] = -0.02;
      p[layout.displacement] = 0.04;
    },
  },
  {
    name: 'CeO₂ with axial divergence (FCJ), capillary absorption and uniaxial microstrain',
    phases: [
      phaseModel(CEO2, {
        structure: true,
        isotropic: true,
        extra: { tch: true, sample: true, strainModel: 'uniaxial', strainAxis: [1, 1, 1] },
      }),
    ],
    wavelengths: { ...CU2, capillary: true },
    set: (p, layout) => {
      p[layout.axial] = 0.02;
      p[layout.absorption] = 1.2;
      p[layout.displacement] = 0.03;
      p[layout.transparency] = -0.02;
    },
  },
  {
    name: 'Two phases (ZnO structure, CeO₂ Le Bail) sharing zero, displacement and asymmetry',
    phases: [
      phaseModel(ZNO, { structure: true }),
      (() => {
        const m = phaseModel(CEO2, {});
        return { ...m, leBail: Float64Array.from(m.reflections, (r) => r.mf2 * 0.8) };
      })(),
    ],
    wavelengths: CU2,
    set: (p, layout) => {
      p[layout.zero] = 0.01;
      p[layout.displacement] = 0.02;
      (layout.phases[1] as Layout['phases'][number]).asymmetry.forEach(
        (j, i) => (p[j] = 0.02 - 0.03 * i),
      );
    },
  },
];

/**
 * Reference column: central differences of the whole pattern with the windows of p (model.ts) at
 * steps h and h/2, combined by Richardson extrapolation, (4 D(h/2) − D(h))/3, which removes the
 * h² error term, so h can be large enough for rounding to stay small. Only the phases the
 * parameter acts on are differenced, so a strong peak of another phase adds no rounding error.
 */
function referenceColumn(
  x: Float64Array,
  c: Case,
  layout: Layout,
  p: Float64Array,
  windows: Int32Array[],
  j: number,
  sw: Float64Array,
  phaseOf: Int32Array,
): Float64Array {
  const total = (q: Float64Array) => {
    const out = new Float64Array(x.length);
    c.phases.forEach((_, k) => {
      if (phaseOf[j] !== -1 && phaseOf[j] !== k) return;
      const y = phaseCurve(x, c.phases, layout, k, q, c.wavelengths, windows[k]);
      for (let i = 0; i < x.length; i++) out[i] = (out[i] as number) + (y[i] as number);
    });
    return out;
  };
  const central = (h: number) => {
    const plus = p.slice();
    plus[j] = (p[j] as number) + h;
    const minus = p.slice();
    minus[j] = (p[j] as number) - h;
    const a = total(plus);
    const b = total(minus);
    return a.map((v, i) => (v - (b[i] as number)) / (2 * h));
  };
  const h = 1e-5 * Math.max(Math.abs(p[j] as number), 1e-2);
  const coarse = central(h);
  const fine = central(h / 2);
  return fine.map((v, i) => ((4 * v - (coarse[i] as number)) / 3) * (sw[i] as number));
}

describe('Analytic Jacobian of the calculated pattern', () => {
  const x = Float64Array.from({ length: 8001 }, (_, i) => 20 + i * 0.01);
  const sw = x.map((_, i) => 1 + 0.3 * Math.sin(i / 7));

  it.each(CASES.map((c) => [c.name, c] as const))('%s', { timeout: 120_000 }, (_name, c) => {
    const layout = makeLayout(c.phases, 0);
    const p = parameters(c.phases, layout, (q) => c.set?.(q, layout));
    const peaks = c.phases.map((_, k) => placePeaks(c.phases, layout, k, p, c.wavelengths));
    const windows = peaks.map((list) => peakWindows(x, list));
    const phaseOf = new Int32Array(layout.size).fill(-1);
    layout.phases.forEach((pl, k) => {
      const own = [
        pl.scale,
        ...pl.cell,
        pl.u,
        pl.v,
        pl.w,
        pl.eta,
        pl.lx,
        pl.ly,
        pl.orientation,
        pl.b,
        ...pl.asymmetry,
        pl.inverseSize,
        pl.inverseSizeAxial,
        pl.microstrain,
        pl.microstrainAxial,
        ...pl.stephens,
        pl.sizeMix,
        pl.strainMix,
        ...pl.atoms.flatMap((al) => [...al.coords, al.occupancy, al.b, ...al.aniso, al.fraction]),
      ];
      for (const j of own) phaseOf[j] = k;
    });
    const columns = Array.from({ length: layout.size }, (_, j) => j);
    const m = layout.size;
    const jacobian = new Float64Array(x.length * m);
    const fallback = fillJacobian({
      x,
      sw,
      phases: c.phases,
      layout,
      wavelengths: c.wavelengths,
      params: p,
      peaks,
      windows,
      columns,
      phaseOf,
      step: (j) => 1e-6 * Math.max(Math.abs(p[j] as number), 1e-3),
      jacobian,
      m,
    });
    expect(fallback).toEqual([]);
    let checked = 0;
    for (const j of columns) {
      // SH/L = 0 sits on its bound (max(0, SH/L)): the one-sided difference is the derivative used.
      if (j === layout.axial && p[j] === 0) continue;
      const reference = referenceColumn(x, c, layout, p, windows, j, sw, phaseOf);
      const scale = reference.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
      let error = 0;
      let size = 0;
      for (let i = 0; i < x.length; i++) {
        const a = jacobian[i * m + j] as number;
        size = Math.max(size, Math.abs(a));
        error = Math.max(error, Math.abs(a - (reference[i] as number)));
      }
      if (scale === 0) {
        expect(size, `parameter ${j}`).toBe(0);
        continue;
      }
      checked++;
      expect(error / scale, `parameter ${j}`).toBeLessThan(2e-5);
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('Exact Σ|F|² gradient', () => {
  const zno = phaseModel(ZNO, {
    structure: true,
    dispersion: true,
    substitution: [{ site: 'Zn', element: 'Mg', fraction: 0.2, refine: true }],
  });
  const layout = makeLayout([zno], 0);
  const p = parameters([zno], layout, () => undefined);
  const pl = layout.phases[0] as Layout['phases'][number];
  const order = pl.atoms.flatMap((al) => [
    ...al.coords,
    al.occupancy,
    al.b,
    ...al.aniso,
    al.fraction,
  ]);
  const structure = zno.structure as NonNullable<PhaseModel['structure']>;
  const value = (q: Float64Array, members: Hkl[], d: number) =>
    members.reduce(
      (s, h) => s + structureFactorSquared(structure, atomStates(zno, pl, q), h, d),
      0,
    );

  const dOf = (hkl: Hkl) => dSpacing(reciprocalMetric(ZNO.cell), hkl[0], hkl[1], hkl[2]);

  it('matches central differences for every atom parameter of ZnO (f′ f″, U_ij, dopant)', () => {
    let checked = 0;
    for (const reflection of zno.reflections.slice(0, 15)) {
      const d = dOf(reflection.hkl);
      const { value: f2, gradient } = structureFactorGradient(
        structure,
        atomStates(zno, pl, p),
        reflection.members,
        d,
      );
      expect(f2 / value(p, reflection.members, d)).toBeCloseTo(1, 12);
      order.forEach((j, g) => {
        const h = 1e-5 * Math.max(Math.abs(p[j] as number), 1e-2);
        const plus = p.slice();
        plus[j] = (p[j] as number) + h;
        const minus = p.slice();
        minus[j] = (p[j] as number) - h;
        const central =
          (value(plus, reflection.members, d) - value(minus, reflection.members, d)) / (2 * h);
        expect(Math.abs((gradient[g] as number) - central)).toBeLessThan(1e-6 * f2 + 1e-9);
        if (central !== 0) checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('is the same for every member of a family (equivalent reflections)', () => {
    // The file's U_ij are rounded (U12 is not exactly U11/2), which breaks the hexagonal symmetry
    // by about 2·10⁻⁴; U made from U_iso is exactly symmetric, and so are its allowed changes.
    const sym = phaseModel(ZNO, {
      structure: true,
      anisotropic: true,
      dispersion: true,
      substitution: [{ site: 'Zn', element: 'Mg', fraction: 0.2, refine: true }],
    });
    const symLayout = makeLayout([sym], 0);
    const symP = parameters([sym], symLayout, () => undefined);
    const symStructure = sym.structure as NonNullable<PhaseModel['structure']>;
    const states = atomStates(sym, symLayout.phases[0] as Layout['phases'][number], symP);
    let compared = 0;
    for (const reflection of sym.reflections.slice(0, 15)) {
      const d = dOf(reflection.hkl);
      const first = structureFactorGradient(symStructure, states, [reflection.hkl], d);
      const norm = first.gradient.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
      for (const member of reflection.members) {
        const g = structureFactorGradient(symStructure, states, [member], d);
        expect(g.value / first.value).toBeCloseTo(1, 12);
        g.gradient.forEach((v, i) =>
          expect(Math.abs(v - (first.gradient[i] as number))).toBeLessThan(1e-10 * norm),
        );
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('gives zero for a common shift of every atom along the polar c axis (origin choice)', () => {
    const states = atomStates(zno, pl, p);
    let offset = 0;
    const along = structure.atoms.map((atom) => {
      const z = atom.basis.map((v) => (v[2] as number) / (v[0] ** 2 + v[1] ** 2 + v[2] ** 2));
      const at = offset;
      offset += atom.basis.length + 3 + atom.uBasis.length;
      return { at, z };
    });
    for (const reflection of zno.reflections.slice(0, 15)) {
      const d = dOf(reflection.hkl);
      const g = structureFactorGradient(structure, states, reflection.members, d).gradient;
      let sum = 0;
      let size = 0;
      for (const { at, z } of along)
        z.forEach((zk, k) => {
          sum += (g[at + k] as number) * zk;
          size = Math.max(size, Math.abs(g[at + k] as number));
        });
      expect(Math.abs(sum)).toBeLessThan(1e-9 * Math.max(size, 1));
    }
  });
});
