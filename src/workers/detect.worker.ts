import type { Rect } from '../core/particles/geometry';
import { detectParticles, segment, type DetectSettings } from '../core/particles/detect/pipeline';
import type { Runs } from '../core/particles/detect/regions';

export type DetectRequest =
  | {
      id: number;
      kind: 'detect';
      gray: Uint8Array;
      width: number;
      height: number;
      settings: DetectSettings;
      area: Rect | null;
    }
  | {
      id: number;
      kind: 'mask';
      gray: Uint8Array;
      width: number;
      height: number;
      settings: DetectSettings;
      area: Rect | null;
    };

export type DetectResponse =
  | { id: number; kind: 'detect'; particles: Runs[]; threshold: number }
  | { id: number; kind: 'mask'; mask: Uint8Array; threshold: number }
  | { id: number; kind: 'error' };

// Typed locally because the DOM and WebWorker type libraries cannot be loaded together.
interface WorkerScope {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage(message: DetectResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data: request }) => {
  try {
    const { gray, width, height, settings, area } = request;
    if (request.kind === 'mask') {
      const { mask, threshold } = segment(gray, width, height, settings, area);
      scope.postMessage({ id: request.id, kind: 'mask', mask, threshold }, [mask.buffer]);
    } else {
      const { particles, threshold } = detectParticles(gray, width, height, settings, area);
      scope.postMessage(
        { id: request.id, kind: 'detect', particles, threshold },
        particles.map((p) => p.buffer as ArrayBuffer),
      );
    }
  } catch {
    scope.postMessage({ id: request.id, kind: 'error' }, []);
  }
};
