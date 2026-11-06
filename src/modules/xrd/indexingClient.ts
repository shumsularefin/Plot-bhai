import type { IndexOptions, IndexSolution } from '../../core/xrd/indexing/index';
import type { IndexingRequest, IndexingResponse } from '../../workers/indexing.worker';

let worker: Worker | undefined;
let nextId = 1;

/**
 * Indexes line positions in a web worker. A new request stops the one running; resolves with
 * null when stopped or when the worker fails.
 */
export function indexInWorker(
  positions: number[],
  options: IndexOptions,
  onProgress: (fraction: number) => void,
): Promise<IndexSolution[] | null> {
  worker?.terminate();
  const current = new Worker(new URL('../../workers/indexing.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker = current;
  const id = nextId++;
  return new Promise((resolve) => {
    current.onmessage = ({ data }: MessageEvent<IndexingResponse>) => {
      if (data.id !== id) return;
      if (data.kind === 'progress') onProgress(data.fraction);
      else {
        resolve(data.solutions);
        current.terminate();
        if (worker === current) worker = undefined;
      }
    };
    current.onerror = () => {
      resolve(null);
      current.terminate();
      if (worker === current) worker = undefined;
    };
    current.postMessage({ id, positions, options } satisfies IndexingRequest);
  });
}

/** Stops a running indexing job. */
export function stopIndexing(): void {
  worker?.terminate();
  worker = undefined;
}
