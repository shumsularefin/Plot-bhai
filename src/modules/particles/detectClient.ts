import type { DetectSettings } from '../../core/particles/detect/pipeline';
import type { Rect } from '../../core/particles/geometry';
import type { DetectRequest, DetectResponse } from '../../workers/detect.worker';

/** A successful answer of the given kind. */
type Answer<K extends DetectResponse['kind']> = Extract<DetectResponse, { kind: K }>;

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

  async detect(input: DetectInput): Promise<Answer<'detect'> | 'error' | null> {
    const response = await this.run({ kind: 'detect', ...input });
    if (!response) return null;
    return response.kind === 'detect' ? response : 'error';
  }

  /** The threshold preview: the mask, the level used and the histogram it was chosen from. */
  async mask(input: DetectInput): Promise<Answer<'mask'> | 'error' | null> {
    const response = await this.run({ kind: 'mask', ...input });
    if (!response) return null;
    return response.kind === 'mask' ? response : 'error';
  }

  /** The adjusted and smoothed image to show while preparing it. */
  async adjust(input: DetectInput): Promise<Answer<'adjust'> | 'error' | null> {
    const response = await this.run({ kind: 'adjust', ...input });
    if (!response) return null;
    return response.kind === 'adjust' ? response : 'error';
  }
}
