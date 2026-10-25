import type { RietveldInput, RietveldOutcome } from '../../core/xrd/rietveld/refine';
import type { RietveldRequest, RietveldResponse } from '../../workers/rietveld.worker';

/**
 * Runs a Rietveld refinement in a web worker. Cancelling stops the worker at once; a new one
 * starts with the next refinement.
 */
export class RietveldClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private running: { id: number; resolve: (outcome: RietveldOutcome | null) => void } | null = null;

  /** Resolves with the outcome, or null when cancelled or the worker failed. */
  refine(input: RietveldInput, progress: (stage: string) => void): Promise<RietveldOutcome | null> {
    this.cancel();
    const id = this.nextId++;
    const worker = this.getWorker();
    return new Promise((resolve) => {
      this.running = { id, resolve };
      worker.onmessage = ({ data }: MessageEvent<RietveldResponse>) => {
        if (!this.running || data.id !== this.running.id) return;
        if (data.kind === 'progress') progress(data.stage);
        else {
          this.running.resolve(data.outcome);
          this.running = null;
        }
      };
      worker.postMessage({ id, input } satisfies RietveldRequest);
    });
  }

  cancel(): void {
    if (!this.running) return;
    this.running.resolve(null);
    this.running = null;
    this.worker?.terminate();
    this.worker = undefined;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = undefined;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/rietveld.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onerror = () => this.cancel();
    }
    return this.worker;
  }
}
