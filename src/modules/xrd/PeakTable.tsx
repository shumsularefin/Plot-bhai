import { useState } from 'preact/hooks';
import type { RegionFit } from '../../core/xrd/peaks/fit';
import { toCsv, type CsvColumn, type PeakRow } from '../../core/xrd/peaks/table';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { downloadBlob, fileStem } from '../../ui/plot/export';

interface Column {
  key: keyof PeakRow;
  label: string;
  sigma?: keyof PeakRow;
  /** Plain fixed decimals for values without an uncertainty. */
  decimals?: number;
}

const COLUMNS: Column[] = [
  { key: 'twoTheta', label: '2θ (°)', sigma: 'twoThetaSigma' },
  { key: 'd', label: 'd (Å)', sigma: 'dSigma' },
  { key: 'fwhm', label: 'FWHM (°)', sigma: 'fwhmSigma' },
  { key: 'fwhmRad', label: 'FWHM (rad)', sigma: 'fwhmRadSigma' },
  { key: 'breadth', label: 'Integral breadth (°)', sigma: 'breadthSigma' },
  { key: 'height', label: 'Height', sigma: 'heightSigma' },
  { key: 'area', label: 'Area', sigma: 'areaSigma' },
  { key: 'relativeIntensity', label: 'I/Imax (%)', decimals: 1 },
  { key: 'eta', label: 'η', sigma: 'etaSigma' },
];

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
  const regionOf = (row: PeakRow) => regions[row.region];

  const exportCsv = () => {
    const columns: CsvColumn<PeakRow>[] = [
      ...COLUMNS.flatMap((c) => [
        { header: c.label, value: (r: PeakRow) => r[c.key] },
        ...(c.sigma
          ? [{ header: `σ ${c.label}`, value: (r: PeakRow) => r[c.sigma as keyof PeakRow] }]
          : []),
      ]),
      { header: 'Region R²', value: (r) => regionOf(r)?.rSquared ?? '' },
      {
        header: 'Notes',
        value: (r) =>
          notesOf(r)
            .map((m) => m.text)
            .join(' '),
      },
    ];
    const header = `# Peak fit for ${patternName}. d from Bragg's law with λ = ${lambda} Å. Height in ${intensityUnit}; area in ${intensityUnit} × degrees. σ = standard uncertainty from the fit covariance.\r\n`;
    downloadBlob(
      new Blob([header + toCsv(sorted, columns)], { type: 'text/csv' }),
      `${fileStem(patternName)}-peaks.csv`,
    );
  };

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
