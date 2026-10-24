/*
 * Molar mass from a chemical formula and the theoretical mass loss of a reaction.
 * Atomic weights come from data/thermal/atomic-weights.json (CIAAW abridged table, g/mol).
 */

export type AtomicWeights = Readonly<Record<string, { weight: number }>>;

/** Counts of each element in a formula, for example Mg(OH)2 gives { Mg: 1, O: 2, H: 2 }. */
export type Composition = Record<string, number>;

export type FormulaResult = { ok: true; composition: Composition } | { ok: false; error: string };

const fail = (error: string): FormulaResult => ({ ok: false, error });

/**
 * Reads a formula such as Ca(OH)2, CaC2O4·H2O, Cu(NO3)2.3H2O or Al2(SO4)3*18H2O.
 * Supported: element symbols with counts, round or square brackets with a count, and hydrate
 * parts after "·", "*", "." or "•" with an optional leading number (3H2O means three waters).
 * Charges, isotopes and decimal counts are not supported.
 */
export function parseFormula(text: string, weights: AtomicWeights): FormulaResult {
  const clean = text.replace(/\s+/g, '').replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080));
  if (clean === '') return fail('Type a formula, for example Mg(OH)2.');
  const total: Composition = {};
  for (const part of clean.split(/[·*•.]/)) {
    if (part === '') return fail(`The formula "${text}" has an empty part.`);
    const lead = /^(\d+)(.*)$/.exec(part);
    const multiplier = lead ? Number(lead[1]) : 1;
    const body = lead ? (lead[2] as string) : part;
    const parsed = parseGroup(body, weights);
    if (typeof parsed === 'string') return fail(parsed);
    for (const [element, count] of Object.entries(parsed)) {
      total[element] = (total[element] ?? 0) + count * multiplier;
    }
  }
  return { ok: true, composition: total };
}

function parseGroup(body: string, weights: AtomicWeights): Composition | string {
  const stack: Composition[] = [{}];
  let i = 0;
  const readCount = (): number => {
    const m = /^\d+/.exec(body.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };
  while (i < body.length) {
    const ch = body[i] as string;
    const top = stack[stack.length - 1] as Composition;
    if (ch === '(' || ch === '[') {
      stack.push({});
      i++;
    } else if (ch === ')' || ch === ']') {
      if (stack.length < 2)
        return `The formula "${body}" has a closing bracket without an opening one.`;
      i++;
      const count = readCount();
      const closed = stack.pop() as Composition;
      const outer = stack[stack.length - 1] as Composition;
      for (const [element, n] of Object.entries(closed))
        outer[element] = (outer[element] ?? 0) + n * count;
    } else {
      const m = /^[A-Z][a-z]?/.exec(body.slice(i));
      if (!m) return `"${ch}" in the formula "${body}" is not an element symbol.`;
      // Two-letter symbols are tried first, then one letter (so CO is C and O, not Co).
      let symbol = m[0];
      if (!(symbol in weights)) symbol = symbol.slice(0, 1);
      if (!(symbol in weights)) return `"${m[0]}" is not an element in the atomic weight table.`;
      i += symbol.length;
      top[symbol] = (top[symbol] ?? 0) + readCount();
    }
  }
  if (stack.length > 1) return `The formula "${body}" has a bracket that is not closed.`;
  return stack[0] as Composition;
}

/**
 * Molar mass M = Σ n_i · A_i in g/mol, with n_i the count of element i and A_i its atomic
 * weight (g/mol).
 */
export function molarMass(composition: Composition, weights: AtomicWeights): number {
  let mass = 0;
  for (const [element, n] of Object.entries(composition))
    mass += n * (weights[element]?.weight ?? NaN);
  return mass;
}

/** A reaction written as precursor → ν · product (+ gases that leave the sample). */
export interface Reaction {
  precursor: string;
  product: string;
  /** Moles of solid product per mole of precursor, ν (for 2 Al(OH)3 → Al2O3 + 3 H2O this is 0.5). */
  coefficient: number;
}

export interface TheoreticalLoss {
  precursorMass: number;
  productMass: number;
  /** Mass lost, % of the precursor mass: 100 · (M_pre − ν · M_prod) / M_pre. */
  lossPct: number;
  /** Solid residue, % of the precursor mass. */
  residuePct: number;
}

/**
 * Theoretical mass loss of a reaction: 100 · (M_precursor − ν · M_product) / M_precursor, where
 * M is the molar mass in g/mol and ν the moles of solid product per mole of precursor.
 * Gives an error message when a formula cannot be read or ν is not a positive number.
 */
export function theoreticalLoss(
  reaction: Reaction,
  weights: AtomicWeights,
): { ok: true; value: TheoreticalLoss } | { ok: false; error: string } {
  if (!(reaction.coefficient > 0) || !Number.isFinite(reaction.coefficient)) {
    return { ok: false, error: 'The amount of product per precursor must be a number above zero.' };
  }
  const pre = parseFormula(reaction.precursor, weights);
  if (!pre.ok) return pre;
  const prod = parseFormula(reaction.product, weights);
  if (!prod.ok) return prod;
  const precursorMass = molarMass(pre.composition, weights);
  const productMass = molarMass(prod.composition, weights);
  const residuePct = (100 * reaction.coefficient * productMass) / precursorMass;
  return { ok: true, value: { precursorMass, productMass, lossPct: 100 - residuePct, residuePct } };
}

/** Ready examples for the dropdown. Each is a plain textbook-type reaction; the numbers follow from the formulas. */
export const REACTION_EXAMPLES: readonly (Reaction & { label: string })[] = [
  { label: 'Mg(OH)2 → MgO + H2O', precursor: 'Mg(OH)2', product: 'MgO', coefficient: 1 },
  { label: 'Ca(OH)2 → CaO + H2O', precursor: 'Ca(OH)2', product: 'CaO', coefficient: 1 },
  { label: 'CaCO3 → CaO + CO2', precursor: 'CaCO3', product: 'CaO', coefficient: 1 },
  { label: 'Zn(OH)2 → ZnO + H2O', precursor: 'Zn(OH)2', product: 'ZnO', coefficient: 1 },
  { label: '2 Al(OH)3 → Al2O3 + 3 H2O', precursor: 'Al(OH)3', product: 'Al2O3', coefficient: 0.5 },
  {
    label: 'CaC2O4·H2O → CaC2O4 + H2O',
    precursor: 'CaC2O4·H2O',
    product: 'CaC2O4',
    coefficient: 1,
  },
  {
    label: 'Cu(NO3)2·3H2O → CuO + gases',
    precursor: 'Cu(NO3)2·3H2O',
    product: 'CuO',
    coefficient: 1,
  },
];
