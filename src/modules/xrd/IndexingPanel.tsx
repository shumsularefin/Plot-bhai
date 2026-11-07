import { useState } from 'preact/hooks';
import {
  DEFAULT_INDEXING,
  type IndexSolution,
  type IndexSystem,
} from '../../core/xrd/indexing/index';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { ANODES } from '../../core/xrd/radiation';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from './csv';
import { kAlpha2PairFor, processingFor, type XrdData } from './data';
import { indexInWorker, stopIndexing } from './indexingClient';
import { useMeasured } from './useMeasured';

const SYSTEMS: IndexSystem[] = [
  'cubic',
  'tetragonal',
  'hexagonal',
  'orthorhombic',
  'monoclinic',
  'triclinic',
];
const MIN_LINES = 10;
const MAX_LINES = 20;

const hklText = (hkl: [number, number, number] | null) => (hkl ? hkl.join(' ') : 'not indexed');
const edge = (name: string, v: number) => `${name} = ${formatNumber(v, 5)}`;
const angle = (name: string, v: number) => `${name} = ${formatNumber(v, 5)}°`;
const cellText = (s: IndexSolution) => {
  const abc = [edge('a', s.a), edge('b', s.b), edge('c', s.c)];
  switch (s.system) {
    case 'cubic':
      return edge('a', s.a);
    case 'tetragonal':
    case 'hexagonal':
      return `${edge('a', s.a)}, ${edge('c', s.c)}`;
    case 'orthorhombic':
      return abc.join(', ');
    case 'monoclinic':
      return [...abc, angle('β', s.beta)].join(', ');
    case 'triclinic':
      return [...abc, angle('α', s.alpha), angle('β', s.beta), angle('γ', s.gamma)].join(', ');
  }
};

interface IndexingPanelProps {
  data: XrdData;
  /** Fixes the pattern (no selector). Without it the user picks one. */
  patternId?: string;
  /** Fitted peak positions (° 2θ) to index instead of the strongest detected peaks. */
  fitted?: number[] | undefined;
}

/**
 * "Index an unknown pattern": suggests cells for the strongest detected peaks, or for the fitted
 * peaks when given, in a worker.
 */
