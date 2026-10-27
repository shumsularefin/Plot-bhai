import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES } from '../src/core/xrd/radiation';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

/*
 * Independent check against GSAS-II (commit 2c62562 of github.com/AdvancedPhotonSource/GSAS-II).
 * scripts/validation/rietveld/sim.py simulated an anatase + rutile pattern in GSAS-II from the
 * same COD CIFs (9015929, 9007531), Cu Kα1/Kα2, with known cells, zero shift and phase fractions,
 * and added Poisson noise. GSAS-II uses a different peak shape (Thompson–Cox–Hastings with
 * asymmetry), so profile parameters are not compared. ref.py refined the same data in GSAS-II:
 * anatase a = 3.795836, c = 9.495211 Å; rutile a = 4.594137, c = 2.958913 Å; zero 0.03983°;
 * anatase weight fraction 0.76837(83); Rwp 4.82 %.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const truth = JSON.parse(read('tests/fixtures/rietveld/gsas-anatase-rutile.truth.json')) as {
  anatase: { cell: number[]; wt: number };
  rutile: { cell: number[]; wt: number };
  zero: number;
};

describe('Rietveld refinement of a GSAS-II simulated mixture', () => {
  it('recovers the cells, zero shift and weight fractions GSAS-II was given', () => {
    const rows = read('tests/fixtures/rietveld/gsas-anatase-rutile.xy')
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number));
    const x = Float64Array.from(rows, (r) => r[0] as number);
    const y = Float64Array.from(rows, (r) => r[1] as number);
    const family = JSON.parse(
      read('tests/fixtures/cod-reference/tio2.json'),
    ) as ReferenceFamilyFile;
    const weights = JSON.parse(read('data/thermal/atomic-weights.json')) as {
      elements: { symbol: string; weight: number }[];
    };
    const phases = ['anatase', 'rutile'].map((id) => {
      const p = family.phases.find((q) => q.id === id);
      if (!p?.cellContents) throw new Error(`${id} missing`);
      return {
        id,
        name: id,
        crystalSystem: p.crystalSystem,
        cell: p.cell,
        peaks: p.peaks,
        cellContents: p.cellContents,
        orientation: null,
      };
    });
    const result = refineRietveld({
      x,
      y,
      wavelengths: { kAlpha1: ANODES.Cu.kAlpha1, kAlpha2: ANODES.Cu.kAlpha2, ratio: 0.5 },
      phases,
      choices: DEFAULT_CHOICES,
      backgroundTerms: 6,
      atomicWeights: Object.fromEntries(weights.elements.map((e) => [e.symbol, e.weight])),
    });
    if (!result.ok) throw new Error(result.error);
    const [anatase, rutile] = result.phases;
    // Cells within 1e-4 Å of the values GSAS-II simulated (GSAS-II's own refinement: ≤ 6e-5 Å).
    expect(Math.abs((anatase?.cell.a.value ?? 0) - (truth.anatase.cell[0] as number))).toBeLessThan(
      1e-4,
    );
    expect(Math.abs((anatase?.cell.c.value ?? 0) - (truth.anatase.cell[2] as number))).toBeLessThan(
      1e-4,
    );
    expect(Math.abs((rutile?.cell.a.value ?? 0) - (truth.rutile.cell[0] as number))).toBeLessThan(
      1e-4,
    );
    expect(Math.abs((rutile?.cell.c.value ?? 0) - (truth.rutile.cell[2] as number))).toBeLessThan(
      1e-4,
    );
    expect(Math.abs(result.zero.value - truth.zero)).toBeLessThan(0.002);
    // Weight fraction within 0.3 % (absolute) of the truth; GSAS-II's refinement was 0.09 % off.
    expect(Math.abs((anatase?.weightFraction?.value ?? 0) - truth.anatase.wt)).toBeLessThan(0.003);
    expect(result.stats.rwp).toBeLessThan(0.06);
    expect(result.stats.gof).toBeLessThan(1.2);
  });
});
