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

interface PeriodicTableProps {
  selected: readonly string[];
  onToggle: (symbol: string) => void;
  /** Most elements that can be chosen; further ones are disabled. */
  max: number;
}

/**
 * A clickable periodic table (elements that occur in crystal structures, Z = 1 to 103). Each
 * element is a toggle button; the table scrolls sideways inside its box on narrow screens.
 */
export function PeriodicTable({ selected, onToggle, max }: PeriodicTableProps) {
  const full = selected.length >= max;
  return (
    <div class="periodic-scroll">
      <div class="periodic-table" role="group" aria-label="Periodic table">
        {ROWS.flatMap((row, r) =>
          row.length === 0
            ? [<span key={`gap-${r}`} class="periodic-gap" aria-hidden="true" />]
            : row.map((symbol, c) => {
                const key = `${r}-${c}`;
                if (symbol === '.' || symbol.startsWith('*'))
                  return (
                    <span key={key} class="periodic-empty" aria-hidden="true">
                      {symbol === '.' ? '' : symbol}
                    </span>
                  );
                const on = selected.includes(symbol);
                return (
                  <button
                    key={key}
                    type="button"
                    class={`periodic-cell${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => onToggle(symbol)}
                  >
                    {symbol}
                  </button>
                );
              }),
        )}
      </div>
    </div>
  );
}
