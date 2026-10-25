import { createSessionCodec } from '../../../ui/persist/sessionFile';
import { DSC_STATE_VERSION, migrateDscData, type DscData } from './data';

const isColumns = (columns: unknown): boolean =>
  Array.isArray(columns) &&
  columns.length > 0 &&
  columns.every((c) => c instanceof Float64Array && c.length === columns[0].length);

/** Saves and reads the whole DSC analysis as a versioned JSON file. */
export const dscSession = createSessionCodec<DscData>({
  kind: 'dsc-session',
  label: 'DSC analysis',
  version: DSC_STATE_VERSION,
  migrate: migrateDscData,
  check: (data) => {
    if (!data.file) return 'The session file is incomplete or damaged: no run found.';
    if (!isColumns(data.file.table?.columns)) {
      return 'The session file is damaged: the data columns are missing or have unequal lengths.';
    }
    return data.tgaFile && !isColumns(data.tgaFile.table?.columns)
      ? 'The session file is damaged: the columns of the TGA file are missing or have unequal lengths.'
      : null;
  },
});
