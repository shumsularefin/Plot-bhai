import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { Wizard } from '../../../ui/wizard/Wizard';
import { DSC_METHODS_STATE_VERSION, initialDscMethodsData } from './data';
import { dscMethodsSteps } from './steps';

const store = createPersistedStore({
  key: 'dsc-methods-session',
  version: DSC_METHODS_STATE_VERSION,
  initial: initialWizardState(initialDscMethodsData),
  migrate: () => undefined,
});

export default function DscMethodsTool() {
  return (
    <Wizard
      title="DSC heat capacity, purity and oxidation induction time"
      steps={dscMethodsSteps}
      store={store}
    />
  );
}
