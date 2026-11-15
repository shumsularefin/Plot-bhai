import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { initialParticleData, migrateParticleData, PARTICLE_STATE_VERSION } from './data';

/** The saved particle analysis, shared with the sample report. */
export const particleStore = createPersistedStore({
  key: 'particles-session',
  version: PARTICLE_STATE_VERSION,
  initial: initialWizardState(initialParticleData),
  migrate: migrateParticleData,
});
