import { useState } from 'preact/hooks';
import { LazyTool } from '../../ui/LazyTool';
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

// Defined once at module level so LazyTool does not reload it on every render.
const loadDsc = () => import('./dsc/DscTool');

type Technique = 'tga' | 'dsc';
const MODE_KEY = 'thermal-technique';

function savedTechnique(): Technique {
  try {
    return localStorage.getItem(MODE_KEY) === 'dsc' ? 'dsc' : 'tga';
  } catch {
    return 'tga';
  }
}

/** TGA and DSC are two wizards; the choice is remembered. Each keeps its own saved session. */
export default function ThermalTool() {
  const [technique, setTechnique] = useState<Technique>(savedTechnique);
  const choose = (next: Technique) => {
    setTechnique(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // The choice just is not remembered.
    }
  };
  return (
    <>
      <fieldset class="segmented thermal-mode">
        <legend>Technique</legend>
        <label class={technique === 'tga' ? 'is-selected' : ''}>
          <input
            type="radio"
            name="technique"
            checked={technique === 'tga'}
            onChange={() => choose('tga')}
          />
          TGA (mass loss)
        </label>
        <label class={technique === 'dsc' ? 'is-selected' : ''}>
          <input
            type="radio"
            name="technique"
            checked={technique === 'dsc'}
            onChange={() => choose('dsc')}
          />
          DSC (heat flow)
        </label>
      </fieldset>
      {technique === 'dsc' ? (
        <LazyTool load={loadDsc} />
      ) : (
        <Wizard title="TGA analysis" steps={thermalSteps} store={store} />
      )}
    </>
  );
}
