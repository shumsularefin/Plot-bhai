import { useState } from 'preact/hooks';
import { LazyTool } from '../../ui/LazyTool';
import { uvvisStore } from './uvvisStore';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { uvvisSteps } from './steps';

type Mode = 'spectra' | 'concentration' | 'film';
const KEY = 'uvvis-mode';

function savedMode(): Mode {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'concentration' || saved === 'film' ? saved : 'spectra';
  } catch {
    return 'spectra';
  }
}

// Defined once at module level so LazyTool does not reload it on every render.
const loadConcentration = () => import('./concentration/ConcentrationTool');
const loadFilm = () => import('./film/FilmTool');

/** Band gap analysis, the concentration and kinetics wizard, and the plasmon and thin-film wizard; the choice is remembered. */
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
        <label class={mode === 'film' ? 'is-selected' : ''}>
          <input
            type="radio"
            name="uvvis-mode"
            checked={mode === 'film'}
            onChange={() => choose('film')}
          />
          Plasmon and thin film
        </label>
      </fieldset>
      {mode === 'concentration' ? (
        <LazyTool load={loadConcentration} />
      ) : mode === 'film' ? (
        <LazyTool load={loadFilm} />
      ) : (
        <Wizard title="UV-Vis analysis" steps={uvvisSteps} store={uvvisStore} />
      )}
    </>
  );
}
