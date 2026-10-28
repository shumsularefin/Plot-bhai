import { createSessionCodec } from '../../../ui/persist/sessionFile';
import { DSC_METHODS_STATE_VERSION, type DscMethodsData } from './data';

/** Saves and reads a DSC methods analysis as a versioned JSON file. */
export const dscMethodsSession = createSessionCodec<DscMethodsData>({
  kind: 'dsc-methods-session',
  label: 'DSC methods analysis',
  version: DSC_METHODS_STATE_VERSION,
  migrate: () => undefined,
  check: (data) => {
    const files = Object.values(data.files ?? {});
    if (files.length === 0) return 'The session file is incomplete or damaged: no runs found.';
    const ok = files.every((f) => {
      const columns = f?.table?.columns;
      return (
        Array.isArray(columns) &&
        columns.length > 0 &&
        columns.every((c) => c instanceof Float64Array && c.length === columns[0]?.length)
      );
    });
    return ok ? null : 'The session file is damaged: the data columns are missing or uneven.';
  },
});
