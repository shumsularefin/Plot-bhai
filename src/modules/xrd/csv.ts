import { toCsv, type CsvColumn } from '../../core/xrd/peaks/table';
import { downloadBlob, fileStem } from '../../ui/plot/export';

/** A table as CSV text, with a first line starting "#" that says what the table is. */
export interface CsvTable {
  /** Name for the file and the list of tables, for example "Sample-peaks". */
  name: string;
  text: string;
}

export function makeTable<Row>(
  name: string,
  note: string,
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
): CsvTable {
  return { name, text: `# ${note}\r\n${toCsv(rows, columns)}` };
}

export function downloadTable(table: CsvTable): void {
  downloadBlob(new Blob([table.text], { type: 'text/csv' }), `${fileStem(table.name)}.csv`);
}

/** Downloads rows as CSV, with a first line starting "#" that says what the table is. */
export function downloadCsv<Row>(
  name: string,
  note: string,
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
): void {
  downloadTable(makeTable(name, note, rows, columns));
}
