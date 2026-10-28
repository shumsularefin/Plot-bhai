import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { Wizard } from '../../../ui/wizard/Wizard';
import { CONCENTRATION_STATE_VERSION, initialConcentrationData } from './data';
import { concentrationSteps } from './steps';

const store = createPersistedStore({
  key: 'uvvis-concentration-session',
  version: CONCENTRATION_STATE_VERSION,
  initial: initialWizardState(initialConcentrationData),
  migrate: () => undefined,
});

export default function ConcentrationTool() {
  return <Wizard title="Concentration and kinetics" steps={concentrationSteps} store={store} />;
}
