import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { initialThermalData, migrateThermalData, THERMAL_STATE_VERSION } from './data';

/** The saved TGA analysis, shared with the graph-image reader that loads a curve into it. */
export const tgaStore = createPersistedStore({
  key: 'thermal-session',
  version: THERMAL_STATE_VERSION,
  initial: initialWizardState(initialThermalData),
  migrate: migrateThermalData,
});
