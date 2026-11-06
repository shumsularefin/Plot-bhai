import { useEffect, useMemo, useState } from 'preact/hooks';
import { peakTable } from '../../core/xrd/peaks/table';
import { ANODES } from '../../core/xrd/radiation';
import { formatHkl } from '../../core/xrd/reference/hkl';
import {
  DEFAULT_INDEXING,
  INDEX_SYSTEMS,
  type Centring,
  type IndexingSolution,
  type IndexSystem,
} from '../../core/xrd/reference/indexing';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from './csv';
import { peaksFor, type XrdData } from './data';
import { indexInWorker } from './indexingFitClient';
import { TableBox } from './MethodDetails';
import { NumberInput } from './NumberInput';

const CENTRING_NAMES: Record<Centring, string> = {
  P: 'primitive',
  I: 'body-centred',
  F: 'face-centred',
};

const SYSTEM_CHOICES: { value: 'auto' | IndexSystem; label: string }[] = [
  { value: 'auto', label: 'Try all three (cubic, tetragonal, hexagonal)' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'tetragonal', label: 'Tetragonal' },
  { value: 'hexagonal', label: 'Hexagonal' },
];

const cellText = (s: IndexingSolution) =>
  s.fit.edges.map((e) => `${e.name} = ${formatWithSigma(e.a.value, e.a.sigma)} Å`).join(', ');

/**
 * Indexing without a reference: find a cubic, tetragonal or hexagonal cell from the fitted peak
 * positions, with the crystal system chosen by the user or tried automatically. An estimate.
 */
