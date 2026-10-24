import { createSessionCodec } from '../../ui/persist/sessionFile';
import { migrateThermalData, THERMAL_STATE_VERSION, type ThermalData } from './data';

const isColumn = (c: unknown): boolean => c instanceof Float64Array;

/** Saves and reads the whole thermal analysis as a versioned JSON file. */
export const thermalSession = createSessionCodec<ThermalData>({
  kind: 'thermal-session',
  label: 'thermal analysis',
  version: THERMAL_STATE_VERSION,
  migrate: migrateThermalData,
  check: (data) => {
    if (data.file === null) return null;
    const columns = data.file.table?.columns;
    return Array.isArray(columns) &&
      columns.length > 0 &&
      columns.every(isColumn) &&
      columns.every((c) => c.length === columns[0]?.length)
      ? null
      : 'The session file is damaged: the data columns are missing or have unequal lengths.';
  },
});
