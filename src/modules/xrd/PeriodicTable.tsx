import { useState } from 'preact/hooks';
import {
  CATEGORIES,
  ELEMENT_BY_SYMBOL,
  type ElementCategory,
  type ElementInfo,
} from '../../core/elements';
import { ATOMIC_WEIGHTS } from './atomicWeights';

/**
 * Rows of the periodic table, 18 columns each: '.' is an empty cell, '*' and '**' mark where the
 * f-block rows belong, and an empty row is the gap above them.
 */
const ROWS: readonly (readonly string[])[] = [
  'H . . . . . . . . . . . . . . . . He',
  'Li Be . . . . . . . . . . B C N O F Ne',
  'Na Mg . . . . . . . . . . Al Si P S Cl Ar',
  'K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr',
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe',
  'Cs Ba * Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn',
  'Fr Ra ** . . . . . . . . . . . . . . .',
  '',
  '. . * La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu',
  '. . ** Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr',
].map((row) => (row ? row.split(' ') : []));

interface Cell {
  element: ElementInfo;
  row: number;
  column: number;
  period: number;
  /** Group 1–18, or null for the f-block rows. */
  group: number | null;
}

const CELLS: readonly Cell[] = ROWS.flatMap((row, r) =>
  row.flatMap((symbol, c) => {
    const element = ELEMENT_BY_SYMBOL.get(symbol);
    if (!element) return [];
    const fBlock = r >= 8;
    return [
      {
        element,
        row: r + 1,
        column: c + 1,
        period: fBlock ? r - 2 : r + 1,
        group: fBlock ? null : c + 1,
      },
    ];
  }),
);

/** Markers in the main table for where the f-block rows belong. */
const MARKERS = ROWS.flatMap((row, r) =>
  row.flatMap((symbol, c) =>
    symbol.startsWith('*') ? [{ symbol, row: r + 1, column: c + 1 }] : [],
  ),
);

const blockOf = (cell: Cell) =>
  cell.group === null
    ? 'f'
    : cell.group <= 2 || cell.element.z === 2
      ? 's'
      : cell.group >= 13
        ? 'p'
        : 'd';

const categoryClass = (category: ElementCategory) => `cat-${category.replace(/ /g, '-')}`;

interface PeriodicTableProps {
  selected: readonly string[];
  onToggle: (symbol: string) => void;
  /** Most elements that can be chosen; further ones are disabled. */
  max: number;
}

/**
 * A clickable periodic table (Z = 1 to 103), coloured by element category. Pointing at or
 * focusing an element shows its details in the panel inside the table. Each element is a toggle
 * button; the table scrolls sideways inside its box on narrow screens.
 */
export function PeriodicTable({ selected, onToggle, max }: PeriodicTableProps) {
  const [active, setActive] = useState<Cell | null>(null);
  const full = selected.length >= max;
  return (
    <div class="periodic">
      <div class="periodic-scroll">
        <div class="periodic-table" role="group" aria-label="Periodic table">
          <ElementPanel cell={active} />
          {MARKERS.map((m) => (
            <span
              key={`${m.row}-${m.column}`}
              class="periodic-empty"
              style={{ gridRow: m.row, gridColumn: m.column }}
              aria-hidden="true"
            >
              {m.symbol}
            </span>
          ))}
          {CELLS.map((cell) => {
            const { element } = cell;
            const on = selected.includes(element.symbol);
            return (
              <button
                key={element.symbol}
                type="button"
                class={`periodic-cell ${categoryClass(element.category)}${on ? ' is-on' : ''}`}
                style={{ gridRow: cell.row, gridColumn: cell.column }}
                aria-pressed={on}
                aria-label={`${element.symbol}, ${element.name}, ${element.category}`}
                disabled={!on && full}
                onClick={() => onToggle(element.symbol)}
                onMouseEnter={() => setActive(cell)}
                onFocus={() => setActive(cell)}
                onMouseLeave={() => setActive((a) => (a === cell ? null : a))}
              >
                <span class="periodic-z" aria-hidden="true">
                  {element.z}
                </span>
                <span class="periodic-symbol" aria-hidden="true">
                  {element.symbol}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <ul class="periodic-legend" aria-label="Element categories">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <span class={`periodic-swatch ${categoryClass(c)}`} aria-hidden="true" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Details of the element pointed at, shown in the empty space above the transition metals. Hidden
 * from screen readers, which hear the same from each button's label.
 */
function ElementPanel({ cell }: { cell: Cell | null }) {
  if (!cell)
    return (
      <div class="periodic-info is-empty" aria-hidden="true">
        Point at an element to see its details. Click elements to search for phases made of them.
      </div>
    );
  const { element } = cell;
  const weight = ATOMIC_WEIGHTS[element.symbol];
  return (
    <div class={`periodic-info ${categoryClass(element.category)}`} aria-hidden="true">
      <span class="periodic-info-symbol">{element.symbol}</span>
      <span class="periodic-info-text">
        <strong>{element.name[0]?.toUpperCase() + element.name.slice(1)}</strong>, Z = {element.z}
        <br />
        {element.category} · period {cell.period}
        {cell.group !== null && `, group ${cell.group}`} · {blockOf(cell)}-block
        <br />
        {weight !== undefined
          ? `Standard atomic weight ${weight} g/mol (CIAAW 2024)`
          : 'No standard atomic weight (no stable isotopes)'}
      </span>
    </div>
  );
}
