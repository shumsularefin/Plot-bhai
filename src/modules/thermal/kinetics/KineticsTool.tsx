import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { Wizard } from '../../../ui/wizard/Wizard';
import { initialKineticsData, KINETICS_STATE_VERSION } from './data';
import { kineticsSteps } from './steps';

const store = createPersistedStore({
  key: 'kinetics-session',
  version: KINETICS_STATE_VERSION,
  initial: initialWizardState(initialKineticsData),
  migrate: () => undefined,
});

export default function KineticsTool() {
  return (
    <Wizard
      title="Activation energy from several heating rates"
      steps={kineticsSteps}
      store={store}
    />
  );
}
