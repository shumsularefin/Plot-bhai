import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { FTIR_STATE_VERSION, initialFtirData, migrateFtirData } from './data';

/** The saved FTIR analysis, shared with the graph-image reader that adds spectra to it. */
export const ftirStore = createPersistedStore({
  key: 'ftir-session',
  version: FTIR_STATE_VERSION,
  initial: initialWizardState(initialFtirData),
  migrate: migrateFtirData,
});
