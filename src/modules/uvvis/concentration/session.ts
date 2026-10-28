import { createSessionCodec } from '../../../ui/persist/sessionFile';
import { CONCENTRATION_STATE_VERSION, type ConcentrationData } from './data';

/** Saves and reads the whole concentration and kinetics analysis as a versioned JSON file. */
export const concentrationSession = createSessionCodec<ConcentrationData>({
  kind: 'uvvis-concentration-session',
  label: 'concentration and kinetics analysis',
  version: CONCENTRATION_STATE_VERSION,
  migrate: () => undefined,
  check: (data) => {
    if (!Array.isArray(data.samples) || data.samples.length === 0) {
      return 'The session file is incomplete or damaged: no samples found.';
    }
    const ok = data.samples.every(
      (s) =>
        !s.spectrum ||
        (s.spectrum.wavelengthNm instanceof Float64Array &&
          s.spectrum.values instanceof Float64Array &&
          s.spectrum.values.length === s.spectrum.wavelengthNm.length),
    );
    return ok ? null : 'The session file is damaged: a spectrum is missing or uneven.';
  },
});
