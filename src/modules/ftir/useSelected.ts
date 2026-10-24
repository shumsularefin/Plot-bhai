import { useState } from 'preact/hooks';
import type { FtirSpectrum } from '../../core/ftir/types';

/** Which spectrum a step shows; falls back to the first one when the chosen one was removed. */
export function useSelectedSpectrum(spectra: readonly FtirSpectrum[]) {
  const [selectedId, select] = useState(spectra[0]?.id);
  return { spectrum: spectra.find((s) => s.id === selectedId) ?? spectra[0], select };
}
