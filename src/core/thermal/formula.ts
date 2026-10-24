/** Chemical formulas, molar masses and the theoretical mass loss of a reaction. */

/** Standard atomic weights in g/mol, by element symbol (see data/thermal/atomic-weights.json). */
export type AtomicWeights = Readonly<Record<string, number>>;

export type FormulaResult =
  { ok: true; counts: Record<string, number> } | { ok: false; error: string };

const DIGITS = /^\d+/;
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** Subscript digits (CO₃) are read as ordinary digits. */
function plain(formula: string): string {
  return Array.from(formula, (c) => {
    const i = SUBSCRIPTS.indexOf(c);
    return i === -1 ? c : String(i);
  })
    .join('')
    .replace(/[·∙•*]/g, '.')
    .replace(/\s+/g, '');
}

/**
 * Reads a formula such as "Fe(OH)3", "Cu(NO3)2" or "CuSO4.5H2O" into atom counts. Parentheses
 * and square brackets may be nested; a dot (or ·) starts a hydrate part whose optional leading
 * number multiplies it ("5H2O"). Charges and decimal subscripts are not supported.
 */
export function parseFormula(formula: string): FormulaResult {
  const text = plain(formula);
  if (text === '') return { ok: false, error: 'The formula is empty.' };
  const total: Record<string, number> = {};
  for (const part of splitTopLevel(text)) {
    let multiplier = 1;
    let body = part;
    const lead = DIGITS.exec(part);
    if (lead) {
      multiplier = Number(lead[0]);
      body = part.slice(lead[0].length);
    }
    const parsed = parseGroup(body);
    if (!parsed.ok) return parsed;
    for (const [symbol, n] of Object.entries(parsed.counts)) {
      total[symbol] = (total[symbol] ?? 0) + n * multiplier;
    }
  }
  return { ok: true, counts: total };
}

/** Splits at dots that are not inside brackets (hydrate separators). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '.' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseGroup(text: string): FormulaResult {
  const stack: Record<string, number>[] = [{}];
  let i = 0;
  const add = (target: Record<string, number>, symbol: string, n: number) => {
    target[symbol] = (target[symbol] ?? 0) + n;
  };
  const count = (): number => {
    const m = DIGITS.exec(text.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '(' || c === '[') {
      stack.push({});
      i++;
    } else if (c === ')' || c === ']') {
      i++;
      const inner = stack.pop() as Record<string, number>;
      const outer = stack[stack.length - 1];
      if (!outer) return { ok: false, error: 'The brackets in the formula do not match.' };
      const n = count();
      for (const [symbol, k] of Object.entries(inner)) add(outer, symbol, k * n);
    } else if (/[A-Z]/.test(c)) {
      let symbol = c;
      i++;
      if (/[a-z]/.test(text[i] ?? '')) symbol += text[i++];
      add(stack[stack.length - 1] as Record<string, number>, symbol, count());
    } else {
      return { ok: false, error: `The formula contains "${c}", which is not understood.` };
    }
  }
  if (stack.length !== 1) return { ok: false, error: 'The brackets in the formula do not match.' };
  return { ok: true, counts: stack[0] as Record<string, number> };
}

export type MolarMassResult = { ok: true; gPerMol: number } | { ok: false; error: string };

/** Molar mass M = Σ n_i · A_i in g/mol, with n_i the atoms of element i and A_i its atomic weight. */
export function molarMass(formula: string, weights: AtomicWeights): MolarMassResult {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return parsed;
  let mass = 0;
  for (const [symbol, n] of Object.entries(parsed.counts)) {
    const weight = weights[symbol];
    if (weight === undefined) {
      return { ok: false, error: `No atomic weight is stored for "${symbol}".` };
    }
    mass += n * weight;
  }
  return { ok: true, gPerMol: mass };
}

/** What the user enters: a reactant and a solid product, with how many moles of each take part. */
export interface Reaction {
  precursor: string;
  /** Moles of precursor in the balanced equation. */
  precursorMoles: number;
  /** Formula of the solid left behind. */
  product: string;
  /** Moles of solid product formed per `precursorMoles` of precursor. */
  productMoles: number;
}

export type TheoreticalResult =
  | {
      ok: true;
      precursorGPerMol: number;
      productGPerMol: number;
      /** Mass lost, % of the precursor mass: (ν_p M_p − ν_s M_s) / (ν_p M_p) · 100. */
      lossPct: number;
      /** Mass left, % of the precursor mass. */
      residuePct: number;
    }
  | { ok: false; error: string };

/**
 * Theoretical mass loss of a solid reaction A → ν·B + gas:
 *   loss (%) = (ν_A·M_A − ν_B·M_B) / (ν_A·M_A) · 100
 * with ν the moles in the balanced equation and M the molar mass in g/mol. Everything that
 * leaves the solid (water, CO₂, NOₓ, …) is counted as lost, whatever it is.
 */
export function theoreticalLoss(reaction: Reaction, weights: AtomicWeights): TheoreticalResult {
  const a = molarMass(reaction.precursor, weights);
  if (!a.ok) return a;
  const b = molarMass(reaction.product, weights);
  if (!b.ok) return b;
  if (!(reaction.precursorMoles > 0) || !(reaction.productMoles > 0)) {
    return { ok: false, error: 'The mole numbers must be greater than zero.' };
  }
  const start = reaction.precursorMoles * a.gPerMol;
  const end = reaction.productMoles * b.gPerMol;
  if (end > start) {
    return {
      ok: false,
      error: 'The product is heavier than the precursor, so this reaction cannot lose mass.',
    };
  }
  return {
    ok: true,
    precursorGPerMol: a.gPerMol,
    productGPerMol: b.gPerMol,
    lossPct: ((start - end) / start) * 100,
    residuePct: (end / start) * 100,
  };
}

/** Ready examples. Each is a balanced equation written out in `equation`; the maths is tested by hand. */
export interface ReactionExample {
  id: string;
  label: string;
  equation: string;
  reaction: Reaction;
}

export const REACTION_EXAMPLES: readonly ReactionExample[] = [
  {
    id: 'zn-oh-2',
    label: 'Zn(OH)₂ → ZnO',
    equation: 'Zn(OH)2 → ZnO + H2O',
    reaction: { precursor: 'Zn(OH)2', precursorMoles: 1, product: 'ZnO', productMoles: 1 },
  },
  {
    id: 'fe-oh-3',
    label: '2 Fe(OH)₃ → Fe₂O₃',
    equation: '2 Fe(OH)3 → Fe2O3 + 3 H2O',
    reaction: { precursor: 'Fe(OH)3', precursorMoles: 2, product: 'Fe2O3', productMoles: 1 },
  },
  {
    id: 'caco3',
    label: 'CaCO₃ → CaO',
    equation: 'CaCO3 → CaO + CO2',
    reaction: { precursor: 'CaCO3', precursorMoles: 1, product: 'CaO', productMoles: 1 },
  },
  {
    id: 'cu-no3-2',
    label: 'Cu(NO₃)₂·3H₂O → CuO',
    equation: 'Cu(NO3)2·3H2O → CuO + gases (H2O, NO2, O2)',
    reaction: {
      precursor: 'Cu(NO3)2.3H2O',
      precursorMoles: 1,
      product: 'CuO',
      productMoles: 1,
    },
  },
  {
    id: 'cuso4-5h2o',
    label: 'CuSO₄·5H₂O → CuSO₄ (all water)',
    equation: 'CuSO4·5H2O → CuSO4 + 5 H2O',
    reaction: { precursor: 'CuSO4.5H2O', precursorMoles: 1, product: 'CuSO4', productMoles: 1 },
  },
];
