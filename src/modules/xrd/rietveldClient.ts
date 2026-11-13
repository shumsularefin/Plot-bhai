import type { RietveldInput, RietveldOutcome } from '../../core/xrd/rietveld/refine';
import type { SeriesPoint } from '../../core/xrd/rietveld/sequential';
import type { Anode } from '../../core/xrd/radiation';
import type {
  RietveldRequest,
  RietveldResponse,
  SeriesRequest,
} from '../../workers/rietveld.worker';

type Finished = RietveldOutcome | SeriesPoint[];

/**
 * Runs a Rietveld refinement, or a sequential refinement of a series, in a web worker.
 * Cancelling stops the worker at once; a new one starts with the next refinement.
 */
export class RietveldClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private running: { id: number; resolve: (result: Finished | null) => void } | null = null;

  /**
   * Resolves with the outcome, or null when cancelled or the worker failed. `anomalous` names the
   * anode whose f′, f″ table the worker adds to the input (data/reference/anomalous-dispersion.json).
   */
  refine(
    input: RietveldInput,
    progress: (stage: string) => void,
    anomalous?: Anode,
  ): Promise<RietveldOutcome | null> {
    return this.post({ input }, progress, anomalous) as Promise<RietveldOutcome | null>;
  }

  /** Refines every pattern of a series in order of value (sequential.ts); null when cancelled. */
  refineSeries(
    series: SeriesRequest,
    progress: (stage: string) => void,
    anomalous?: Anode,
  ): Promise<SeriesPoint[] | null> {
    return this.post({ series }, progress, anomalous) as Promise<SeriesPoint[] | null>;
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

  private post(
    job: { input: RietveldInput } | { series: SeriesRequest },
    progress: (stage: string) => void,
    anomalous?: Anode,
  ): Promise<Finished | null> {
    this.cancel();
    const id = this.nextId++;
    const worker = this.getWorker();
    return new Promise((resolve) => {
      this.running = { id, resolve };
      worker.onmessage = ({ data }: MessageEvent<RietveldResponse>) => {
        if (!this.running || data.id !== this.running.id) return;
        if (data.kind === 'progress') return progress(data.stage);
        this.running.resolve(data.kind === 'done' ? data.outcome : data.points);
        this.running = null;
      };
      worker.postMessage({ id, ...job, ...(anomalous && { anomalous }) } satisfies RietveldRequest);
    });
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
