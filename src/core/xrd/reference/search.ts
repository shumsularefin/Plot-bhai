/*
 * Phase search over the reference library index, in the style of the Materials Project search
 * box: one text field that understands a chemical formula, a chemical system, element symbols,
 * a name or mineral, a COD ID or a space group.
 */

import type { ReferenceIndexEntry, ReferenceIndexPhase } from './types.ts';

/** Element symbols of the periodic table (Z = 1 to 118), used to tell formulas from words. */
const ELEMENTS = new Set(
  (
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se ' +
    'Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb ' +
    'Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm ' +
    'Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
  ).split(' '),
);

/**
 * Element counts of a formula such as "BiVO4", "Ni(OH)2" or "Fe2.5O4" (brackets may nest).
 * Returns null when the text is not a formula made of real element symbols.
 */
export function parseFormula(text: string): Record<string, number> | null {
  const source = text.replace(/\s+/g, '');
  if (!/^[A-Z]/.test(source)) return null;
  let i = 0;
  const group = (): Record<string, number> | null => {
    const counts: Record<string, number> = {};
    while (i < source.length && source[i] !== ')') {
      let part: Record<string, number> | null;
      if (source[i] === '(') {
        i++;
        part = group();
        if (part === null || source[i] !== ')') return null;
        i++;
      } else {
        const m = /^([A-Z][a-z]?)/.exec(source.slice(i));
        if (!m || !ELEMENTS.has(m[1] as string)) return null;
        part = { [m[1] as string]: 1 };
        i += (m[1] as string).length;
      }
      const n = /^(\d+(?:\.\d+)?)/.exec(source.slice(i));
      const times = n ? Number(n[1]) : 1;
      if (n) i += (n[1] as string).length;
      for (const [el, c] of Object.entries(part)) counts[el] = (counts[el] ?? 0) + c * times;
    }
    return counts;
  };
  const counts = group();
  return counts && i === source.length && Object.keys(counts).length > 0 ? counts : null;
}

/**
 * Hill-order formula with spaces, as COD stores and searches formulas ("Bi O4 V"): carbon first
 * and hydrogen second when there is carbon, all other elements alphabetically; a count of 1 is
 * left out.
 */
export function hillFormula(counts: Record<string, number>): string {
  const rank = (e: string) => (counts['C'] !== undefined ? (e === 'C' ? 0 : e === 'H' ? 1 : 2) : 2);
  return Object.keys(counts)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((e) => `${e}${counts[e] === 1 ? '' : Number((counts[e] as number).toFixed(3))}`)
    .join(' ');
}

/** Atom fractions rounded to 3 decimals, as a key: equal for BiVO4 and Bi2V2O8, any order. */
export function compositionKey(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return Object.keys(counts)
    .sort()
    .map((el) => `${el}${((counts[el] as number) / total).toFixed(3)}`)
    .join(' ');
}

/** What a search text was understood as. */
export type PhaseQuery =
  | { kind: 'all' }
  | { kind: 'codId'; codId: number }
  | { kind: 'spaceGroupNumber'; number: number }
  | { kind: 'spaceGroupSymbol'; symbol: string }
  /** Exactly these elements, written "Bi-V-O" as in the Materials Project. */
  | { kind: 'chemicalSystem'; elements: string[] }
  /** Phases containing all of these elements, written "Bi V" or "Bi, V". */
  | { kind: 'elements'; elements: string[] }
  | { kind: 'formula'; key: string; formula: string }
  | { kind: 'text'; text: string };

/** Lower-case text without spaces, hyphens, brackets and accents. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-_()[\],.]/g, '');
}

const symbolKey = (symbol: string) =>
  symbol.replace(/:.*$/, '').replace(/[\s_]/g, '').toLowerCase();

/** Reads a search text. */
export function parseQuery(input: string): PhaseQuery {
  const text = input.trim();
  if (text === '') return { kind: 'all' };
  const cod = /^(?:cod\s*)?(\d{7})$/i.exec(text);
  if (cod) return { kind: 'codId', codId: Number(cod[1]) };
  const sgNumber = /^(?:sg|space\s*group)?\s*#?\s*(\d{1,3})$/i.exec(text);
  if (sgNumber && Number(sgNumber[1]) >= 1 && Number(sgNumber[1]) <= 230)
    return { kind: 'spaceGroupNumber', number: Number(sgNumber[1]) };
  const tokens = text.split(/\s*[-,\s]\s*/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => ELEMENTS.has(t))) {
    const elements = [...new Set(tokens)].sort();
    return /^[A-Z][a-z]?(\s*-\s*[A-Z][a-z]?)+$/.test(text)
      ? { kind: 'chemicalSystem', elements }
      : { kind: 'elements', elements };
  }
  if (/^[PIFCABR]\s*[-\d/a-z]/.test(text) && /\d/.test(text) && /[/\-a-z]|\d{2}/.test(text)) {
    // Hermann–Mauguin symbols such as P21/c, Fm-3m, I41/amd, R-3c.
    const asFormula = parseFormula(text);
    if (!asFormula) return { kind: 'spaceGroupSymbol', symbol: symbolKey(text) };
  }
  const counts = parseFormula(text);
  if (counts) {
    const elements = Object.keys(counts);
    // A lone element symbol finds every phase that contains it, not only the pure element.
    if (elements.length === 1 && counts[elements[0] as string] === 1 && /^[A-Z][a-z]?$/.test(text))
      return { kind: 'elements', elements };
    return { kind: 'formula', key: compositionKey(counts), formula: text.replace(/\s+/g, '') };
  }
  return { kind: 'text', text: normaliseText(text) };
}

