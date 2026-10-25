import type { CifPhaseResult } from '../../core/xrd/reference/fromCif';
import type { CifRequest, CifResponse } from '../../workers/cif.worker';

/** Larger files are refused before reading; a CIF of a large structure is still under 1 MB. */
export const MAX_CIF_BYTES = 5 * 1024 * 1024;

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (result: CifPhaseResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/cif.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }: MessageEvent<CifResponse>) => {
      waiting.get(data.id)?.(data.result);
      waiting.delete(data.id);
    };
    worker.onerror = () => {
      for (const resolve of waiting.values())
        resolve({ ok: false, error: 'The structure calculation stopped unexpectedly.' });
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

/** Reads one CIF file in a web worker and returns its phase, or a plain reason it cannot be used. */
export async function readCifFile(file: File, phaseId: string): Promise<CifPhaseResult> {
  if (file.size > MAX_CIF_BYTES)
    return { ok: false, error: 'This file is larger than 5 MB, far bigger than a structure file.' };
  return readCifText(await file.text(), file.name, phaseId);
}

/** Reads CIF text (a file or a COD download) in a web worker, as readCifFile. */
export function readCifText(
  text: string,
  fileName: string,
  phaseId: string,
): Promise<CifPhaseResult> {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    getWorker().postMessage({ id, text, fileName, phaseId } satisfies CifRequest);
  });
}
