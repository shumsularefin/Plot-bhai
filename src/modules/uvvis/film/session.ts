import { createSessionCodec } from '../../../ui/persist/sessionFile';
import { FILM_STATE_VERSION, type FilmData } from './data';

/** Saves and reads a plasmon or thin-film analysis as a versioned JSON file. */
export const filmSession = createSessionCodec<FilmData>({
  kind: 'uvvis-film-session',
  label: 'UV-Vis plasmon or thin film analysis',
  version: FILM_STATE_VERSION,
  migrate: () => undefined,
  check: (data) => {
    const s = data.spectrum;
    if (!s) return 'The session file is incomplete or damaged: no spectrum found.';
    return s.wavelengthNm instanceof Float64Array &&
      s.values instanceof Float64Array &&
      s.values.length === s.wavelengthNm.length
      ? null
      : 'The session file is damaged: the spectrum columns are missing or uneven.';
  },
});
