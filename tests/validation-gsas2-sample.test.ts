// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReferenceFamilyFile } from '../src/core/xrd/reference/types';
import { DEFAULT_CHOICES, refineRietveld } from '../src/core/xrd/rietveld/refine';

/*
 * Independent check against GSAS-II: scripts/validation/gsas2/sample.py (run on GitHub by
 * .github/workflows/validation.yml) simulated a CeO2 pattern (COD 9009008) in GSAS-II with a known
 * crystallite size, microstrain, polarisation coefficient, Suortti surface roughness and
 * transparency, added Poisson noise, and refined the same data in GSAS-II by Rietveld and by
 * Le Bail with the instrument fixed. Here this site refines the same data with the same fixed
 * instrument (converted from GSAS-II units) and must recover what GSAS-II was given.
 *
 * Units: GSAS-II size in µm (here nm), microstrain the same; transparency T (deg) =
 * −9 · Transparency · / (π R) with R the goniometer radius in mm (GSASIIstrMath.GetReflPos).
 */
interface Result {
  Rwp: number;
  cell: { length_a: number };
  sizeMicrons: number;
  mustrain: number;
  Transparency: number;
  SurfRoughB: number;
  esd: Record<string, number>;
}
interface Fixture {
  wavelengths: { kAlpha1: number; kAlpha2: number; ratio: number };
  instrument: Record<'U' | 'V' | 'W' | 'X' | 'Y' | 'Polariz.', number>;
  goniometerRadius: number;
  truth: {
    sizeMicrons: number;
    mustrain: number;
    SurfRoughB: number;
    Transparency: number;
    cell: { length_a: number };
  };
  gsas2: Result;
  gsas2LeBail: Result;
  gsas2LeBailTransparency: Result;
  /** GSAS-II's reflections of the simulation: h, k, l, multiplicity, d (Å), |F|² per reflection. */
  reflections: [number, number, number, number, number, number][];
}
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as unknown;
const fixture = json('tests/fixtures/validation/ceria-sample.json') as Fixture;
const rows = read('tests/fixtures/validation/ceria-sample.xy')
  .trim()
  .split('\n')
  .map((line) => line.trim().split(/\s+/).map(Number));
const ceria = (json('tests/fixtures/cod-reference/ceo2.json') as ReferenceFamilyFile).phases.find(
  (p) => p.id === 'ceo2',
);
const atomicWeights = Object.fromEntries(
  (
    json('data/thermal/atomic-weights.json') as { elements: { symbol: string; weight: number }[] }
  ).elements.map((e) => [e.symbol, e.weight]),
);
const G = 8 * Math.LN2 * 1e-4;
const ip = fixture.instrument;
const instrument = { u: ip.U * G, v: ip.V * G, w: ip.W * G, x: ip.X / 100, y: ip.Y / 100 };
const toT = (transparency: number) => (-9 * transparency) / (Math.PI * fixture.goniometerRadius);

