import { createSessionCodec } from '../../ui/persist/sessionFile';
import { FTIR_STATE_VERSION, migrateFtirData, type FtirData } from './data';

const isSpectrum = (s: unknown): boolean => {
  const spectrum = s as Partial<Record<'wavenumber' | 'values', unknown>> | null;
  return (
    !!spectrum &&
    spectrum.wavenumber instanceof Float64Array &&
    spectrum.values instanceof Float64Array &&
    spectrum.wavenumber.length === spectrum.values.length
  );
};

/** Saves and reads the whole FTIR analysis as a versioned JSON file. */
export const ftirSession = createSessionCodec<FtirData>({
  kind: 'ftir-session',
  label: 'FTIR',
  version: FTIR_STATE_VERSION,
  migrate: migrateFtirData,
  check: (data) =>
    !Array.isArray(data.spectra)
      ? 'The session file is incomplete or damaged: no spectra found.'
      : data.spectra.every(isSpectrum)
        ? null
        : 'The session file is damaged: a spectrum has missing or unequal data columns.',
});
