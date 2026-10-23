import type { ProcessingResult } from '../../core/xrd/process/pipeline';
import type { ProcessRequest, ProcessResponse } from '../../workers/process.worker';

type Input = Omit<ProcessRequest, 'id'>;

/**
 * Runs the preprocessing pipeline in a web worker. Only one job runs at a time; while it runs,
 * newer requests replace each other, so fast slider moves never queue up stale work and the
 * latest settings are always the next ones processed.
 */
export class ProcessClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private running: number | null = null;
  private queued: Input | null = null;

  constructor(private readonly onResult: (result: ProcessingResult | null) => void) {}

  request(input: Input): void {
    if (this.running !== null) {
      this.queued = input;
      return;
    }
    this.start(input);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  private start(input: Input): void {
    const id = this.nextId++;
    this.running = id;
    // Copies are sent so the pattern's own arrays stay usable on this side.
    this.getWorker().postMessage({
      id,
      ...input,
      twoTheta: input.twoTheta.slice(),
      intensity: input.intensity.slice(),
    } satisfies ProcessRequest);
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/process.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }: MessageEvent<ProcessResponse>) => {
        if (data.id !== this.running) return;
        this.running = null;
        const next = this.queued;
        this.queued = null;
        if (next) this.start(next);
        else this.onResult(data.result);
      };
      this.worker.onerror = () => {
        this.running = null;
        this.queued = null;
        this.worker?.terminate();
        this.worker = undefined;
        this.onResult(null);
      };
    }
    return this.worker;
  }
}
