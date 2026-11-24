import { describe, expect, it } from 'vitest';
import { atrCorrect, penetrationDepthUm } from '../src/core/ftir/atr';
import { parseJcamp } from '../src/core/ftir/jcamp';

describe('FTIR Harrick (1967) ATR penetration depth and JCAMP-DX validation', () => {
  it('matches exact Harrick (1967) penetration depths for Diamond and Ge crystals at 45°', () => {
    // dp = (1e4 / nu) / (2 * pi * n1 * sqrt(sin^2(theta) - (n2/n1)^2))
    // Diamond / ZnSe (n1 = 2.40), sample n2 = 1.50, theta = 45 deg, nu = 1000 cm^-1 -> ~2.008 um
    const dpDiamond = penetrationDepthUm(1000, 2.4, 1.5, 45);
    expect(dpDiamond).not.toBeNull();
    expect(dpDiamond).toBeCloseTo(2.0082, 3);

    // Ge (n1 = 4.00), sample n2 = 1.50, theta = 45 deg, nu = 1000 cm^-1 -> ~0.664 um
    const dpGe = penetrationDepthUm(1000, 4.0, 1.5, 45);
    expect(dpGe).not.toBeNull();
    expect(dpGe).toBeCloseTo(0.6639, 3);

    // Boundary & invalid angle rejection
    expect(penetrationDepthUm(1000, 2.4, 1.5, 90)).toBeNull();
    expect(penetrationDepthUm(1000, 2.4, 1.5, 135)).toBeNull();
    expect(penetrationDepthUm(1000, 1.5, 1.5, 45)).toBeNull();

    // atrCorrect guards referenceCm <= 0
    const nu = Float64Array.from([1000, 2000]);
    const abs = Float64Array.from([0.5, 0.25]);
    expect(Array.from(atrCorrect(nu, abs, 0))).toEqual([0.5, 0.25]);
  });

  it('parses NIST-style JCAMP-DX XYPOINTS (single-space pairs) and micrometer conversion', () => {
    const jdx = [
      '##TITLE=Polystyrene reference',
      '##JCAMP-DX=4.24',
      '##DATA TYPE=INFRARED SPECTRUM',
      '##XUNITS=MICROMETERS',
      '##YUNITS=TRANSMITTANCE',
      '##XFACTOR=1.0',
      '##YFACTOR=1.0',
      '##XYPOINTS=(XY..XY)',
      '2.5, 0.95 5.0, 0.80 10.0, 0.40',
      '12.5, 0.70 20.0, 0.90',
      '##END=',
    ].join('\n');
    const parsed = parseJcamp(jdx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spectrum.wavenumber).toHaveLength(5);
      expect(parsed.spectrum.wavenumber[0]).toBeCloseTo(4000, 4);
      expect(parsed.spectrum.wavenumber[4]).toBeCloseTo(500, 4);
      expect(parsed.spectrum.yUnits).toBe('TRANSMITTANCE');
    }
  });
});
