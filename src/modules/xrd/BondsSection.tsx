import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RietveldPhaseResult, RietveldResult } from '../../core/xrd/rietveld/refine';
import { withUncertainty } from '../../core/xrd/rietveld/report';
import {
  covalentLimit,
  findAngles,
  findBonds,
  type Bond,
  type StructureGeometry,
} from '../../core/xrd/structure/bonds';
import {
  bondValenceSums,
  offeredStates,
  suggestStates,
  type BondValenceFile,
} from '../../core/xrd/structure/bondValence';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import { DEFAULT_BONDS } from './bondsReport';
import { downloadCsv } from './csv';
import type { BondSettings, RietveldState } from './data';
import { TableBox } from './MethodDetails';
import { NumberInput } from './NumberInput';

interface Tables {
  bondValence: BondValenceFile;
  /** Covalent radii (Å) by element. */
  radii: Record<string, number>;
}

/** The bond-valence table (about 10 KB gzipped) and the radii, loaded when this section shows. */
let tablesLoad: Promise<Tables> | null = null;
const loadTables = () =>
  (tablesLoad ??= Promise.all([
    import('../../../data/reference/bond-valence.json'),
    import('../../../data/reference/covalent-radii.json'),
  ]).then(([bv, covalent]) => ({
    bondValence: bv.default as unknown as BondValenceFile,
    radii: (covalent.default as { radii: Record<string, number> }).radii,
  })));

const signed = (state: number) => `${Math.abs(state)}${state > 0 ? '+' : '−'}`;
const atom = (geometry: StructureGeometry, i: number) => geometry.atoms[i]?.label ?? '?';
const target = (geometry: StructureGeometry, bond: Bond) =>
  bond.symmetry === '.' ? atom(geometry, bond.to) : `${atom(geometry, bond.to)} [${bond.symmetry}]`;

interface BondsSectionProps {
  result: RietveldResult;
  name: string;
  settings: RietveldState;
  set: (patch: Partial<RietveldState>) => void;
}

/**
 * Bond lengths, bond angles and bond-valence sums of every refined structure (Rietveld step,
 * Advanced), with standard uncertainties from the covariance of the refinement.
 */
