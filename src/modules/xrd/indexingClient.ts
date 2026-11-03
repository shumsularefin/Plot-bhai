import type { IndexingSolution } from '../../core/xrd/reference/indexing';
import type { IndexingRequest, IndexingResponse } from '../../workers/indexing.worker';

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (solutions: IndexingSolution[] | null) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/indexing.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }: MessageEvent<IndexingResponse>) => {
      waiting.get(data.id)?.(data.solutions);
      waiting.delete(data.id);
    };
    worker.onerror = () => {
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

/** Indexes peak positions in a web worker; null when the search failed. */
export function indexInWorker(
  request: Omit<IndexingRequest, 'id'>,
): Promise<IndexingSolution[] | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    getWorker().postMessage({ id, ...request } satisfies IndexingRequest);
  });
}
