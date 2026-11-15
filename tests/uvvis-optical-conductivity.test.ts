import { describe, expect, it } from 'vitest';
import { extinctionCoefficient, opticalConductivity } from '../src/core/uvvis/optics';
import { bandEdgeAbsorbance } from '../src/core/uvvis/synthetic';
import type { Spectrum } from '../src/core/uvvis/types';
import { DEFAULT_BAND_GAP, initialUvvisData, type BandGapChoice } from '../src/modules/uvvis/data';
import { methodsText } from '../src/modules/uvvis/methodsText';

/*
 * Optical conductivity σ = ε₀·c·n·α (stage 22 part D1, docs/validation.md section 22), from
 * M. Fox, Optical Properties of Solids, eqs. 7.15 and 7.18 and κ = ε₂/2n (pp. 183, 184, 194).
 */
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('optical conductivity', () => {
  it('matches a value worked by hand', () => {
    // ε₀ c = 8.8541878188e-12 F/m × 299 792 458 m/s = 2.6544187297917106e-3 S;
    // α = 1e4 cm⁻¹ = 1e6 m⁻¹, n = 2: σ = 2 × 1e6 × 2.6544187297917106e-3 = 5308.8374595834212 S/m.
    expect(rel(opticalConductivity(1e4, 2), 5308.8374595834212)).toBeLessThan(1e-12);
  });

  it('agrees with Re σ = ε₀ ω ε₂, ε₂ = 2nk, k = αλ/(4π)', () => {
    const eps0 = 8.8541878188e-12;
    const c = 299792458;
    for (const [alpha, nm, n] of [
      [3.2e4, 380, 2.4],
      [150, 900, 1.9],
      [2.5e5, 250, 3.1],
    ] as const) {
      const k = extinctionCoefficient(alpha, nm);
      const omega = (2 * Math.PI * c) / (nm * 1e-9);
      expect(rel(opticalConductivity(alpha, n), eps0 * omega * 2 * n * k)).toBeLessThan(1e-12);
    }
  });

  it('scales with n and α and is NaN for impossible inputs', () => {
    expect(rel(opticalConductivity(2e4, 3), 3 * opticalConductivity(2e4, 1))).toBeLessThan(1e-15);
    expect(rel(opticalConductivity(6e4, 1), 3 * opticalConductivity(2e4, 1))).toBeLessThan(1e-15);
    expect(opticalConductivity(1e4, 0)).toBeNaN();
    expect(opticalConductivity(1e4, -1)).toBeNaN();
    expect(opticalConductivity(Number.NaN, 2)).toBeNaN();
  });
});

describe('optical conductivity in the methods text', () => {
  const s = bandEdgeAbsorbance({ startNm: 250, endNm: 850, stepNm: 1, bandGapEv: 3.2, n: 0.5 });
  const spectrum: Spectrum = {
    id: 's',
    name: 's',
    source: 'synthetic',
    wavelengthNm: s.wavelengthNm,
    values: s.values,
    kind: 'absorbance',
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
  const text = (choice: BandGapChoice) =>
    methodsText({ ...initialUvvisData, spectra: [spectrum], bandGap: { s: choice } });

  it('appears only when n was typed and α is absolute', () => {
    const film = { ...DEFAULT_BAND_GAP, thicknessNm: 500 };
    expect(text(film)).not.toContain('optical conductivity');
    expect(text({ ...DEFAULT_BAND_GAP, assumedIndex: 2.1 })).not.toContain('optical conductivity');
    const used = text({ ...film, assumedIndex: 2.1 });
    expect(used).toContain('optical conductivity was estimated as σ = ε₀cnα');
    expect(used).toContain('n = 2.1');
  });
});
