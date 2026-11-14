// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANODES, type Anode } from '../src/core/xrd/radiation';

/*
 * Second and third copies of three tabulated data sets (scripts/validation/tables/make_tables.py,
 * run by hand; docs/validation.md, section 20). They do not replace the owner's check against the
 * printed sources, but a typing error in one copy would show here.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const other = JSON.parse(read('tests/fixtures/validation/tables.json')) as {
  radii: Record<string, { periodictable: number; mendeleev: number | null }>;
  wavelengths: Record<Anode, { kAlpha1: number; kAlpha2: number }>;
};
const ours = (
  JSON.parse(read('data/reference/covalent-radii.json')) as { radii: Record<string, number> }
).radii;

/*
 * Cordero et al. give several radii for these four: sp3, sp2 and sp carbon, low- and high-spin
 * Mn, Fe and Co. ASE (the site's copy) and periodictable keep sp3 and low spin; mendeleev keeps
 * sp2 and high spin.
 */
const SEVERAL_VALUES = ['C', 'Mn', 'Fe', 'Co'];

describe('covalent radii (Cordero et al. 2008) against two other transcriptions', () => {
  const symbols = Object.keys(ours);

  it('covers the same 96 elements', () => {
    expect(symbols).toHaveLength(96);
    for (const symbol of symbols) expect(other.radii[symbol], symbol).toBeDefined();
  });

  it('agrees with the periodictable package for every element', () => {
    for (const symbol of symbols)
      expect(ours[symbol], symbol).toBe(other.radii[symbol]?.periodictable);
  });

  it('agrees with the mendeleev package except where the paper gives several values', () => {
    const different = symbols.filter((s) => other.radii[s]?.mendeleev !== ours[s]);
    expect(different).toEqual(SEVERAL_VALUES);
  });
});

describe('K-alpha wavelengths against xraylib', () => {
  /*
   * xraylib's line energies are a different evaluation from Hölzer's and Deslattes's direct
   * measurements. The largest difference is Co K-alpha2, 6.2e-5 Å (0.24 eV); the others are
   * below 4.5e-5 Å. A wrong digit in the fourth decimal would still fail.
   */
  const TOLERANCE = 1e-4;

  it('agrees for each anode within 1e-4 Å', () => {
    for (const anode of Object.keys(ANODES) as Anode[]) {
      expect(
        Math.abs(ANODES[anode].kAlpha1 - other.wavelengths[anode].kAlpha1),
        anode,
      ).toBeLessThan(TOLERANCE);
      expect(
        Math.abs(ANODES[anode].kAlpha2 - other.wavelengths[anode].kAlpha2),
        anode,
      ).toBeLessThan(TOLERANCE);
    }
  });
});

describe('bond-valence source table', () => {
  /*
   * The same text (apart from line endings) is distributed with VESTA and is held in the pparBVM
   * repository; both were compared line by line in November 2026. The hash keeps the copy fixed.
   */
  it('is the file that was compared', () => {
    const sha1 = createHash('sha1')
      .update(readFileSync(join(root, 'data/reference/source/bvparm2020.cif')))
      .digest('hex');
    expect(sha1).toBe('54640352675869efaa9264bb1b9b1cd3c43d03e5');
  });
});
