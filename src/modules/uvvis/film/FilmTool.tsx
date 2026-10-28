import { createPersistedStore } from '../../../ui/persist/persistedStore';
import { initialWizardState } from '../../../ui/wizard/types';
import { Wizard } from '../../../ui/wizard/Wizard';
import { FILM_STATE_VERSION, initialFilmData } from './data';
import { filmSteps } from './steps';

const store = createPersistedStore({
  key: 'uvvis-film-session',
  version: FILM_STATE_VERSION,
  initial: initialWizardState(initialFilmData),
  migrate: () => undefined,
});

export default function FilmTool() {
  return <Wizard title="Plasmon band and thin film analysis" steps={filmSteps} store={store} />;
}
