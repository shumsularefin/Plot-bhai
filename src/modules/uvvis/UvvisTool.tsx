import { useState } from 'preact/hooks';
import { LazyTool } from '../../ui/LazyTool';
import { uvvisStore } from './uvvisStore';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { uvvisSteps } from './steps';

type Mode = 'spectra' | 'concentration';
const KEY = 'uvvis-mode';

function savedMode(): Mode {
  try {
    return localStorage.getItem(KEY) === 'concentration' ? 'concentration' : 'spectra';
  } catch {
    return 'spectra';
  }
}

// Defined once at module level so LazyTool does not reload it on every render.
const loadConcentration = () => import('./concentration/ConcentrationTool');

/** Band gap analysis and the concentration and kinetics wizard; the choice is remembered. */
export default function UvvisTool() {
  const [mode, setMode] = useState<Mode>(savedMode);
  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The choice just is not remembered.
    }
  };
  return (
    <>
      <fieldset class="segmented thermal-mode">
        <legend>Analysis</legend>
        <label class={mode === 'spectra' ? 'is-selected' : ''}>
          <input
            type="radio"
            name="uvvis-mode"
            checked={mode === 'spectra'}
            onChange={() => choose('spectra')}
          />
          Band gap and spectra
        </label>
        <label class={mode === 'concentration' ? 'is-selected' : ''}>
          <input
            type="radio"
            name="uvvis-mode"
            checked={mode === 'concentration'}
            onChange={() => choose('concentration')}
          />
          Concentration and kinetics
        </label>
      </fieldset>
      {mode === 'concentration' ? (
        <LazyTool load={loadConcentration} />
      ) : (
        <Wizard title="UV-Vis analysis" steps={uvvisSteps} store={uvvisStore} />
      )}
    </>
  );
}
