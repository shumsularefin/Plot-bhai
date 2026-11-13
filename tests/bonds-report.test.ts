import { describe, expect, it } from 'vitest';
import type { RietveldResult } from '../src/core/xrd/rietveld/refine';
import { bondsMethodsFor, DEFAULT_BONDS } from '../src/modules/xrd/bondsReport';
import type { RietveldState } from '../src/modules/xrd/data';

const state = (geometry: boolean, tolerance?: number): RietveldState =>
  ({
    result: {
      key: '',
      methods: '',
      outcome: { ok: true, phases: [{ geometry: geometry ? {} : null }] } as RietveldResult,
    },
    ...(tolerance !== undefined && { bonds: { ...DEFAULT_BONDS, tolerance } }),
  }) as RietveldState;

describe('bond methods text', () => {
  it('is empty without a refined structure', () => {
    expect(bondsMethodsFor(undefined)).toBe('');
    expect(bondsMethodsFor(state(false))).toBe('');
  });
  it('names the bond criterion, the equation and the table', () => {
    const text = bondsMethodsFor(state(true));
    expect(text).toContain('covalent radii (Cordero et al., 2008) plus 0.45 Å');
    expect(text).toContain('Brown & Altermatt, 1985');
    expect(text).toContain('bvparm2020');
    expect(bondsMethodsFor(state(true, 0.6))).toContain('plus 0.6 Å');
  });
});