export function IndexingSection({ data, patternId }: { data: XrdData; patternId: string }) {
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  const fit = peaksFor(data, patternId).fit;
  const positions = useMemo(
    () => (fit ? peakTable(fit.regions, lambda).map((r) => r.twoTheta) : []),
    [fit, lambda],
  );
  const [system, setSystem] = useState<'auto' | IndexSystem>('auto');
  const [tolerance, setTolerance] = useState<number | null>(DEFAULT_INDEXING.tolerance);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IndexingSolution[] | null | 'failed'>(null);
  const [chosen, setChosen] = useState(0);
  const inputKey = `${positions.join(',')}|${lambda}|${system}|${tolerance}`;
  // A new fit or new settings make an old answer stale.
  useEffect(() => setResult(null), [inputKey]);

  const run = async () => {
    setBusy(true);
    const solutions = await indexInWorker({
      positions,
      wavelength: lambda,
      systems: system === 'auto' ? [...INDEX_SYSTEMS] : [system],
      tolerance: tolerance ?? DEFAULT_INDEXING.tolerance,
    });
    setBusy(false);
    setChosen(0);
    setResult(solutions ?? 'failed');
  };

  const best = Array.isArray(result) ? result[chosen] : undefined;
  const tooFew = positions.length < 3;

  return (
    <section class="peak-table-section" aria-labelledby="indexing-title">
      <h3 id="indexing-title" class="export-title">
        Find the unit cell without a reference (estimate){' '}
        <HelpTip term="indexing">
          <p>
            Indexing finds a unit cell whose calculated lines fall on the measured peaks. The app
            gives the first lines low Miller indices in every possible way, keeps the cells that
            explain all lines (all but one in ten may be left over), refines each cell by least
            squares and ranks them by de Wolff's figure of merit M(N): the higher, the more
            convincing. As a rough guide, M(20) above 10 with every line indexed is worth checking
            further, and below 10 is doubtful.
          </p>
          <p>
            Only cubic, tetragonal and hexagonal cells are tried, with primitive, body-centred and
            face-centred lattices. Monoclinic, triclinic, orthorhombic and rhombohedral cells, and
            absences from glide planes or screw axes, are not covered. Remove the Kα2 lines first
            (step 2), or they show up as lines the cell cannot explain.
          </p>
        </HelpTip>
      </h3>
      <p class="field-hint">
        Use this when no reference phase fits, or to check one. The result is an estimate: confirm
        it against a reference pattern or other measurements before you report it.
      </p>
      {tooFew ? (
        <p class="message is-info" role="note">
          <strong>Note:</strong> at least 3 fitted peaks are needed (4 for tetragonal or hexagonal).
          Fit the peaks in step 5.
        </p>
      ) : (
        <>
          <div class="radiation-fields">
            <label class="inline-field">
              Crystal system
              <select
                value={system}
                onChange={(e) => setSystem(e.currentTarget.value as 'auto' | IndexSystem)}
              >
                {SYSTEM_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberInput
              label="Position tolerance (° 2θ)"
              value={tolerance}
              min={0.01}
              max={0.5}
              step={0.01}
              onChange={setTolerance}
            />
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? 'Searching…' : 'Find a cell'}
            </button>
          </div>
          <p class="field-hint">
            Uses the {Math.min(positions.length, 20)} lowest-angle fitted peaks of{' '}
            {positions.length}.
          </p>
        </>
      )}
      {result === 'failed' && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> the search stopped unexpectedly. Try again, or try one crystal
          system at a time.
        </p>
      )}
      {Array.isArray(result) && result.length === 0 && (
        <p class="message is-warning" role="status">
          <strong>Check:</strong> no {system === 'auto' ? 'cubic, tetragonal or hexagonal' : system}{' '}
          cell explains the peaks. The crystal may have lower symmetry, the sample may hold more
          than one phase (try the reference comparison in step 4), or the tolerance may be too
          tight.
        </p>
      )}
      {Array.isArray(result) && result.length > 0 && (
        <>
          <TableBox
            label="Candidate cells"
            onExport={() =>
              downloadCsv(
                'indexing-candidates',
                `Unit cells found without a reference (estimates), ranked by de Wolff's M(N). Wavelength ${lambda} Å; tolerance ${tolerance} deg 2theta.`,
                result,
                [
                  { header: 'System', value: (s) => s.system },
                  { header: 'Lattice', value: (s) => CENTRING_NAMES[s.centring] },
                  { header: 'a (Å)', value: (s) => s.fit.edges[0]?.a.value ?? '' },
                  { header: 'σ(a) (Å)', value: (s) => s.fit.edges[0]?.a.sigma ?? '' },
                  { header: 'c (Å)', value: (s) => s.fit.edges[1]?.a.value ?? '' },
                  { header: 'σ(c) (Å)', value: (s) => s.fit.edges[1]?.a.sigma ?? '' },
                  { header: 'Volume (Å3)', value: (s) => s.fit.volume.value },
                  { header: 'Lines indexed', value: (s) => s.indexed },
                  { header: 'Lines used', value: (s) => s.n },
                  { header: 'M(N)', value: (s) => s.figureOfMerit },
                ],
              )
            }
          >
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">Show</th>
                  <th scope="col">Cell</th>
                  <th scope="col">Edges</th>
                  <th scope="col">Volume (Å³)</th>
                  <th scope="col">Lines indexed</th>
                  <th scope="col">M({result[0]?.n})</th>
                </tr>
              </thead>
              <tbody>
                {result.map((s, i) => (
                  <tr key={i} class={i === chosen ? 'is-selected-row' : undefined}>
                    <td>
                      <input
                        type="radio"
                        name="indexing-choice"
                        checked={i === chosen}
                        aria-label={`Show the lines of candidate ${i + 1}`}
                        onChange={() => setChosen(i)}
                      />
                    </td>
                    <th scope="row">
                      {s.system}, {CENTRING_NAMES[s.centring]}
                    </th>
                    <td>{cellText(s)}</td>
                    <td>{formatWithSigma(s.fit.volume.value, s.fit.volume.sigma)}</td>
                    <td>
                      {s.indexed} of {s.n}
                    </td>
                    <td>{formatNumber(s.figureOfMerit, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableBox>
          {result[0] && result[0].figureOfMerit < 10 && (
            <p class="message is-warning" role="status">
              <strong>Check:</strong> the best figure of merit is below 10, so none of these cells
              is convincing. Treat them as guesses.
            </p>
          )}
          {best && (
            <TableBox
              label="Lines of the chosen cell"
              onExport={() =>
                downloadCsv(
                  'indexing-lines',
                  `Peaks indexed with a ${best.system} ${CENTRING_NAMES[best.centring]} cell found without a reference (estimate): ${cellText(best)}.`,
                  best.lines,
                  [
                    { header: '2theta observed (deg)', value: (l) => l.twoTheta },
                    { header: 'hkl', value: (l) => (l.hkl ? formatHkl([l.hkl]) : 'not indexed') },
                    { header: 'Observed - calculated (deg)', value: (l) => l.residual },
                  ],
                )
              }
            >
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">2θ observed (°)</th>
                    <th scope="col">(hkl)</th>
                    <th scope="col">Observed − calculated (° 2θ)</th>
                  </tr>
                </thead>
                <tbody>
                  {best.lines.map((l) => (
                    <tr key={l.twoTheta}>
                      <td>{formatNumber(l.twoTheta, 5)}</td>
                      <td>{l.hkl ? formatHkl([l.hkl]) : 'not indexed'}</td>
                      <td>{formatNumber(l.residual, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
          )}
          {best && best.indexed < best.n && (
            <p class="field-hint">
              Lines marked "not indexed" may come from a second phase, an impurity or Kα2.
            </p>
          )}
        </>
      )}
    </section>
  );
}