export function IndexingPanel({ data, patternId: fixedId, fitted }: IndexingPanelProps) {
  const [chosenId, setPatternId] = useState(data.patterns[0]?.id);
  const patternId = fixedId ?? chosenId;
  const { pattern, detected } = useMeasured(data, patternId);
  const [tolerance, setTolerance] = useState(DEFAULT_INDEXING.tolerance);
  const [systems, setSystems] = useState<IndexSystem[]>(DEFAULT_INDEXING.systems);
  const [progress, setProgress] = useState<number | null>(null);
  const [solutions, setSolutions] = useState<IndexSolution[] | null>(null);
  const [failed, setFailed] = useState(false);

  // The strongest lines (by prominence), then in order of angle: weak lines are often noise.
  const positions = fitted
    ? fitted
        .slice()
        .sort((a, b) => a - b)
        .slice(0, MAX_LINES)
    : (detected ?? [])
        .slice()
        .sort((a, b) => b.prominence - a.prominence)
        .slice(0, MAX_LINES)
        .map((p) => p.center)
        .sort((a, b) => a - b);
  const wavelength = ANODES[data.radiation.anode].kAlpha1;
  const hasKAlpha2 =
    pattern !== undefined &&
    kAlpha2PairFor(processingFor(data, pattern.id), data.radiation) !== null;

  const run = async () => {
    setSolutions(null);
    setFailed(false);
    setProgress(0);
    const result = await indexInWorker(
      positions,
      { ...DEFAULT_INDEXING, wavelength, tolerance, systems },
      setProgress,
    );
    setProgress(null);
    if (result) setSolutions(result);
    else setFailed(true);
  };

  const download = (list: IndexSolution[]) =>
    downloadCsv(
      'indexing-suggestions',
      `Suggested cells for ${positions.length} lines of ${pattern?.name ?? 'the pattern'}, wavelength ${wavelength} Å, tolerance ${tolerance}° 2θ. Suggestions to confirm, not an identification.`,
      list,
      [
        { header: 'System', value: (s) => s.system },
        { header: 'Centring', value: (s) => s.centring },
        { header: 'a (Å)', value: (s) => s.a },
        { header: 'b (Å)', value: (s) => s.b },
        { header: 'c (Å)', value: (s) => s.c },
        { header: 'α (°)', value: (s) => s.alpha },
        { header: 'β (°)', value: (s) => s.beta },
        { header: 'γ (°)', value: (s) => s.gamma },
        { header: 'Volume (Å³)', value: (s) => s.volume },
        { header: `M${list[0]?.n ?? 20}`, value: (s) => s.m20 },
        { header: 'F_N', value: (s) => s.fN },
        { header: 'Mean |Δ2θ| (°)', value: (s) => s.meanDelta },
        { header: 'N_poss', value: (s) => s.nPossible },
        { header: 'Unindexed lines', value: (s) => s.unindexed },
      ],
    );

  return (
    <section class="unknown-guide" aria-labelledby="indexing-title">
      <h4 id="indexing-title" class="export-title">
        Index an unknown pattern{' '}
        <HelpTip term="indexing">
          <p>
            Indexing looks for a unit cell whose lines (from its edges and the Miller indices hkl)
            fall on your peak positions. It tries cubic, tetragonal, hexagonal, orthorhombic and
            monoclinic cells, and triclinic cells when you tick them. Monoclinic and triclinic cells
            are shown in reduced form (shortest edges), so they may differ from a published setting
            of the same lattice. Each suggestion is ranked by two figures of merit: de Wolff&apos;s
            M20 (the position fit, divided by how many lines the cell could give) and Smith and
            Snyder&apos;s F_N (the same idea in degrees 2θ). Higher is better. Several cells can
            index the same lines, so compare the top suggestions, and confirm the cell, for example
            with a structure of that cell or a refinement. Trigonal cells are found as hexagonal
            ones. Indexing does not solve the structure.
          </p>
        </HelpTip>
      </h4>
      <p class="message is-info">
        <strong>Note:</strong> the cells below are suggestions to confirm, never an identification.
        A mixture of phases rarely indexes, and with noisy positions a cell of lower symmetry can
        index the lines by chance; when two cells fit about equally, the one of higher symmetry is
        listed first.
      </p>
      {fixedId === undefined && data.patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select value={pattern?.id} onChange={(e) => setPatternId(e.currentTarget.value)}>
            {data.patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasKAlpha2 && (
        <p class="message is-warning">
          <strong>Check:</strong> your data still contain Kα2, which can split or shift high-angle
          peaks. Strip Kα2 in Clean data first for cleaner positions.
        </p>
      )}
      <p>
        Using the {positions.length} {fitted ? 'lowest-angle fitted' : 'strongest'} peaks{' '}
        {fitted ? 'of the Fit peaks step' : 'found in the cleaned pattern'} (at most {MAX_LINES}),
        wavelength {wavelength} Å.
      </p>
      <fieldset class="method-choice">
        <legend>Crystal systems to try</legend>
        {SYSTEMS.map((s) => (
          <label key={s} class="inline-field">
            <input
              type="checkbox"
              checked={systems.includes(s)}
              onChange={(e) =>
                setSystems(
                  e.currentTarget.checked
                    ? SYSTEMS.filter((x) => x === s || systems.includes(x))
                    : systems.filter((x) => x !== s),
                )
              }
            />
            {s}
          </label>
        ))}
      </fieldset>
      {systems.includes('triclinic') && (
        <p class="message is-warning">
          <strong>Check:</strong> a triclinic cell has six free parameters, so it can index almost
          any 20 lines. Trust a triclinic suggestion only with a high M20 (well above 20), when no
          cell of higher symmetry fits, and when the first lines of the pattern are all present.
        </p>
      )}
      <label class="inline-field">
        Position tolerance (° 2θ)
        <input
          type="number"
          min={0.005}
          max={0.2}
          step={0.005}
          value={tolerance}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (v >= 0.005 && v <= 0.2) setTolerance(v);
          }}
        />
      </label>
      {positions.length < MIN_LINES ? (
        <p class="message is-warning">
          Indexing needs at least {MIN_LINES} peaks; {positions.length} were found. Fit more peaks
          (lower the detection threshold in Fit peaks), or measure a wider 2θ range.
        </p>
      ) : progress !== null ? (
        <p aria-busy="true">
          <progress value={progress} max={1} /> Trying cells…{' '}
          <button
            type="button"
            class="btn"
            onClick={() => {
              stopIndexing();
              setProgress(null);
            }}
          >
            Stop
          </button>
        </p>
      ) : (
        <button
          type="button"
          class="btn btn-primary"
          disabled={systems.length === 0}
          onClick={() => void run()}
        >
          Suggest cells
        </button>
      )}
      {failed && <p class="message is-error">The indexing stopped unexpectedly. Try again.</p>}
      {solutions && solutions.length === 0 && (
        <p>
          No cell indexed these lines. Try a larger tolerance, fewer systems, or check that the
          sample is a single phase.
        </p>
      )}
      {solutions && solutions.length > 0 && (
        <>
          <div class="table-scroll">
            <table class="peak-table" aria-label="Suggested cells, best first">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">System</th>
                  <th scope="col">Cell (Å)</th>
                  <th scope="col">V (Å³)</th>
                  <th scope="col">M{solutions[0]?.n}</th>
                  <th scope="col">F_N</th>
                  <th scope="col">Unindexed</th>
                </tr>
              </thead>
              <tbody>
                {solutions.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      {s.system} {s.centring}
                    </td>
                    <td>{cellText(s)}</td>
                    <td>{formatNumber(s.volume, 5)}</td>
                    <td>{formatNumber(s.m20, 3)}</td>
                    <td>
                      {formatNumber(s.fN, 3)} ({formatNumber(s.meanDelta, 2)}°, {s.nPossible})
                    </td>
                    <td>{s.unindexed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="field-hint">
            F_N is followed by the mean |Δ2θ| and the number of possible lines. Centring is the
            lattice type (P primitive, I body-centred, F face-centred, C or A one face) that gives
            the best M{solutions[0]?.n}.
          </p>
          <details>
            <summary>Lines indexed by suggestion 1</summary>
            <div class="table-scroll">
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">2θ observed (°)</th>
                    <th scope="col">2θ calculated (°)</th>
                    <th scope="col">hkl</th>
                  </tr>
                </thead>
                <tbody>
                  {solutions[0]?.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{formatNumber(l.twoTheta, 5)}</td>
                      <td>{l.calc === null ? '–' : formatNumber(l.calc, 5)}</td>
                      <td>{hklText(l.hkl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button type="button" class="btn" onClick={() => download(solutions)}>
            Download suggestions (CSV)
          </button>
        </>
      )}
    </section>
  );
}
