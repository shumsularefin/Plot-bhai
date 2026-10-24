import { createSessionCodec } from '../../ui/persist/sessionFile';
import { migrateUvvisData, UVVIS_STATE_VERSION, type UvvisData } from './data';

const isSpectrum = (s: unknown): boolean => {
  const spectrum = s as Partial<Record<'wavelengthNm' | 'values', unknown>> | null;
  return (
    !!spectrum &&
    spectrum.wavelengthNm instanceof Float64Array &&
    spectrum.values instanceof Float64Array &&
    spectrum.wavelengthNm.length === spectrum.values.length
  );
};

/** Saves and reads the whole UV-Vis analysis as a versioned JSON file. */
export const uvvisSession = createSessionCodec<UvvisData>({
  kind: 'uvvis-session',
  label: 'UV-Vis',
  version: UVVIS_STATE_VERSION,
  migrate: migrateUvvisData,
  check: (data) =>
    !Array.isArray(data.spectra)
      ? 'The session file is incomplete or damaged: no spectra found.'
      : data.spectra.every(isSpectrum)
        ? null
        : 'The session file is damaged: a spectrum has missing or unequal data columns.',
});
