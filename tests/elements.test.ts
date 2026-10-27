// @vitest-environment node
import { describe, expect, it } from 'vitest';
import weights from '../data/thermal/atomic-weights.json';
import { ELEMENTS } from '../src/core/elements';

describe('element table', () => {
  it('has Z 1 to 103 with unique symbols', () => {
    expect(ELEMENTS).toHaveLength(103);
    expect(ELEMENTS.map((e) => e.z)).toEqual(Array.from({ length: 103 }, (_, i) => i + 1));
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(103);
  });

  it('agrees with the CIAAW atomic-weight table on Z, symbol and name', () => {
    for (const w of weights.elements) {
      const e = ELEMENTS[w.z - 1];
      expect({ symbol: e?.symbol, name: e?.name }).toEqual({ symbol: w.symbol, name: w.name });
    }
  });
});
