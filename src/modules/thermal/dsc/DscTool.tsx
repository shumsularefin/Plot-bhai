import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { Wizard } from '../../../ui/wizard/Wizard';
import { DSC_STATE_VERSION, initialDscData } from './data';
import { dscSteps } from './steps';

const store = createPersistedStore({
  key: 'dsc-session',
  version: DSC_STATE_VERSION,
  initial: initialWizardState(initialDscData),
  migrate: () => undefined,
});

export default function DscTool() {
  return <Wizard title="DSC analysis" steps={dscSteps} store={store} />;
}
