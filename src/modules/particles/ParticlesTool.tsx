import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../../ui/plot/plot.css';
import '../xrd/xrd.css';
import { initialParticleData, migrateParticleData, PARTICLE_STATE_VERSION } from './data';
import { particleSteps } from './steps';

const store = createPersistedStore({
  key: 'particles-session',
  version: PARTICLE_STATE_VERSION,
  initial: initialWizardState(initialParticleData),
  migrate: migrateParticleData,
});

export default function ParticlesTool() {
  return <Wizard title="Particle size from images" steps={particleSteps} store={store} />;
}
