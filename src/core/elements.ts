/*
 * The chemical elements Z = 1 to 103 with their English names (IUPAC spelling, as in the CIAAW
 * table in data/thermal/atomic-weights.json) and a conventional category for colouring a periodic
 * table. The categories follow the usual metal / metalloid / nonmetal grouping; borderline
 * elements are placed differently in different tables (here: B, Si, Ge, As, Sb and Te are
 * metalloids, Po is a post-transition metal, Zn, Cd and Hg are transition metals, and La to Lu
 * and Ac to Lr are lanthanides and actinides). Flagged for the owner's check.
 */

export type ElementCategory =
  | 'alkali metal'
  | 'alkaline earth metal'
  | 'transition metal'
  | 'post-transition metal'
  | 'lanthanide'
  | 'actinide'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble gas';

export interface ElementInfo {
  z: number;
  symbol: string;
  name: string;
  category: ElementCategory;
}

const A: ElementCategory = 'alkali metal';
const E: ElementCategory = 'alkaline earth metal';
const T: ElementCategory = 'transition metal';
const P: ElementCategory = 'post-transition metal';
const L: ElementCategory = 'lanthanide';
const C: ElementCategory = 'actinide';
const M: ElementCategory = 'metalloid';
const N: ElementCategory = 'nonmetal';
const H: ElementCategory = 'halogen';
const G: ElementCategory = 'noble gas';

/** [symbol, name, category] in order of atomic number. */
const LIST: readonly (readonly [string, string, ElementCategory])[] = [
  ['H', 'hydrogen', N],
  ['He', 'helium', G],
  ['Li', 'lithium', A],
  ['Be', 'beryllium', E],
  ['B', 'boron', M],
  ['C', 'carbon', N],
  ['N', 'nitrogen', N],
  ['O', 'oxygen', N],
  ['F', 'fluorine', H],
  ['Ne', 'neon', G],
  ['Na', 'sodium', A],
  ['Mg', 'magnesium', E],
  ['Al', 'aluminium', P],
  ['Si', 'silicon', M],
  ['P', 'phosphorus', N],
  ['S', 'sulfur', N],
  ['Cl', 'chlorine', H],
  ['Ar', 'argon', G],
  ['K', 'potassium', A],
  ['Ca', 'calcium', E],
  ['Sc', 'scandium', T],
  ['Ti', 'titanium', T],
  ['V', 'vanadium', T],
  ['Cr', 'chromium', T],
  ['Mn', 'manganese', T],
  ['Fe', 'iron', T],
  ['Co', 'cobalt', T],
  ['Ni', 'nickel', T],
  ['Cu', 'copper', T],
  ['Zn', 'zinc', T],
  ['Ga', 'gallium', P],
  ['Ge', 'germanium', M],
  ['As', 'arsenic', M],
  ['Se', 'selenium', N],
  ['Br', 'bromine', H],
  ['Kr', 'krypton', G],
  ['Rb', 'rubidium', A],
  ['Sr', 'strontium', E],
  ['Y', 'yttrium', T],
  ['Zr', 'zirconium', T],
  ['Nb', 'niobium', T],
  ['Mo', 'molybdenum', T],
  ['Tc', 'technetium', T],
  ['Ru', 'ruthenium', T],
  ['Rh', 'rhodium', T],
  ['Pd', 'palladium', T],
  ['Ag', 'silver', T],
  ['Cd', 'cadmium', T],
  ['In', 'indium', P],
  ['Sn', 'tin', P],
  ['Sb', 'antimony', M],
  ['Te', 'tellurium', M],
  ['I', 'iodine', H],
  ['Xe', 'xenon', G],
  ['Cs', 'caesium', A],
  ['Ba', 'barium', E],
  ['La', 'lanthanum', L],
  ['Ce', 'cerium', L],
  ['Pr', 'praseodymium', L],
  ['Nd', 'neodymium', L],
  ['Pm', 'promethium', L],
  ['Sm', 'samarium', L],
  ['Eu', 'europium', L],
  ['Gd', 'gadolinium', L],
  ['Tb', 'terbium', L],
  ['Dy', 'dysprosium', L],
  ['Ho', 'holmium', L],
  ['Er', 'erbium', L],
  ['Tm', 'thulium', L],
  ['Yb', 'ytterbium', L],
  ['Lu', 'lutetium', L],
  ['Hf', 'hafnium', T],
  ['Ta', 'tantalum', T],
  ['W', 'tungsten', T],
  ['Re', 'rhenium', T],
  ['Os', 'osmium', T],
  ['Ir', 'iridium', T],
  ['Pt', 'platinum', T],
  ['Au', 'gold', T],
  ['Hg', 'mercury', T],
  ['Tl', 'thallium', P],
  ['Pb', 'lead', P],
  ['Bi', 'bismuth', P],
  ['Po', 'polonium', P],
  ['At', 'astatine', H],
  ['Rn', 'radon', G],
  ['Fr', 'francium', A],
  ['Ra', 'radium', E],
  ['Ac', 'actinium', C],
  ['Th', 'thorium', C],
  ['Pa', 'protactinium', C],
  ['U', 'uranium', C],
  ['Np', 'neptunium', C],
  ['Pu', 'plutonium', C],
  ['Am', 'americium', C],
  ['Cm', 'curium', C],
  ['Bk', 'berkelium', C],
  ['Cf', 'californium', C],
  ['Es', 'einsteinium', C],
  ['Fm', 'fermium', C],
  ['Md', 'mendelevium', C],
  ['No', 'nobelium', C],
  ['Lr', 'lawrencium', C],
];

export const ELEMENTS: readonly ElementInfo[] = LIST.map(([symbol, name, category], i) => ({
  z: i + 1,
  symbol,
  name,
  category,
}));

export const ELEMENT_BY_SYMBOL: ReadonlyMap<string, ElementInfo> = new Map(
  ELEMENTS.map((e) => [e.symbol, e]),
);

/** Categories in the order a legend lists them. */
export const CATEGORIES: readonly ElementCategory[] = [A, E, T, P, L, C, M, N, H, G];
