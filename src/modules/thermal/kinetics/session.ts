import { createSessionCodec } from '../../../ui/persist/sessionFile';
import { KINETICS_STATE_VERSION, type KineticsData } from './data';

/** Saves and reads the whole kinetics analysis as a versioned JSON file. */
export const kineticsSession = createSessionCodec<KineticsData>({
  kind: 'kinetics-session',
  label: 'Kinetics analysis',
  version: KINETICS_STATE_VERSION,
  migrate: () => undefined,
  check: (data) => {
    if (!Array.isArray(data.runs) || data.runs.length === 0) {
      return 'The session file is incomplete or damaged: no runs found.';
    }
    const ok = data.runs.every((r) => {
      const columns = r.table?.columns;
      return (
        Array.isArray(columns) &&
        columns.length > 0 &&
        columns.every((c) => c instanceof Float64Array && c.length === columns[0]?.length)
      );
    });
    return ok ? null : 'The session file is damaged: the data columns are missing or uneven.';
  },
});
