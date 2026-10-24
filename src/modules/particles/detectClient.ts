import type { DetectSettings } from '../../core/particles/detect/pipeline';
import type { Runs } from '../../core/particles/detect/regions';
import type { Rect } from '../../core/particles/geometry';
import type { DetectRequest, DetectResponse } from '../../workers/detect.worker';

export interface DetectInput {
  gray: Uint8Array;
  width: number;
  height: number;
  settings: DetectSettings;
  area: Rect | null;
}

/**
 * Runs detection in a web worker so the page never freezes. One job at a time; starting a new job
 * or calling cancel() stops the running one (the worker is ended and started afresh next time).
 */
export class DetectClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private pending: { id: number; resolve: (r: DetectResponse | null) => void } | null = null;

  /** Ends the running job, if any; its promise resolves with null. */
  cancel(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.pending?.resolve(null);
    this.pending = null;
  }

  private run(request: Omit<DetectRequest, 'id'>): Promise<DetectResponse | null> {
    this.cancel();
    const id = this.nextId++;
    this.worker = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), {
      type: 'module',
    });
    return new Promise((resolve) => {
      this.pending = { id, resolve };
      this.worker?.addEventListener('message', ({ data }: MessageEvent<DetectResponse>) => {
        if (data.id !== id) return;
        this.pending = null;
        resolve(data);
      });
      this.worker?.addEventListener('error', () => {
        this.pending = null;
        resolve({ id, kind: 'error' });
      });
      // The pixels are copied, so the caller's gray image stays usable.
      this.worker?.postMessage({ ...request, id, gray: request.gray.slice() } as DetectRequest);
    });
  }

  async detect(
    input: DetectInput,
  ): Promise<{ particles: Runs[]; threshold: number } | 'error' | null> {
    const response = await this.run({ kind: 'detect', ...input });
    if (!response) return null;
    return response.kind === 'detect'
      ? { particles: response.particles, threshold: response.threshold }
      : 'error';
  }

  async mask(
    input: DetectInput,
  ): Promise<{ mask: Uint8Array; threshold: number } | 'error' | null> {
    const response = await this.run({ kind: 'mask', ...input });
    if (!response) return null;
    return response.kind === 'mask'
      ? { mask: response.mask, threshold: response.threshold }
      : 'error';
  }
}
