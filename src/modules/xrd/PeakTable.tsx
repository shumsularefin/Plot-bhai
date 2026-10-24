import { useState } from 'preact/hooks';
import type { RegionFit } from '../../core/xrd/peaks/fit';
import type { PeakRow } from '../../core/xrd/peaks/table';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { downloadTable } from './csv';
import { PEAK_COLUMNS as COLUMNS, peakFitTable } from './tables';

interface PeakTableProps {
  rows: PeakRow[];
  regions: readonly RegionFit[];
  intensityUnit: string;
  lambda: number;
  patternName: string;
}

/** Sortable table of fitted peaks with uncertainties, notes and CSV export. */
export function PeakTable({ rows, regions, intensityUnit, lambda, patternName }: PeakTableProps) {
  const [sort, setSort] = useState<{ key: keyof PeakRow; ascending: boolean }>({
    key: 'twoTheta',
    ascending: true,
  });
  const sorted = [...rows].sort((a, b) => {
    const d = (a[sort.key] as number) - (b[sort.key] as number);
    return sort.ascending ? d : -d;
  });
  const notesOf = (row: PeakRow) => regions[row.region]?.peaks[row.peak]?.messages ?? [];

  const exportCsv = () =>
    downloadTable(peakFitTable(patternName, sorted, regions, intensityUnit, lambda));

  return (
    <section class="peak-table-section" aria-labelledby="peak-table-title">
      <div class="peak-table-header">
        <h3 id="peak-table-title" class="export-title">
          Peak table
        </h3>
        <button type="button" class="btn" onClick={exportCsv}>
          Download CSV
        </button>
      </div>
      <p class="field-hint">
        Values are given ± their standard uncertainty from the fit. d uses Bragg's law with λ ={' '}
        {lambda} Å. Height is in {intensityUnit}; area is in {intensityUnit} × degrees.{' '}
        <HelpTip term="integral breadth">
          <p>
            The integral breadth is the peak area divided by its height: the width of a rectangle
            with the same height and area. Some size and strain methods use it instead of the FWHM.
          </p>
        </HelpTip>
      </p>
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Peak table, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sort.key === c.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button
                    type="button"
                    class="sort-button"
                    onClick={() =>
                      setSort({
                        key: c.key,
                        ascending: sort.key === c.key ? !sort.ascending : true,
                      })
                    }
                  >
                    {c.label}
                    <span aria-hidden="true">
                      {sort.key === c.key ? (sort.ascending ? ' ▲' : ' ▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={`${row.region}-${row.peak}`}>
                <td>{i + 1}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key}>
                    {c.sigma
                      ? formatWithSigma(row[c.key] as number, row[c.sigma] as number)
                      : (row[c.key] as number).toFixed(c.decimals ?? 3)}
                  </td>
                ))}
                <td class="peak-notes">
                  {notesOf(row)
                    .map((m) => m.text)
                    .join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
