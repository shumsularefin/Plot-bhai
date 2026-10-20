import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import { initialXrdData } from './data';
import { xrdSteps } from './steps';
import './xrd.css';

/** Bump when the saved shape changes incompatibly; older saved sessions are then discarded. */
const XRD_STATE_VERSION = 2;

const store = createPersistedStore({
  key: 'xrd-session',
  version: XRD_STATE_VERSION,
  initial: initialWizardState(initialXrdData),
});

export default function XrdTool() {
  return <Wizard title="XRD analysis" steps={xrdSteps} store={store} />;
}
