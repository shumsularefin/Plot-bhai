import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import { initialXrdData, migrateXrdData, XRD_STATE_VERSION } from './data';
import { xrdSteps } from './steps';
import './xrd.css';

const store = createPersistedStore({
  key: 'xrd-session',
  version: XRD_STATE_VERSION,
  initial: initialWizardState(initialXrdData),
  migrate: migrateXrdData,
});

export default function XrdTool() {
  return <Wizard title="XRD analysis" steps={xrdSteps} store={store} />;
}
