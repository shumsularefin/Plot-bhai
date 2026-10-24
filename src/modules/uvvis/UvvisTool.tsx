import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { initialUvvisData, migrateUvvisData, UVVIS_STATE_VERSION } from './data';
import { uvvisSteps } from './steps';

const store = createPersistedStore({
  key: 'uvvis-session',
  version: UVVIS_STATE_VERSION,
  initial: initialWizardState(initialUvvisData),
  migrate: migrateUvvisData,
});

export default function UvvisTool() {
  return <Wizard title="UV-Vis analysis" steps={uvvisSteps} store={store} />;
}