/** One search hit: a library phase, its family, and how well it matched (0 is best). */
export interface PhaseHit {
  family: ReferenceIndexEntry;
  phase: ReferenceIndexPhase;
  rank: number;
}

/** Plain-language description of how a query was read, for the line under the search box. */
export function describeQuery(query: PhaseQuery): string {
  switch (query.kind) {
    case 'all':
      return 'Showing every phase in the library.';
    case 'codId':
      return `Looking for COD entry ${query.codId}.`;
    case 'spaceGroupNumber':
      return `Looking for space group number ${query.number}.`;
    case 'spaceGroupSymbol':
      return 'Looking for that space-group symbol.';
    case 'chemicalSystem':
      return `Phases made of exactly ${query.elements.join(', ')}.`;
    case 'elements':
      return `Phases that contain ${query.elements.join(' and ')}.`;
    case 'formula':
      return `Phases with the composition ${query.formula} (any order of elements).`;
    case 'text':
      return 'Matching names, minerals and other names.';
  }
}

/**
 * Library phases that match a search text, best first. Formula and element searches compare
 * compositions, so "VBiO4" finds BiVO4; text searches look at phase names, family names and
 * family aliases (names that start with the text rank above those that contain it).
 */
export function searchPhases(families: readonly ReferenceIndexEntry[], input: string): PhaseHit[] {
  const query = parseQuery(input);
  const hits: PhaseHit[] = [];
  for (const family of families) {
    for (const phase of family.phases) {
      const rank = rankPhase(query, family, phase);
      if (rank !== null) hits.push({ family, phase, rank });
    }
  }
  return hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.family.name.localeCompare(b.family.name) ||
      a.phase.name.localeCompare(b.phase.name),
  );
}

function rankPhase(
  query: PhaseQuery,
  family: ReferenceIndexEntry,
  phase: ReferenceIndexPhase,
): number | null {
  const elements = phase.elements ?? [];
  switch (query.kind) {
    case 'all':
      return 0;
    case 'codId':
      return phase.codId === query.codId ? 0 : null;
    case 'spaceGroupNumber':
      return phase.spaceGroupNumber === query.number ? 0 : null;
    case 'spaceGroupSymbol':
      return symbolKey(phase.spaceGroup) === query.symbol ? 0 : null;
    case 'chemicalSystem':
      return elements.length === query.elements.length &&
        query.elements.every((e) => elements.includes(e))
        ? 0
        : null;
    case 'elements':
      if (!query.elements.every((e) => elements.includes(e))) return null;
      return elements.length - query.elements.length;
    case 'formula': {
      const counts = parseFormula(phase.formula);
      if (counts && compositionKey(counts) === query.key) return 0;
      // Fall back to names, so a formula-like word still finds something sensible.
      return textRank(normaliseText(query.formula), family, phase);
    }
    case 'text':
      return textRank(query.text, family, phase);
  }
}

function textRank(
  q: string,
  family: ReferenceIndexEntry,
  phase: ReferenceIndexPhase,
): number | null {
  const own = [phase.name, phase.formula].map(normaliseText);
  const shared = [family.name, family.formula, ...family.aliases].map(normaliseText);
  let rank: number | null = null;
  const better = (r: number) => (rank = rank === null ? r : Math.min(rank, r));
  for (const term of own) {
    if (term === q) better(1);
    else if (term.startsWith(q)) better(2);
    else if (term.includes(q)) better(3);
  }
  for (const term of shared) {
    if (term === q) better(4);
    else if (term.startsWith(q)) better(5);
    else if (term.includes(q)) better(6);
  }
  return rank;
}
