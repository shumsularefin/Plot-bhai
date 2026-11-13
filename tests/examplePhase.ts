import { readFileSync } from 'node:fs';
import scattering from '../data/reference/scattering-factors.json';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif';
import type { FormFactors } from '../src/core/xrd/reference/powder';
import type { ReferencePhase } from '../src/core/xrd/reference/types';

/** The phase behind "Try with example data": ZnO, read from the cached COD 1577381 CIF. */
export function examplePhase(): ReferencePhase {
  const read = phaseFromCif(
    readFileSync('scripts/cif-cache/1577381.cif', 'utf8'),
    'COD 1577381.cif',
    (scattering as unknown as { factors: FormFactors }).factors,
    'cod-1577381',
  );
  if (!read.ok) throw new Error(read.error);
  return read.phase;
}
