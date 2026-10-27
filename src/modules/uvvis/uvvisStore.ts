import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { initialUvvisData, migrateUvvisData, UVVIS_STATE_VERSION } from './data';

/** The saved UV-Vis analysis, shared with the graph-image reader that adds spectra to it. */
export const uvvisStore = createPersistedStore({
  key: 'uvvis-session',
  version: UVVIS_STATE_VERSION,
  initial: initialWizardState(initialUvvisData),
  migrate: migrateUvvisData,
});
