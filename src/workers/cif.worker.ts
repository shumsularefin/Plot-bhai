import { phaseFromCif, type CifPhaseResult } from '../core/xrd/reference/fromCif';
import type { FormFactors } from '../core/xrd/reference/powder';
import scattering from '../../data/reference/scattering-factors.json';

export interface CifRequest {
  id: number;
  text: string;
  fileName: string;
  phaseId: string;
}

export type CifResponse = { id: number; result: CifPhaseResult };

const factors = (scattering as unknown as { factors: FormFactors }).factors;

/** Reads a CIF and calculates its powder lines off the main thread (large cells take seconds). */
self.onmessage = ({ data }: MessageEvent<CifRequest>) => {
  let result: CifPhaseResult;
  try {
    result = phaseFromCif(data.text, data.fileName, factors, data.phaseId);
  } catch {
    result = { ok: false, error: 'Something went wrong while calculating this structure.' };
  }
  (self as unknown as Worker).postMessage({ id: data.id, result } satisfies CifResponse);
};
