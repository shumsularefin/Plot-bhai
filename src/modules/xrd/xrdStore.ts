import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { initialXrdData, migrateXrdData, XRD_STATE_VERSION } from './data';

/** The saved XRD analysis, shared with tools that hand patterns to it (the screenshot reader). */
export const xrdStore = createPersistedStore({
  key: 'xrd-session',
  version: XRD_STATE_VERSION,
  initial: initialWizardState(initialXrdData),
  migrate: migrateXrdData,
});
