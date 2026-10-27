import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../../ui/plot/plot.css';
import '../xrd/xrd.css';
import { initialShotData, SHOT_STATE_VERSION } from './data';
import './shot.css';
import { shotSteps } from './steps';

const store = createPersistedStore({
  key: 'xrd-screenshot-session',
  version: SHOT_STATE_VERSION,
  initial: initialWizardState(initialShotData),
});

export default function ShotTool() {
  return <Wizard title="XRD from a screenshot" steps={shotSteps} store={store} />;
}
