// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AVOGADRO, xrayDensity } from '../src/core/xrd/analysis/density';

describe('X-ray density ρ = ZM / (N_A V)', () => {
  it('converts the cell mass and volume to g/cm³', () => {
    // N_A × 10⁻²¹ g/mol in 1000 Å³ (10⁻²¹ cm³) is exactly 1 g/cm³.
    expect(xrayDensity(AVOGADRO * 1e-21, 1000)).toBeCloseTo(1, 12);
    // Twice the mass in the same cell, or the same mass in half the cell, doubles it.
    expect(xrayDensity(2 * AVOGADRO * 1e-21, 1000)).toBeCloseTo(2, 12);
    expect(xrayDensity(AVOGADRO * 1e-21, 500)).toBeCloseTo(2, 12);
  });

  it('refuses a mass or volume that is not positive', () => {
    expect(xrayDensity(0, 100)).toBeNaN();
    expect(xrayDensity(100, -1)).toBeNaN();
  });
});
