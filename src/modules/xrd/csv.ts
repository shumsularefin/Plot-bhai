import { toCsv, type CsvColumn } from '../../core/xrd/peaks/table';
import { downloadBlob, fileStem } from '../../ui/plot/export';

/** Downloads rows as CSV, with a first line starting "#" that says what the table is. */
export function downloadCsv<Row>(
  name: string,
  note: string,
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
): void {
  downloadBlob(
    new Blob([`# ${note}\r\n${toCsv(rows, columns)}`], { type: 'text/csv' }),
    `${fileStem(name)}.csv`,
  );
}
