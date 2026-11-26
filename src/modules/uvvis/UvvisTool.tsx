import { useState } from 'preact/hooks';
import { LazyTool } from '../../ui/LazyTool';
import { uvvisStore } from './uvvisStore';
import { ToolModeContext } from '../../ui/wizard/ToolMode';
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

const MODES = [
  { id: 'spectra', label: 'Band gap and spectra' },
  { id: 'concentration', label: 'Concentration and kinetics' },
  { id: 'film', label: 'Plasmon and thin film' },
] as const;

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
    <ToolModeContext.Provider
      value={{
        label: 'Analysis',
        value: mode,
        options: MODES,
        onChange: (id) => choose(id as Mode),
      }}
    >
      {mode === 'concentration' ? (
        <LazyTool load={loadConcentration} />
      ) : mode === 'film' ? (
        <LazyTool load={loadFilm} />
      ) : (
        <Wizard title="UV-Vis analysis" steps={uvvisSteps} store={uvvisStore} />
      )}
    </ToolModeContext.Provider>
  );
}