export function BondsSection({ result, name, settings, set }: BondsSectionProps) {
  const bonds = settings.bonds ?? DEFAULT_BONDS;
  const setBonds = (patch: Partial<BondSettings>) => set({ bonds: { ...bonds, ...patch } });
  const [tables, setTables] = useState<Tables | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadTables().then(
      (t) => live && setTables(t),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const phases = result.phases.filter(
    (p): p is RietveldPhaseResult & { geometry: StructureGeometry } => !!p.geometry,
  );
  if (phases.length === 0) return null;

  return (
    <Advanced id="rietveld-bonds" title="Bond lengths, angles and bond-valence sums">
      <p class="field-hint">
        Distances and angles between bonded atoms of each refined structure, with standard
        uncertainties from the refinement, and the bond-valence sum of every site.{' '}
        <HelpTip term="bond-valence sum">
          <p>
            Each bond between a cation and an anion carries a valence s = exp((R₀ − R)/b), where R
            is the bond length and R₀ and b are tabulated for the pair of ions (Brown and Altermatt,
            1985). Summed over the bonds of a site, it should be close to the size of the site’s
            oxidation state: for Zr⁴⁺ about 4. A sum far from it suggests a wrong oxidation state,
            an under- or overbonded site, or atom positions the data do not fix well.
          </p>
        </HelpTip>
      </p>
      <NumberInput
        label="Bond tolerance (Å)"
        value={bonds.tolerance}
        min={0}
        max={1.5}
        step={0.05}
        onChange={(v) => v !== null && setBonds({ tolerance: v })}
        help={
          <HelpTip term="bond tolerance">
            <p>
              Two atoms count as bonded when they are closer than the sum of their covalent radii
              (Cordero et al., 2008) plus this value. 0.45 Å is the usual choice in structure
              viewers. Raise it to include longer contacts.
            </p>
          </HelpTip>
        }
      />
      {phases.map((phase) => (
        <PhaseBonds
          key={phase.id}
          phase={phase}
          name={name}
          tolerance={bonds.tolerance}
          tables={tables}
          failed={failed}
          chosen={bonds.states[phase.id] ?? {}}
          choose={(element, state) =>
            setBonds({
              states: {
                ...bonds.states,
                [phase.id]: { ...bonds.states[phase.id], [element]: state },
              },
            })
          }
        />
      ))}
    </Advanced>
  );
}

interface PhaseBondsProps {
  phase: RietveldPhaseResult & { geometry: StructureGeometry };
  name: string;
  tolerance: number;
  tables: Tables | null;
  failed: boolean;
  chosen: Record<string, number | null>;
  choose: (element: string, state: number | null) => void;
}

function PhaseBonds({ phase, name, tolerance, tables, failed, chosen, choose }: PhaseBondsProps) {
  const { geometry } = phase;
  const table = tables?.bondValence ?? null;
  const radii = tables?.radii;
  const found = useMemo(() => {
    if (!radii) return { bonds: [], angles: [] };
    const bonds = findBonds(geometry, covalentLimit(radii, tolerance));
    return { bonds, angles: findAngles(geometry, bonds) };
  }, [geometry, radii, tolerance]);
  const { bonds, angles } = found;
  const elements = useMemo(() => [...new Set(geometry.atoms.map((a) => a.element))], [geometry]);
  const offered = useMemo(() => (table ? offeredStates(table, elements) : []), [table, elements]);
  const suggested = useMemo(() => {
    if (!table) return {};
    const states = suggestStates(table, geometry.atoms, bonds, geometry.covariance);
    const out: Record<string, number | null> = {};
    geometry.atoms.forEach((a, i) => (out[a.element] ??= states[i] ?? null));
    return out;
  }, [table, geometry, bonds]);
  const stateOf = (element: string) =>
    element in chosen ? (chosen[element] ?? null) : (suggested[element] ?? null);
  const sums = table
    ? bondValenceSums(
        table,
        geometry.atoms,
        geometry.atoms.map((a) => stateOf(a.element)),
        bonds,
        geometry.covariance,
      )
    : [];
  const refs = [...new Set(sums.flatMap((s) => s.refs))].sort();
  const missingRadius = radii ? elements.filter((e) => radii[e] === undefined) : [];
  const stem = `${name}-${phase.name}`;
  const titleId = `bonds-${phase.id}`;

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} class="export-title">
        {phase.name}
      </h3>
      {failed && (
        <p class="message is-warning">The bond tables could not be loaded. Reload the page.</p>
      )}
      {!tables && !failed && <p class="field-hint">Loading the bond tables…</p>}
      {missingRadius.length > 0 && (
        <p class="message is-warning">
          No covalent radius for {missingRadius.join(', ')}, so bonds to these atoms are not found.
        </p>
      )}
      {!radii ? null : bonds.length === 0 ? (
        <p class="field-hint">No bonded atoms within the tolerance.</p>
      ) : (
        <>
          <h4 class="export-title">Bond lengths</h4>
          <TableBox
            label={`Bond lengths, ${phase.name}`}
            compact
            onExport={() =>
              downloadCsv(
                `${stem}-bonds`,
                `Bond lengths of ${phase.name} from the Rietveld refinement (estimates). Symmetry code n_klm: operator n of the CIF list, translation (k−5, l−5, m−5); "." is the atom itself. s.u. from the covariance of the cell and coordinates.`,
                bonds,
                [
                  { header: 'Atom 1', value: (b) => atom(geometry, b.from) },
                  { header: 'Atom 2', value: (b) => atom(geometry, b.to) },
                  { header: 'Symmetry code', value: (b) => b.symmetry },
                  { header: 'Length (Å)', value: (b) => b.length },
                  { header: 's.u. (Å)', value: (b) => b.su },
                ],
              )
            }
          >
            <thead>
              <tr>
                <th scope="col">Atom 1</th>
                <th scope="col">Atom 2</th>
                <th scope="col">Length (Å)</th>
              </tr>
            </thead>
            <tbody>
              {bonds.map((b, i) => (
                <tr key={i}>
                  <th scope="row">{atom(geometry, b.from)}</th>
                  <td>{target(geometry, b)}</td>
                  <td>{withUncertainty(b.length, b.su, 4)}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
          <p class="field-hint">
            [n_klm] is the symmetry code of the second atom: operator n of the structure’s symmetry
            list, moved by (k−5, l−5, m−5) unit cells. No code means the atom of the list itself.
          </p>
          {angles.length > 0 && (
            <>
              <h4 class="export-title">Bond angles</h4>
              <TableBox
                label={`Bond angles, ${phase.name}`}
                compact
                onExport={() =>
                  downloadCsv(
                    `${stem}-angles`,
                    `Bond angles of ${phase.name} from the Rietveld refinement (estimates), atom 1 – centre – atom 2, with symmetry codes as in the bond table.`,
                    angles,
                    [
                      { header: 'Atom 1', value: (a) => target(geometry, bonds[a.first] as Bond) },
                      { header: 'Centre', value: (a) => atom(geometry, a.at) },
                      { header: 'Atom 2', value: (a) => target(geometry, bonds[a.second] as Bond) },
                      { header: 'Angle (°)', value: (a) => a.value },
                      { header: 's.u. (°)', value: (a) => (Number.isFinite(a.su) ? a.su : '') },
                    ],
                  )
                }
              >
                <thead>
                  <tr>
                    <th scope="col">Atom 1</th>
                    <th scope="col">Centre</th>
                    <th scope="col">Atom 2</th>
                    <th scope="col">Angle (°)</th>
                  </tr>
                </thead>
                <tbody>
                  {angles.map((a, i) => (
                    <tr key={i}>
                      <td>{target(geometry, bonds[a.first] as Bond)}</td>
                      <th scope="row">{atom(geometry, a.at)}</th>
                      <td>{target(geometry, bonds[a.second] as Bond)}</td>
                      <td>{withUncertainty(a.value, Number.isFinite(a.su) ? a.su : 0, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableBox>
            </>
          )}
        </>
      )}

      {table && (
        <>
          <h4 class="export-title">Bond-valence sums (estimates)</h4>
          <fieldset class="method-choice">
            <legend>
              Oxidation states (suggested from the bond lengths, check them){' '}
              <HelpTip term="suggested oxidation states">
                <p>
                  Anions take their usual state in the table (O 2−, F 1−, …). Each cation takes the
                  state the table offers that is closest to its own bond-valence sum. This is only a
                  suggestion: choose the states you know from the chemistry of the sample.
                </p>
              </HelpTip>
            </legend>
            {offered.map((o) => (
              <label key={o.element} class="inline-field">
                <span>{o.element}</span>
                <select
                  value={String(stateOf(o.element) ?? '')}
                  onChange={(e) =>
                    choose(
                      o.element,
                      e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
                    )
                  }
                >
                  <option value="">Leave out</option>
                  {o.states.map((s) => (
                    <option key={s} value={String(s)}>
                      {signed(s)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          {sums.length === 0 ? (
            <p class="field-hint">Choose oxidation states to calculate the sums.</p>
          ) : (
            <TableBox
              label={`Bond-valence sums, ${phase.name}`}
              compact
              onExport={() =>
                downloadCsv(
                  `${stem}-bond-valence`,
                  `Bond-valence sums of ${phase.name} (estimates): V = sum of exp((R0 - R)/b) over the cation-anion bonds, times the occupancy of the neighbour, with R0 and b from bvparm2020 (I. D. Brown, IUCr). Reference ids as in that table.`,
                  sums,
                  [
                    { header: 'Site', value: (s) => atom(geometry, s.site) },
                    { header: 'Oxidation state', value: (s) => s.state },
                    { header: 'Bonds', value: (s) => s.bonds },
                    { header: 'Bond-valence sum', value: (s) => s.sum },
                    { header: 's.u.', value: (s) => s.su },
                    { header: 'Pairs without parameters', value: (s) => s.missing.join(' ') },
                    { header: 'References', value: (s) => s.refs.join(' ') },
                  ],
                )
              }
            >
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">State</th>
                  <th scope="col">Bonds</th>
                  <th scope="col">Sum</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {sums.map((s) => (
                  <tr key={s.site}>
                    <th scope="row">{atom(geometry, s.site)}</th>
                    <td>{signed(s.state)}</td>
                    <td>{s.bonds}</td>
                    <td>{s.bonds > 0 ? withUncertainty(s.sum, s.su, 3) : '–'}</td>
                    <td class="peak-notes">{note(s.sum, s.state, s.bonds, s.missing)}</td>
                  </tr>
                ))}
              </tbody>
            </TableBox>
          )}
          {refs.length > 0 && (
            <>
              <p class="field-hint">
                R₀ and b from I. D. Brown’s table bvparm2020 (IUCr), which takes them from:
              </p>
              <ul class="field-hint">
                {refs.map((r) => (
                  <li key={r}>
                    ({r}) {table.refs[r]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Plain-language note on a bond-valence sum against the size of the oxidation state. */
function note(sum: number, state: number, bonds: number, missing: readonly string[]): string {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`No parameters for ${missing.join(', ')}; left out.`);
  if (bonds === 0) parts.push('No bonds to ions of opposite charge within the tolerance.');
  else {
    const off = (sum - Math.abs(state)) / Math.abs(state);
    if (Math.abs(off) > 0.1)
      parts.push(
        `${Math.round(Math.abs(off) * 100)}% ${off > 0 ? 'above' : 'below'} ${Math.abs(state)}: check the state and the atom positions.`,
      );
  }
  return parts.join(' ');
}
