import { createSessionCodec } from '../../ui/persist/sessionFile';
import { migrateThermalData, THERMAL_STATE_VERSION, type ThermalData } from './data';

const isColumns = (columns: unknown): boolean =>
  Array.isArray(columns) &&
  columns.length > 0 &&
  columns.every((c) => c instanceof Float64Array && c.length === columns[0].length);

/** Saves and reads the whole thermal analysis as a versioned JSON file. */
export const thermalSession = createSessionCodec<ThermalData>({
  kind: 'thermal-session',
  label: 'thermal analysis',
  version: THERMAL_STATE_VERSION,
  migrate: migrateThermalData,
  check: (data) => {
    if (!data.file) return 'The session file is incomplete or damaged: no run found.';
    return isColumns(data.file.table?.columns)
      ? null
      : 'The session file is damaged: the data columns are missing or have unequal lengths.';
  },
});
