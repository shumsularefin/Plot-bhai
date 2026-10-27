// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compositionKey,
  parseFormula,
  parseQuery,
  searchPhases,
} from '../src/core/xrd/reference/search';
import type { ReferenceIndex } from '../src/core/xrd/reference/types';

const index = JSON.parse(
  readFileSync(new URL('./fixtures/cod-reference/index.json', import.meta.url), 'utf8'),
) as ReferenceIndex;
const ids = (query: string) => searchPhases(index.families, query).map((h) => h.phase.id);

describe('formula parsing', () => {
  it('reads plain, bracketed and decimal formulas, and refuses words', () => {
    expect(parseFormula('BiVO4')).toEqual({ Bi: 1, V: 1, O: 4 });
    expect(parseFormula('Ni(OH)2')).toEqual({ Ni: 1, O: 2, H: 2 });
    expect(parseFormula('Ca10(PO4)6(OH)2')).toEqual({ Ca: 10, P: 6, O: 26, H: 2 });
    expect(parseFormula('Fe2.67O4')).toEqual({ Fe: 2.67, O: 4 });
    expect(parseFormula('anatase')).toBeNull();
    expect(parseFormula('Xx2O')).toBeNull();
    expect(parseFormula('Ni(OH')).toBeNull();
  });

  it('compares compositions independent of order and multiples', () => {
    const key = (f: string) => compositionKey(parseFormula(f) as Record<string, number>);
    expect(key('BiVO4')).toBe(key('VBiO4'));
    expect(key('BiVO4')).toBe(key('Bi2V2O8'));
    expect(key('FeOOH')).toBe(key('FeO2H'));
    expect(key('Fe2O3')).not.toBe(key('Fe3O4'));
  });
});

describe('query reading', () => {
  it('tells formulas, systems, elements, IDs, space groups and names apart', () => {
    expect(parseQuery('')).toEqual({ kind: 'all' });
    expect(parseQuery('9011741')).toEqual({ kind: 'codId', codId: 9011741 });
    expect(parseQuery('COD 9011741')).toEqual({ kind: 'codId', codId: 9011741 });
    expect(parseQuery('141')).toEqual({ kind: 'spaceGroupNumber', number: 141 });
    expect(parseQuery('Bi-V-O')).toEqual({ kind: 'chemicalSystem', elements: ['Bi', 'O', 'V'] });
    expect(parseQuery('Bi V')).toEqual({ kind: 'elements', elements: ['Bi', 'V'] });
    expect(parseQuery('Bi')).toEqual({ kind: 'elements', elements: ['Bi'] });
    expect(parseQuery('P21/c')).toMatchObject({ kind: 'spaceGroupSymbol' });
    expect(parseQuery('Fm-3m')).toMatchObject({ kind: 'spaceGroupSymbol' });
    expect(parseQuery('TiO2')).toMatchObject({ kind: 'formula' });
    expect(parseQuery('Pt')).toEqual({ kind: 'elements', elements: ['Pt'] });
    expect(parseQuery('titania')).toEqual({ kind: 'text', text: 'titania' });
  });
});

describe('library search', () => {
  it('finds every TiO2 polymorph by formula, and only those', () => {
    expect(ids('TiO2').sort()).toEqual(['anatase', 'brookite', 'rutile']);
    expect(ids('O2Ti').sort()).toEqual(['anatase', 'brookite', 'rutile']);
  });

  it('finds an exact chemical system, and phases containing elements', () => {
    expect(ids('Bi-O').sort()).toEqual(['bismite', 'sphaerobismoite']);
    const withBi = ids('Bi');
    expect(withBi).toEqual(expect.arrayContaining(['bismite', 'dreyerite', 'russellite']));
    // The fewest extra elements come first.
    expect(withBi.indexOf('bismite')).toBeLessThan(withBi.indexOf('russellite'));
  });

  it('finds a COD ID, a space-group number and symbol, and names', () => {
    expect(ids('9011741')).toEqual(['dreyerite']);
    expect(ids('136')).toEqual(expect.arrayContaining(['rutile', 'sno2', 'pyrolusite']));
    expect(ids('I41/amd')).toEqual(expect.arrayContaining(['anatase', 'dreyerite', 'hausmannite']));
    expect(ids('anatase')[0]).toBe('anatase');
    expect(ids('titania')).toEqual(expect.arrayContaining(['anatase', 'rutile', 'brookite']));
    expect(ids('unobtainium')).toEqual([]);
  });
});
