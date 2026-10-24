import { createPersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { initialThermalData, migrateThermalData, THERMAL_STATE_VERSION } from './data';
import { thermalSteps } from './steps';
import './thermal.css';

const store = createPersistedStore({
  key: 'thermal-session',
  version: THERMAL_STATE_VERSION,
  initial: initialWizardState(initialThermalData),
  migrate: migrateThermalData,
});

export default function ThermalTool() {
  return <Wizard title="TGA and DSC analysis" steps={thermalSteps} store={store} />;
}