function refine(leBail: boolean, options: { transparency?: boolean; gsas2Angles?: boolean } = {}) {
  if (!ceria) throw new Error('ceo2 missing');
  const result = refineRietveld({
    x: Float64Array.from(rows, (r) => r[0] as number),
    y: Float64Array.from(rows, (r) => r[1] as number),
    wavelengths: {
      ...fixture.wavelengths,
      polarisation: ip['Polariz.'],
      ...(options.gsas2Angles && { correctionsAtKAlpha1: true }),
    },
    phases: [
      {
        id: ceria.id,
        name: ceria.name,
        crystalSystem: ceria.crystalSystem,
        cell: ceria.cell,
        peaks: ceria.peaks,
        orientation: null,
        ...(leBail && { leBail: true }),
      },
    ],
    choices: {
      ...DEFAULT_CHOICES,
      zero: false,
      size: true,
      strain: true,
      ...(!leBail && { transparency: true, roughness: true }),
      ...(options.transparency && { transparency: true }),
    },
    backgroundTerms: 6,
    atomicWeights,
    instrument,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('Sample broadening and intensity corrections against GSAS-II (CeO2)', () => {
  it('Rietveld: recovers size, microstrain, transparency and roughness that GSAS-II was given', () => {
    const result = refine(false);
    const fit = result.phases[0];
    if (!fit?.size || !fit.microstrain) throw new Error('no size');
    const t = fixture.truth;
    const g = fixture.gsas2;
    const sizeEsdGsas = 1000 * (g.esd['0:0:Size;i'] as number);
    // Size and strain: within 3 s.u. of the truth and of GSAS-II's own refinement.
    expect(Math.abs(fit.size.value - 1000 * t.sizeMicrons)).toBeLessThan(3 * fit.size.esd);
    expect(Math.abs(fit.size.value - 1000 * g.sizeMicrons)).toBeLessThan(
      3 * Math.hypot(fit.size.esd, sizeEsdGsas),
    );
    expect(Math.abs(fit.microstrain.value - t.mustrain)).toBeLessThan(3 * fit.microstrain.esd);
    expect(Math.abs(fit.microstrain.value - g.mustrain)).toBeLessThan(
      3 * Math.hypot(fit.microstrain.esd, g.esd['0:0:Mustrain;i'] as number),
    );
    // Our uncertainties are those of GSAS-II within 15 %.
    expect(fit.size.esd / sizeEsdGsas).toBeGreaterThan(0.85);
    expect(fit.size.esd / sizeEsdGsas).toBeLessThan(1.15);
    // Transparency (converted from GSAS-II units) within 3 s.u. of the truth.
    expect(Math.abs(result.transparency.value - toT(t.Transparency))).toBeLessThan(
      3 * result.transparency.esd,
    );
    // Surface roughness B within 1.5 % of the truth. GSAS-II made the data with LP, polarisation
    // and roughness taken at the Kα1 angle for both lines; here each line uses its own angle,
    // which moves B by 0.6 % (the GSAS-II convention is checked in the next test).
    expect(Math.abs(result.roughness[1].value - t.SurfRoughB) / t.SurfRoughB).toBeLessThan(0.015);
    // Cell within 3 s.u. of the truth; R_wp within 2 % (relative) of GSAS-II's.
    expect(Math.abs(fit.cell.a.value - t.cell.length_a)).toBeLessThan(3 * fit.cell.a.esd);
    expect(Math.abs(result.stats.rwp * 100 - g.Rwp) / g.Rwp).toBeLessThan(0.02);
    expect(result.stats.chi2).toBeLessThan(1.4);
  }, 120_000);

  it('has the same |F|² as GSAS-II for every reflection (scattering factors)', () => {
    if (!ceria) throw new Error('ceo2 missing');
    let compared = 0;
    for (const peak of ceria.peaks) {
      const gsas = fixture.reflections
        .filter((r) => Math.abs(r[4] - peak.d) < 1e-3)
        .reduce((sum, r) => sum + r[3] * r[5], 0);
      if (gsas === 0) continue; // beyond GSAS-II's 2θ range
      expect(Math.abs(peak.mf2 - gsas) / gsas).toBeLessThan(5e-5);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(14);
  });

  it('with GSAS-II’s convention for the Kα2 corrections, roughness B equals GSAS-II’s', () => {
    const result = refine(false, { gsas2Angles: true });
    const g = fixture.gsas2;
    const b = result.roughness[1];
    expect(Math.abs(b.value - g.SurfRoughB)).toBeLessThan(
      2 * Math.hypot(b.esd, g.esd[':0:SurfRoughB'] as number),
    );
    expect(Math.abs(result.transparency.value - toT(g.Transparency))).toBeLessThan(
      2 * Math.hypot(result.transparency.esd, toT(g.esd[':0:Transparency'] as number)),
    );
    expect(Math.abs(result.stats.rwp * 100 - g.Rwp) / g.Rwp).toBeLessThan(0.005);
  }, 120_000);

  it('Le Bail with the transparency refined: cell, size and strain as GSAS-II’s, true cell', () => {
    const result = refine(true, { transparency: true });
    const fit = result.phases[0];
    if (!fit?.size || !fit.microstrain) throw new Error('no size');
    const g = fixture.gsas2LeBailTransparency;
    // GSAS-II refines A0 = 1/a², so σ(a) = σ(A0) a³ / 2.
    const esdA = ((g.esd['0::A0'] as number) * g.cell.length_a ** 3) / 2;
    expect(Math.abs(fit.cell.a.value - g.cell.length_a)).toBeLessThan(
      3 * Math.hypot(fit.cell.a.esd, esdA) + 2e-6,
    );
    expect(Math.abs(fit.cell.a.value - fixture.truth.cell.length_a)).toBeLessThan(
      3 * fit.cell.a.esd,
    );
    expect(Math.abs(fit.size.value - 1000 * g.sizeMicrons)).toBeLessThan(
      2 * Math.hypot(fit.size.esd, 1000 * (g.esd['0:0:Size;i'] as number)),
    );
    expect(Math.abs(fit.microstrain.value - g.mustrain)).toBeLessThan(
      2 * Math.hypot(fit.microstrain.esd, g.esd['0:0:Mustrain;i'] as number),
    );
    expect(Math.abs(result.transparency.value - toT(g.Transparency))).toBeLessThan(
      2 * Math.hypot(result.transparency.esd, toT(g.esd[':0:Transparency'] as number)),
    );
  }, 120_000);

  it('Le Bail: the same cell, size and microstrain as GSAS-II’s Le Bail fit', () => {
    const result = refine(true);
    const fit = result.phases[0];
    if (!fit?.size || !fit.microstrain) throw new Error('no size');
    const g = fixture.gsas2LeBail;
    expect(fit.leBail).toBe(true);
    const sizeEsdGsas = 1000 * (g.esd['0:0:Size;i'] as number);
    expect(Math.abs(fit.size.value - 1000 * g.sizeMicrons)).toBeLessThan(
      2 * Math.hypot(fit.size.esd, sizeEsdGsas),
    );
    expect(Math.abs(fit.microstrain.value - g.mustrain)).toBeLessThan(
      2 * Math.hypot(fit.microstrain.esd, g.esd['0:0:Mustrain;i'] as number),
    );
    // Both fits leave the transparency out, so both cells absorb its shift; they agree within
    // 1e-4 Å (2 parts in 10⁵; 6 s.u., an open item in docs/validation.md).
    expect(Math.abs(fit.cell.a.value - g.cell.length_a)).toBeLessThan(1e-4);
    expect(Math.abs(result.stats.rwp * 100 - g.Rwp) / g.Rwp).toBeLessThan(0.03);
  }, 120_000);
});
