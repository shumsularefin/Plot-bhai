import { useMemo } from 'preact/hooks';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { Estimate } from '../../core/xrd/size/methods';
import { formatWithSigma } from '../../ui/format';
import { BarChart } from '../../ui/plot/BarChart';
import { comparisonRows, comparisonTable } from './comparison';
import { downloadTable } from './csv';
import type { XrdData } from './data';
import { TableBox } from './MethodDetails';

const value = (e: Estimate | null | undefined, scale = 1) =>
  e ? formatWithSigma(e.value * scale, e.sigma * scale) : '–';

interface Props {
  data: XrdData;
  phases: readonly ReferencePhase[] | null;
  /** Opens a pattern's own results below. */
  onSelect: (patternId: string) => void;
}

/**
 * Results step, with two or more patterns: the headline size, strain and cell values of every
 * pattern in one table, so a series of samples can be compared without switching patterns.
 */
export function ComparisonSection({ data, phases, onSelect }: Props) {
  const rows = useMemo(() => comparisonRows(data, phases), [data, phases]);
  const names = ['a', 'b', 'c'] as const;
  const shownEdges = names.filter((n) => rows.some((r) => r.edges.some((e) => e.name === n)));
  const bars = rows.map((r) => ({
    label: r.name,
    value: r.scherrer?.value ?? NaN,
    sigma: r.scherrer?.sigma ?? NaN,
  }));
  return (
    <section class="process-step is-on" aria-labelledby="compare-title">
      <h3 id="compare-title" class="process-step-title">
        Compare your samples (estimates)
      </h3>
      <p class="field-hint">
        One row per pattern, with the same settings for all: K = {data.results.k} and the instrument
        correction of step 7. Scherrer is the mean ± standard deviation over the peaks used;
        Williamson–Hall UDM and the cell are value ± standard uncertainty of the fit. Choose a
        pattern's name to see its full results below.
      </p>
      <TableBox
        label="Sample comparison"
        onExport={() => downloadTable(comparisonTable(data, rows))}
      >
        <thead>
          <tr>
            <th scope="col">Pattern</th>
            <th scope="col">Peaks used</th>
            <th scope="col">D Scherrer (nm)</th>
            <th scope="col">D W–H UDM (nm)</th>
            <th scope="col">ε W–H UDM (10⁻³)</th>
            <th scope="col">Phase</th>
            {shownEdges.map((n) => (
              <th key={n} scope="col">
                <i>{n}</i> (Å)
              </th>
            ))}
            {shownEdges.length > 0 && <th scope="col">V (Å³)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <button type="button" class="link-button" onClick={() => onSelect(r.id)}>
                  {r.name}
                </button>
              </th>
              {r.peaks === null ? (
                <td colSpan={4} class="peak-notes">
                  {r.note}
                </td>
              ) : (
                <>
                  <td>
                    {r.peaks.used} of {r.peaks.fitted}
                  </td>
                  <td>{value(r.scherrer)}</td>
                  <td>{value(r.whSize)}</td>
                  <td>{value(r.whStrain, 1e3)}</td>
                </>
              )}
              <td>{r.phase ?? '–'}</td>
              {shownEdges.map((n) => (
                <td key={n}>{value(r.edges.find((e) => e.name === n)?.a)}</td>
              ))}
              {shownEdges.length > 0 && <td>{value(r.volume)}</td>}
            </tr>
          ))}
        </tbody>
      </TableBox>
      {bars.some((b) => Number.isFinite(b.value)) && (
        <BarChart
          bars={bars}
          yLabel="Scherrer size D (nm)"
          description="Bar chart of the Scherrer crystallite size of each pattern, with error bars."
          exportSettings={data.plot.export}
          exportName="sample-comparison-size"
        />
      )}
    </section>
  );
}
