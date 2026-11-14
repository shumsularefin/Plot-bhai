// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile } from '../src/core/xrd/import';
import { ANODES } from '../src/core/xrd/radiation';
import { cifNumber, parseCifBlocks } from '../src/core/xrd/reference/cif';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferencePhase } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';
import {
  braggTwoTheta,
  MONOCHROMATORS,
  monochromatorFraction,
} from '../src/core/xrd/rietveld/sample';

/*
 * Real measured patterns with a known answer: the data releases of NIST Standard Reference
 * Materials 660c (LaB₆) and 640f (Si), as powder CIFs (tests/fixtures-real/README.md). Each file
 * holds the measured pattern, the weights NIST used and the lattice parameter NIST refined from
 * that very pattern with the fundamental parameters approach (Topas): D. R. Black et al., Powder
 * Diffraction 35 (2020) 17–22, doi 10.1017/S0885715620000068, for 660c. The site's refinement of
 * the same pattern, with its own simpler profile, must give the same lattice parameter.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const factors = (json('data/reference/scattering-factors.json') as { factors: FormFactors })
  .factors;
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as {
      elements: { symbol: string; weight: number }[];
    }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const cu = ANODES.Cu;

function phaseOf(cod: string): ReferencePhase {
  const result = phaseFromCif(read(`scripts/cif-cache/${cod}.cif`), cod, factors, cod);
  if (!result.ok) throw new Error(result.error);
  return result.phase;
}

function nistCell(file: string): number {
  const text = read(`tests/fixtures-real/${file}`);
  const block = parseCifBlocks(text).find((b) => b.items.has('_cell_length_a'));
  return cifNumber(block?.items.get('_cell_length_a')) as number;
}

function refine(
  file: string,
  cod: string,
  monochromator: keyof typeof MONOCHROMATORS,
  ratio: number,
) {
  const imported = importFile(
    file,
    new Uint8Array(readFileSync(join(process.cwd(), 'tests/fixtures-real', file))),
  );
  if (!imported.ok) throw new Error(imported.error);
  const pattern = imported.pattern;
  const phase = phaseOf(cod);
  const mono = MONOCHROMATORS[monochromator];
  const result = refineRietveld({
    x: pattern.twoTheta,
    y: pattern.intensity,
    ...(pattern.sigma && { sigma: pattern.sigma }),
    wavelengths: {
      kAlpha1: cu.kAlpha1,
      kAlpha2: cu.kAlpha2,
      ratio,
      polarisation: monochromatorFraction(braggTwoTheta(cu.kAlpha1, mono.d), mono.perfect),
    },
    phases: [
      {
        id: phase.id,
        name: phase.name,
        crystalSystem: phase.crystalSystem,
        cell: phase.cell,
        peaks: phase.peaks,
        orientation: null,
        ...(phase.cellContents && { cellContents: phase.cellContents }),
        ...(phase.structure && { structure: phase.structure }),
      },
    ],
    choices: {
      ...DEFAULT_CHOICES,
      // NIST's 2θ values are already corrected for the zero error (_pd_proc_2theta_corrected).
      zero: false,
      displacement: true,
      asymmetry: true,
      tch: true,
      overallB: true,
    },
    backgroundTerms: 6,
    atomicWeights,
    factors,
    radii: {},
  });
  if (!result.ok) throw new Error(result.error);
  return { pattern, result };
}

describe.each([
  // LaB₆: Kα1 + Kα2, graphite analyser, 6.8° Soller slits; Δa/a = −74 ppm, and −74 to +101 ppm
  // with the other asymmetry models (validation.md, section 21), so 100 ppm.
  {
    file: 'nist_srm660c_lab6.cif',
    cod: '2104736',
    monochromator: 'graphite',
    ratio: 0.5,
    tolerance: 100e-6,
    maxGof: 2.5,
  },
  // Si: Kα1 from a Ge (111) monochromator, 2.6° Soller slits; Δa/a = +1.0 ppm, s.u. 1.0 ppm.
  {
    file: 'nist_srm640f_si.cif',
    cod: '2104737',
    monochromator: 'germanium',
    ratio: 0,
    tolerance: 5e-6,
    maxGof: 1.2,
  },
] as const)('$file', ({ file, cod, monochromator, ratio, tolerance, maxGof }) => {
  const { pattern, result } = refine(file, cod, monochromator, ratio);
  const a = result.phases[0]?.cell.a as { value: number; esd: number };
  const nist = nistCell(file);

  it('reads the measured pattern and its weights', () => {
    expect(pattern.source).toBe('cif');
    expect(pattern.sigma?.length).toBe(pattern.twoTheta.length);
  });

  it('weights the points by the file’s uncertainties, without the counting-statistics warnings', () => {
    expect(result.warnings.some((w) => w.includes('raw counts'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('scatter of the points'))).toBe(false);
    // NIST's weights describe the noise: χ² near 1 for Si, the fit not the weights limits LaB₆.
    expect(result.stats.gof).toBeLessThan(maxGof);
  });

  it('refines the lattice parameter NIST refined from the same pattern', () => {
    expect(Math.abs((a.value - nist) / nist)).toBeLessThan(tolerance);
  });
});
