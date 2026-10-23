import type { DetectedPeak, DetectionOptions } from '../../core/xrd/peaks/detect';
import type { FitOptions, PeakGuess, RegionFit } from '../../core/xrd/peaks/fit';
import type { PeaksRequest, PeaksResponse } from '../../workers/peaks.worker';

/**
 * Peak detection and fitting in a web worker. Detection keeps only the latest request.
 * A fit can be cancelled, which stops the worker immediately; a new one starts on demand.
 */
export class PeaksClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private latestDetect = 0;
  private fit: {
    id: number;
    resolve: (regions: RegionFit[] | null) => void;
    progress: (done: number, total: number) => void;
  } | null = null;
  private detectWaiting = new Map<number, (peaks: DetectedPeak[] | null) => void>();

  detect(
    x: Float64Array,
    y: Float64Array,
    options: DetectionOptions,
  ): Promise<DetectedPeak[] | null> {
    const id = this.nextId++;
    this.latestDetect = id;
    return new Promise((resolve) => {
      this.detectWaiting.set(id, resolve);
      this.send({ id, kind: 'detect', x, y, options });
    });
  }

  /** Resolves with the fitted regions, or null if cancelled or failed. */
  fitPeaks(
    x: Float64Array,
    y: Float64Array,
    guesses: PeakGuess[],
    options: FitOptions,
    progress: (done: number, total: number) => void,
  ): Promise<RegionFit[] | null> {
    this.cancelFit();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.fit = { id, resolve, progress };
      this.send({ id, kind: 'fit', x, y, guesses, options });
    });
  }

  cancelFit(): void {
    if (!this.fit) return;
    this.fit.resolve(null);
    this.fit = null;
    this.reset();
  }

  dispose(): void {
    this.cancelFit();
    this.reset();
  }

  private send(request: PeaksRequest): void {
    this.getWorker().postMessage(request);
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const resolve of this.detectWaiting.values()) resolve(null);
    this.detectWaiting.clear();
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/peaks.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }: MessageEvent<PeaksResponse>) => this.receive(data);
      this.worker.onerror = () => {
        this.fit?.resolve(null);
        this.fit = null;
        this.reset();
      };
    }
    return this.worker;
  }

  private receive(data: PeaksResponse): void {
    if (data.kind === 'detect' || (data.kind === 'error' && this.detectWaiting.has(data.id))) {
      const resolve = this.detectWaiting.get(data.id);
      this.detectWaiting.delete(data.id);
      // Older detection results are dropped: only the latest settings matter.
      resolve?.(data.kind === 'detect' && data.id === this.latestDetect ? data.peaks : null);
      return;
    }
    if (!this.fit || data.id !== this.fit.id) return;
    if (data.kind === 'progress') this.fit.progress(data.done, data.total);
    else {
      this.fit.resolve(data.kind === 'fit' ? data.regions : null);
      this.fit = null;
    }
  }
}
