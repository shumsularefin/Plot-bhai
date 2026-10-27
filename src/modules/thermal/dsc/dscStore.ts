import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { DSC_STATE_VERSION, initialDscData, migrateDscData } from './data';

/** The saved DSC analysis, shared with the graph-image reader that loads a curve into it. */
export const dscStore = createPersistedStore({
  key: 'dsc-session',
  version: DSC_STATE_VERSION,
  initial: initialWizardState(initialDscData),
  migrate: migrateDscData,
});
