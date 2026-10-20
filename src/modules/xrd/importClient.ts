import type { ImportResult } from '../../core/xrd/types';
import type { ImportRequest, ImportResponse } from '../../workers/import.worker';

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (result: ImportResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }: MessageEvent<ImportResponse>) => {
      waiting.get(data.id)?.(data.result);
      waiting.delete(data.id);
    };
    worker.onerror = () => {
      // The worker failed to start or crashed: answer everything still waiting, then start afresh.
      for (const resolve of waiting.values()) {
        resolve({
          ok: false,
          error: 'The file reader stopped unexpectedly. Reload the page and try again.',
        });
      }
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return worker;
}

type Request = { kind: 'file'; file: File } | { kind: 'text'; name: string; text: string };

/** Reads and checks a file or pasted text in a web worker, so the page never freezes. */
export function importInWorker(request: Request): Promise<ImportResult> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    getWorker().postMessage({ id, ...request } satisfies ImportRequest);
  });
}
