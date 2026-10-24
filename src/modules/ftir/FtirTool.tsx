import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { FTIR_STATE_VERSION, initialFtirData, migrateFtirData } from './data';
import { ftirSteps } from './steps';

const store = createPersistedStore({
  key: 'ftir-session',
  version: FTIR_STATE_VERSION,
  initial: initialWizardState(initialFtirData),
  migrate: migrateFtirData,
});

export default function FtirTool() {
  return <Wizard title="FTIR analysis" steps={ftirSteps} store={store} />;
}
